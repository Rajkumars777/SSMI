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

type DisplayMediaWithSystemAudio = MediaStreamConstraints & {
  systemAudio?: 'include' | 'exclude';
};

/**
 * Capture system / call / tab audio (what you hear through headphones).
 * Prompts to share screen or tab — user must enable "Share system audio" or "Share tab audio".
 */
export async function captureSystemAudioStream(): Promise<MediaStream | null> {
  try {
    const constraints: DisplayMediaWithSystemAudio = {
      video: true,
      audio: {
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
      },
      systemAudio: 'include',
    };

    const stream = await navigator.mediaDevices.getDisplayMedia(constraints);

    stream.getVideoTracks().forEach((track) => {
      track.stop();
      stream.removeTrack(track);
    });

    if (stream.getAudioTracks().length === 0) {
      stream.getTracks().forEach((t) => t.stop());
      return null;
    }
    return stream;
  } catch (err) {
    console.warn('[SSMI Audio] System audio capture cancelled or failed:', err);
    return null;
  }
}

/** @deprecated Use captureSystemAudioStream */
export async function captureTabAudioStream(): Promise<MediaStream | null> {
  return captureSystemAudioStream();
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
