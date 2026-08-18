export interface AudioInputDevice {
  deviceId: string;
  label: string;
}

const HEADSET_HINTS = [
  'headset', 'headphone', 'headphones', 'earbud', 'earbuds', 'airpods',
  'bluetooth', 'hands-free', 'handsfree', 'usb audio', 'wireless', 'epos',
];

const DEVICE_LABEL_PREFIXES = [
  /^default\s*-\s*/i,
  /^communications\s*-\s*/i,
];

export function isHeadsetLikeLabel(label: string): boolean {
  const lower = label.toLowerCase();
  return HEADSET_HINTS.some((hint) => lower.includes(hint));
}

/** Strip Windows virtual-device prefixes so duplicates group together. */
export function normalizeDeviceLabel(label: string): string {
  let normalized = label.trim();
  for (const re of DEVICE_LABEL_PREFIXES) {
    normalized = normalized.replace(re, '');
  }
  return normalized.trim();
}

/** Lower score = preferred device when the same hardware appears multiple times. */
function devicePreferenceScore(label: string): number {
  const lower = label.toLowerCase();
  if (lower.startsWith('communications')) return 20;
  if (lower.startsWith('default')) return 10;
  return 0;
}

/**
 * Windows often lists the same headset 2–3 times (Default / Communications / plain).
 * Keep one entry per physical device — prefer the plain hardware name.
 */
export function dedupeAudioInputDevices(devices: AudioInputDevice[]): AudioInputDevice[] {
  const groups = new Map<string, AudioInputDevice[]>();

  for (const device of devices) {
    const key = normalizeDeviceLabel(device.label).toLowerCase();
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(device);
  }

  const deduped: AudioInputDevice[] = [];
  for (const group of groups.values()) {
    group.sort((a, b) => devicePreferenceScore(a.label) - devicePreferenceScore(b.label));
    const best = group[0];
    deduped.push({
      deviceId: best.deviceId,
      label: normalizeDeviceLabel(best.label),
    });
  }

  return deduped.sort((a, b) => a.label.localeCompare(b.label));
}

export async function ensureMicPermission(): Promise<boolean> {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    stream.getTracks().forEach((t) => t.stop());
    return true;
  } catch {
    return false;
  }
}

export async function listAudioInputDevices(): Promise<AudioInputDevice[]> {
  const devices = await navigator.mediaDevices.enumerateDevices();
  const inputs = devices
    .filter((d) => d.kind === 'audioinput' && d.deviceId)
    .map((d) => ({
      deviceId: d.deviceId,
      label: d.label || `Microphone ${d.deviceId.slice(0, 6)}`,
    }));
  return dedupeAudioInputDevices(inputs);
}

/** Prefer saved device, then best headset (non-communications), then default. */
export function resolveMicDeviceId(
  devices: AudioInputDevice[],
  preferredId?: string,
): string | undefined {
  if (preferredId && devices.some((d) => d.deviceId === preferredId)) {
    return preferredId;
  }

  const headsets = devices.filter((d) => isHeadsetLikeLabel(d.label));
  if (headsets.length > 0) {
    const nonComm = headsets.find((d) => !d.label.toLowerCase().startsWith('communications'));
    return (nonComm ?? headsets[0]).deviceId;
  }

  return devices[0]?.deviceId;
}

export async function getMicrophoneStream(
  deviceId?: string,
  options?: { withSystemAudio?: boolean },
): Promise<MediaStream> {
  const withSystem = !!options?.withSystemAudio;
  const audioConstraints: MediaTrackConstraints = {
    echoCancellation: !withSystem,
    noiseSuppression: !withSystem,
    autoGainControl: true,
    channelCount: 1,
  };

  if (deviceId) {
    // `ideal` works better on Windows than `exact` for Bluetooth/USB headsets.
    audioConstraints.deviceId = { ideal: deviceId };
  }

  try {
    return await navigator.mediaDevices.getUserMedia({ audio: audioConstraints });
  } catch (err) {
    if (deviceId) {
      console.warn('[SSMI Audio] Preferred mic unavailable, using default:', err);
      return navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: !withSystem,
          noiseSuppression: !withSystem,
          autoGainControl: true,
          channelCount: 1,
        },
      });
    }
    throw err;
  }
}

export type SystemAudioCaptureMethod = 'loopback' | 'display-media' | 'none';

export interface SystemAudioCaptureResult {
  stream: MediaStream | null;
  method: SystemAudioCaptureMethod;
  detail?: string;
}

const LOOPBACK_HINTS = [
  'stereo mix',
  'what u hear',
  'wave link',
  'vb-audio',
  'virtual cable',
  'voicemeeter',
  'loopback',
  'blackhole',
  'soundflower',
];

export function isLoopbackLikeLabel(label: string): boolean {
  const lower = label.toLowerCase();
  return LOOPBACK_HINTS.some((hint) => lower.includes(hint));
}

/** Windows/macOS loopback devices (Stereo Mix, VB-Cable, etc.) — no screen picker required. */
export async function listLoopbackAudioDevices(): Promise<AudioInputDevice[]> {
  const devices = await listAudioInputDevices();
  return devices.filter((d) => isLoopbackLikeLabel(d.label));
}

async function captureLoopbackAudioStream(deviceId?: string): Promise<MediaStream | null> {
  const loopbackDevices = await listLoopbackAudioDevices();
  if (loopbackDevices.length === 0) return null;

  const target =
    (deviceId && loopbackDevices.find((d) => d.deviceId === deviceId)) ||
    loopbackDevices[0];

  try {
    return await navigator.mediaDevices.getUserMedia({
      audio: {
        deviceId: { ideal: target.deviceId },
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
        channelCount: 2,
      },
    });
  } catch (err) {
    console.warn('[SSMI Audio] Loopback device capture failed:', err);
    return null;
  }
}

type DisplayMediaAudioConstraints = MediaTrackConstraints & {
  suppressLocalAudioPlayback?: boolean;
};

type DisplayMediaWithSystemAudio = MediaStreamConstraints & {
  systemAudio?: 'include' | 'exclude';
  monitorTypeSurfaces?: 'include' | 'exclude';
  selfBrowserSurface?: 'include' | 'exclude';
  preferCurrentTab?: boolean;
};

/** Chrome/Edge extended getDisplayMedia — not yet in all TypeScript DOM libs. */
type ExtendedDisplayMedia = (
  constraints?: DisplayMediaWithSystemAudio,
) => Promise<MediaStream>;

function getDisplayMedia(constraints: DisplayMediaWithSystemAudio): Promise<MediaStream> {
  return (navigator.mediaDevices.getDisplayMedia as ExtendedDisplayMedia)(constraints);
}

function stripVideoTracks(stream: MediaStream): MediaStream {
  stream.getVideoTracks().forEach((track) => {
    track.stop();
    stream.removeTrack(track);
  });
  return stream;
}

function hasUsableAudio(stream: MediaStream | null): stream is MediaStream {
  return !!stream && stream.getAudioTracks().length > 0;
}

/**
 * Capture system / call audio via the browser screen-share picker.
 * Prefer "Entire screen" + "Share system audio" — same API Meet/Teams use internally,
 * but SSMI only keeps the audio track (nothing is broadcast to other participants).
 */
async function captureDisplayMediaSystemAudio(): Promise<MediaStream | null> {
  const constraints: DisplayMediaWithSystemAudio = {
    video: {
      displaySurface: 'monitor',
    } as MediaTrackConstraints,
    audio: {
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: false,
      suppressLocalAudioPlayback: true,
    } as DisplayMediaAudioConstraints,
    systemAudio: 'include',
    monitorTypeSurfaces: 'include',
    selfBrowserSurface: 'exclude',
    preferCurrentTab: false,
  };

  try {
    const stream = await getDisplayMedia(constraints);
    stripVideoTracks(stream);

    if (!hasUsableAudio(stream)) {
      stopStream(stream);
      return null;
    }
    return stream;
  } catch (err) {
    console.warn('[SSMI Audio] Enhanced display-media capture failed, trying basic picker:', err);
  }

  try {
    const fallbackConstraints: DisplayMediaWithSystemAudio = {
      video: true,
      audio: {
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
      },
      systemAudio: 'include',
    };

    const stream = await getDisplayMedia(fallbackConstraints);
    stripVideoTracks(stream);

    if (!hasUsableAudio(stream)) {
      stopStream(stream);
      return null;
    }
    return stream;
  } catch (err) {
    console.warn('[SSMI Audio] Display-media capture cancelled or failed:', err);
    return null;
  }
}

export interface CaptureSystemAudioOptions {
  /** Prefer loopback device (Stereo Mix / VB-Cable) when available — skips the screen picker. */
  preferLoopback?: boolean;
  loopbackDeviceId?: string;
  /** When true, always show the screen picker (Meet/Teams-style entire-screen + system audio). */
  forceDisplayMedia?: boolean;
}

/**
 * Capture system / call / meeting audio (what you hear through headphones or speakers).
 *
 * Strategies (in order when preferLoopback is enabled):
 * 1. Loopback input device — Stereo Mix, VB-Audio Cable, Voicemeeter, etc.
 * 2. getDisplayMedia — pick "Entire screen" and enable "Share system audio"
 */
export async function captureSystemAudioStream(
  options: CaptureSystemAudioOptions = {},
): Promise<SystemAudioCaptureResult> {
  const { preferLoopback = true, loopbackDeviceId, forceDisplayMedia = false } = options;

  if (preferLoopback && !forceDisplayMedia) {
    const loopbackStream = await captureLoopbackAudioStream(loopbackDeviceId);
    if (hasUsableAudio(loopbackStream)) {
      const devices = await listLoopbackAudioDevices();
      const label =
        devices.find((d) => d.deviceId === loopbackDeviceId)?.label ||
        devices[0]?.label ||
        'Loopback device';
      return {
        stream: loopbackStream,
        method: 'loopback',
        detail: label,
      };
    }
  }

  const displayStream = await captureDisplayMediaSystemAudio();
  if (hasUsableAudio(displayStream)) {
    return {
      stream: displayStream,
      method: 'display-media',
      detail: 'Entire screen + system audio',
    };
  }

  return { stream: null, method: 'none' };
}

/** @deprecated Use captureSystemAudioStream */
export async function captureTabAudioStream(): Promise<MediaStream | null> {
  const result = await captureSystemAudioStream();
  return result.stream;
}

/** Mix multiple audio streams into one for MediaRecorder. */
export function mixAudioStreams(streams: MediaStream[]): { stream: MediaStream; context: AudioContext } {
  const context = new AudioContext();
  const destination = context.createMediaStreamDestination();

  for (const stream of streams) {
    if (stream.getAudioTracks().length > 0) {
      const source = context.createMediaStreamSource(stream);
      const gain = context.createGain();
      gain.gain.value = 1.0;
      source.connect(gain);
      gain.connect(destination);
    }
  }

  return { stream: destination.stream, context };
}

export function stopStream(stream: MediaStream | null | undefined): void {
  stream?.getTracks().forEach((t) => t.stop());
}

/** Returns RMS level 0–1 for UI meter. */
export function createAudioLevelMonitor(
  stream: MediaStream,
  onLevel: (level: number) => void,
): { stop: () => void } {
  const context = new AudioContext();
  const analyser = context.createAnalyser();
  analyser.fftSize = 256;
  analyser.smoothingTimeConstant = 0.4;
  const source = context.createMediaStreamSource(stream);
  source.connect(analyser);

  const data = new Uint8Array(analyser.frequencyBinCount);
  let raf = 0;

  const tick = () => {
    analyser.getByteTimeDomainData(data);
    let sum = 0;
    for (let i = 0; i < data.length; i++) {
      const v = (data[i] - 128) / 128;
      sum += v * v;
    }
    onLevel(Math.min(1, Math.sqrt(sum / data.length) * 5));
    raf = requestAnimationFrame(tick);
  };

  tick();

  return {
    stop: () => {
      cancelAnimationFrame(raf);
      source.disconnect();
      context.close().catch(() => {});
    },
  };
}
