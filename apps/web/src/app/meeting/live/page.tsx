'use client';

import { useState, useEffect, useRef, useCallback, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import AudioWaveform from '@/components/AudioWaveform';
import { apiClient } from '@/lib/api';
import { loadSettings, saveSettings, getBookmarkDisplayLabel, getStopDisplayLabel, DEFAULT_SETTINGS, type SSMISettings } from '@/lib/settings';
import {
  ensureMicPermission,
  listAudioInputDevices,
  resolveMicDeviceId,
  getMicrophoneStream,
  captureSystemAudioStream,
  mixAudioStreams,
  stopStream,
  createAudioLevelMonitor,
  isHeadsetLikeLabel,
  type AudioInputDevice,
} from '@/lib/audioCapture';


import styles from './page.module.css';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
interface LiveEvent {
  time: number;
  type: string;
  label: string;
  color: string;
}

interface LiveTranscriptLine {
  speaker: string;
  text: string;
  startTime: number;
}

const EVENT_COLORS: Record<string, string> = {
  REQUIREMENT:     '#4f8ef7',
  BUDGET:          '#f59e0b',
  OBJECTION:       '#ef4444',
  NEGOTIATION:     '#a855f7',
  DECISION:        '#22d3a0',
  PRICING:         '#06b6d4',
  COMMITMENT:      '#10b981',
  COMPETITOR:      '#f97316',
  RISK:            '#dc2626',
  ACTION_ITEM:     '#8b5cf6',
  PURCHASE_INTENT: '#14b8a6',
};

function formatTime(s: number) {
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
}

// ---------------------------------------------------------------------------
// Inner component (uses useSearchParams — must live inside <Suspense>)
// ---------------------------------------------------------------------------

function LiveMeetingInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const meetingId = searchParams.get('id') || 'live_session';
  const isBackendParam = searchParams.get('backend') !== 'false';
  const rawCustomerName = searchParams.get('customer');
  const customerLabel = rawCustomerName ? decodeURIComponent(rawCustomerName) : 'Customer';

  const [elapsed, setElapsed]                   = useState(0);
  const [events, setEvents]                     = useState<LiveEvent[]>([]);
  const [transcript, setTranscript]             = useState<LiveTranscriptLine[]>([]);
  const [interimText, setInterimText]           = useState<string>('');       // live "typing" line
  const [activeSpeaker, setActiveSpeaker]       = useState<'SPEAKER_1' | 'SPEAKER_2'>('SPEAKER_1');
  const [bookmarks, setBookmarks]               = useState<number[]>([]);
  const [gestureDetected, setGestureDetected]   = useState<string | null>(null);
  const [connectionStatus, setConnectionStatus] = useState<'connecting' | 'connected' | 'offline'>('connecting');
  const [micActive, setMicActive]               = useState(false);
  const [isProcessing, setIsProcessing]         = useState(false);
  const [settings, setSettings]                 = useState<SSMISettings>(DEFAULT_SETTINGS);
  const [micDevices, setMicDevices]             = useState<AudioInputDevice[]>([]);
  const [selectedMicId, setSelectedMicId]       = useState('');
  const [captureTabAudio, setCaptureTabAudio]   = useState(false);
  const [tabAudioActive, setTabAudioActive]     = useState(false);
  const [micReady, setMicReady]                   = useState(false);
  const [micError, setMicError]                 = useState<string | null>(null);
  const [audioLevel, setAudioLevel]             = useState(0);

  const transcriptRef     = useRef<HTMLDivElement>(null);
  const wsRef             = useRef<WebSocket | null>(null);
  const mediaRecorderRef  = useRef<MediaRecorder | null>(null);
  const streamRef         = useRef<MediaStream | null>(null);
  const micStreamRef      = useRef<MediaStream | null>(null);
  const tabStreamRef      = useRef<MediaStream | null>(null);
  const mixContextRef     = useRef<AudioContext | null>(null);
  const levelMonitorRef   = useRef<{ stop: () => void } | null>(null);
  const audioChunksRef    = useRef<Blob[]>([]);
  const recognitionRef    = useRef<any>(null);
  const elapsedRef        = useRef<number>(0);
  const lastBookmarkMsRef = useRef<number>(0);
  const isStoppingRef     = useRef<boolean>(false);
  const isCancellingRef   = useRef<boolean>(false);
  const backendMeetingRef = useRef<boolean>(false);
  const doStopRef         = useRef<(() => void) | null>(null);
  const transcriptSnapshotRef = useRef<LiveTranscriptLine[]>([]);

  // Speaker & Silence Tracking
  const currentSpeakerRef    = useRef<'SPEAKER_1' | 'SPEAKER_2'>('SPEAKER_1');
  const lastSpeechMsRef      = useRef<number>(0);
  const SILENCE_THRESHOLD_MS = 3000; // 3 seconds pause -> switch speaker for next utterance

  useEffect(() => {
    currentSpeakerRef.current = activeSpeaker;
  }, [activeSpeaker]);

  useEffect(() => {
    transcriptSnapshotRef.current = transcript;
  }, [transcript]);

  // ── Timer & Settings Load (SSR Hydration Safe) ───────────────────────────
  useEffect(() => {
    const loaded = loadSettings();
    setSettings(loaded);
    setCaptureTabAudio(!!loaded.captureTabAudio);
    backendMeetingRef.current = isBackendParam;
    elapsedRef.current = 0;
    const interval = setInterval(() => {
      elapsedRef.current += 1;
      setElapsed(elapsedRef.current);
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  // ── Enumerate microphones (headset-friendly) ─────────────────────────────
  useEffect(() => {
    let cancelled = false;

    async function initDevices() {
      const permitted = await ensureMicPermission();
      if (!permitted) {
        if (!cancelled) {
          setMicError('Microphone permission denied. Allow mic access in your browser.');
          setMicReady(true);
        }
        return;
      }

      const devices = await listAudioInputDevices();
      if (cancelled) return;

      setMicDevices(devices);
      const loaded = loadSettings();
      const resolved = resolveMicDeviceId(devices, loaded.preferredMicDeviceId || undefined);
      setSelectedMicId(resolved || devices[0]?.deviceId || '');

      const usingHeadset = devices.some((d) => isHeadsetLikeLabel(d.label));
      if (usingHeadset && !loaded.captureTabAudio) {
        setCaptureTabAudio(true);
      }

      setMicReady(true);
    }

    initDevices();

    const onDeviceChange = () => { initDevices(); };
    navigator.mediaDevices?.addEventListener('devicechange', onDeviceChange);

    return () => {
      cancelled = true;
      navigator.mediaDevices?.removeEventListener('devicechange', onDeviceChange);
    };
  }, []);

  function cleanupAudioCapture() {
    levelMonitorRef.current?.stop();
    levelMonitorRef.current = null;
    try { mediaRecorderRef.current?.stop(); } catch {}
    mediaRecorderRef.current = null;
    stopStream(streamRef.current);
    stopStream(micStreamRef.current);
    stopStream(tabStreamRef.current);
    streamRef.current = null;
    micStreamRef.current = null;
    tabStreamRef.current = null;
    if (mixContextRef.current) {
      mixContextRef.current.close().catch(() => {});
      mixContextRef.current = null;
    }
    setAudioLevel(0);
    setTabAudioActive(false);
    setMicActive(false);
  }

  // ── Throttled & Deduplicated Bookmark Handler ─────────────────────────────
  const addBookmark = useCallback((toastText?: string) => {
    const now = Date.now();
    if (now - lastBookmarkMsRef.current < 2500) return;
    lastBookmarkMsRef.current = now;

    const currentSec = elapsedRef.current;
    setBookmarks((prev) => {
      if (prev.includes(currentSec)) return prev;
      return [...prev, currentSec];
    });

    setGestureDetected(toastText || `Bookmarked at ${formatTime(currentSec)}`);
    setTimeout(() => setGestureDetected(null), 3000);
  }, []);

  // ── Smart Final Transcript Line Handler ───────────────────────────────────
  // Deduplicates progressive utterances ("Oh" -> "Oh okay" -> "Oh okay um"),
  // consolidates speaker turns, and handles silence-based speaker switching.
  const handleFinalText = useCallback((cleanText: string, ws: WebSocket | null) => {
    if (!cleanText) return;

    const now = Date.now();
    // If silence exceeded threshold since last speech result, switch active speaker
    if (lastSpeechMsRef.current > 0 && (now - lastSpeechMsRef.current) >= SILENCE_THRESHOLD_MS) {
      const nextSpeaker = currentSpeakerRef.current === 'SPEAKER_1' ? 'SPEAKER_2' : 'SPEAKER_1';
      currentSpeakerRef.current = nextSpeaker;
      setActiveSpeaker(nextSpeaker);
    }
    lastSpeechMsRef.current = now;

    const speaker = currentSpeakerRef.current;

    setTranscript((prev) => {
      const startTime = elapsedRef.current;
      if (prev.length === 0) {
        return [{ speaker, text: cleanText, startTime }];
      }

      const lastIdx = prev.length - 1;
      const lastLine = prev[lastIdx];

      // If same speaker turn, consolidate text to prevent duplicate cards
      if (lastLine.speaker === speaker) {
        const prevText = lastLine.text;

        if (prevText === cleanText) return prev;

        // Progressive extension ("Oh" -> "Oh okay") -> update existing line
        if (cleanText.startsWith(prevText)) {
          const updated = [...prev];
          updated[lastIdx] = { ...lastLine, text: cleanText };
          return updated;
        }

        // Previous text already covers this cleanText -> skip
        if (prevText.startsWith(cleanText) || prevText.includes(cleanText)) {
          return prev;
        }

        // New phrase in same speaker turn -> append to same line
        const merged = `${prevText} ${cleanText}`.trim();
        const updated = [...prev];
        updated[lastIdx] = { ...lastLine, text: merged };
        return updated;
      }

      // Different speaker turn -> add new speaker card
      return [...prev, { speaker, text: cleanText, startTime }];
    });

    requestAnimationFrame(() =>
      transcriptRef.current?.scrollTo({ top: 99999, behavior: 'smooth' })
    );

    const userSettings = loadSettings();
    const bookmarkKw = (userSettings.customBookmarkKeyword || 'bookmark').toLowerCase();
    const stopKw = (userSettings.customStopKeyword || 'stop meeting').toLowerCase();
    const lower = cleanText.toLowerCase();
    if (lower.includes(bookmarkKw) || lower.includes('bookmark') || lower.includes('mark this')) {
      addBookmark(`Voice Keyword "${userSettings.customBookmarkKeyword || 'Bookmark'}" Detected!`);
    }
    if (lower.includes(stopKw) || lower.includes('stop meeting') || lower.includes('end meeting')) {
      doStopRef.current?.();
      return;
    }

    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'PARTIAL_TRANSCRIPT', text: cleanText, speaker }));
    }
  }, [addBookmark]);

  // ── Browser Web Speech API ─────────────────────────────────────────────────
  const startSpeechRecognition = useCallback(() => {
    if (typeof window === 'undefined') return;
    const SpeechRecognition =
      (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) return;

    try {
      try { recognitionRef.current?.stop(); } catch {}
      const recognition = new SpeechRecognition();
      recognition.continuous      = true;
      recognition.interimResults  = true;
      recognition.maxAlternatives = 1;
      recognition.lang            = 'en-US';

      recognition.onresult = (e: any) => {
        for (let i = e.resultIndex; i < e.results.length; i++) {
          const result = e.results[i];
          const text   = result[0].transcript.trim();
          if (!text) continue;

          if (!result.isFinal) {
            setInterimText(text);
            continue;
          }

          setInterimText('');
          const ws = wsRef.current;
          handleFinalText(text, ws && ws.readyState === WebSocket.OPEN ? ws : null);
        }
      };

      recognition.onerror = (e: any) => {
        if (e.error === 'no-speech') return;
        console.warn('[SpeechRecognition] error:', e.error);
      };

      recognition.onend = () => {
        setInterimText('');
        if (!isStoppingRef.current && !isCancellingRef.current) {
          try { recognition.start(); } catch {}
        }
      };

      recognition.start();
      recognitionRef.current = recognition;
    } catch (err) {
      console.warn('[Web Speech API] Could not start:', err);
    }
  }, [handleFinalText]);



  // ── Microphone + system audio capture (independent of WebSocket) ───────────
  const startAudioCapture = useCallback(async () => {
    cleanupAudioCapture();
    setMicError(null);

    try {
      const micStream = await getMicrophoneStream(selectedMicId || undefined, {
        withSystemAudio: captureTabAudio,
      });
      micStreamRef.current = micStream;

      const streams: MediaStream[] = [micStream];

      if (captureTabAudio) {
        const systemStream = await captureSystemAudioStream();
        if (systemStream) {
          tabStreamRef.current = systemStream;
          streams.push(systemStream);
          setTabAudioActive(true);
        } else {
          setMicError(
            'System audio not shared. When prompted, pick your meeting window/screen and check "Share system audio" or "Share tab audio".',
          );
        }
      }

      let recordStream = micStream;
      if (streams.length > 1) {
        const { stream, context } = mixAudioStreams(streams);
        mixContextRef.current = context;
        recordStream = stream;
      }

      streamRef.current = recordStream;
      levelMonitorRef.current = createAudioLevelMonitor(recordStream, setAudioLevel);

      const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : 'audio/webm';

      const recorder = new MediaRecorder(recordStream, { mimeType });
      mediaRecorderRef.current = recorder;
      audioChunksRef.current = [];

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) {
          audioChunksRef.current.push(e.data);
          const ws = wsRef.current;
          if (ws && ws.readyState === WebSocket.OPEN) ws.send(e.data);
        }
      };

      recorder.start(100);
      startSpeechRecognition();
      setMicActive(true);

      if (wsRef.current?.readyState === WebSocket.OPEN) {
        setConnectionStatus('connected');
      } else {
        setConnectionStatus('offline');
      }
    } catch (err) {
      console.warn('[Microphone] Access denied or unavailable:', err);
      setMicError('Could not access microphone. Pick your headset mic and click Apply.');
      setMicActive(false);
      setConnectionStatus('offline');
    }
  }, [selectedMicId, captureTabAudio, startSpeechRecognition]);

  function handleMicChange(deviceId: string) {
    setSelectedMicId(deviceId);
    const updated = { ...loadSettings(), preferredMicDeviceId: deviceId };
    saveSettings(updated);
    setSettings(updated);
  }

  function handleTabAudioToggle(enabled: boolean) {
    setCaptureTabAudio(enabled);
    const updated = { ...loadSettings(), captureTabAudio: enabled };
    saveSettings(updated);
    setSettings(updated);
  }

  async function applyAudioSettings() {
    if (!isStoppingRef.current && !isCancellingRef.current) {
      await startAudioCapture();
    }
  }

  // Start mic/system capture as soon as devices are ready
  useEffect(() => {
    if (!micReady || isStoppingRef.current || isCancellingRef.current) return;
    startAudioCapture();
    return () => {
      cleanupAudioCapture();
      try { recognitionRef.current?.stop(); } catch {}
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [micReady]);

  // ── WebSocket (AI events — optional; mic works without it) ────────────────
  useEffect(() => {
    if (!micReady) return;

    let ws: WebSocket;

    try {
      ws = apiClient.connectWebSocket(
        meetingId,
        (msg) => {
          if (msg.event_type === 'LIVE_BUSINESS_EVENT' || msg.type === 'event') {
            const businessType = (msg.type as string) || 'COMMITMENT';
            setEvents((prev) => [...prev, {
              time:  elapsedRef.current,
              type:  businessType,
              label: (msg.title as string) || businessType.replace(/_/g, ' '),
              color: EVENT_COLORS[businessType] || '#4f8ef7',
            }]);
          } else if (msg.type === 'transcript') {
            setTranscript((prev) => [...prev, {
              speaker: String(msg.speaker || 'UNKNOWN'),
              text: String(msg.text || ''),
              startTime: elapsedRef.current,
            }]);
            setTimeout(() => transcriptRef.current?.scrollTo({ top: 99999, behavior: 'smooth' }), 30);
          } else if (msg.type === 'gesture' || msg.event_type === 'GESTURE_DETECTED') {
            const gesture = String(msg.gesture || '').toLowerCase();
            if (gesture === 'bookmark') addBookmark('Voice Gesture Bookmark Detected');
            if (gesture === 'stop') doStopRef.current?.();
          }
        },
        () => {
          if (micActive) setConnectionStatus('offline');
        },
      );

      ws.onopen = () => {
        if (micActive) {
          setConnectionStatus('connected');
        } else {
          setConnectionStatus('connecting');
        }
      };
      ws.onclose = () => {
        if (micActive) setConnectionStatus('offline');
      };
      wsRef.current = ws;
    } catch {
      if (micActive) setConnectionStatus('offline');
    }

    return () => {
      wsRef.current?.close();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [meetingId, addBookmark, micReady]);

  // ── Controls ──────────────────────────────────────────────────────────────
  function handleBookmark() {
    addBookmark();
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'bookmark', timestamp: elapsedRef.current }));
    }
  }

  // doStop is the single source of truth for stopping — called by button OR voice gesture
  async function doStop() {
    // Absorb duplicate calls (double-click, voice + button at same time)
    if (isStoppingRef.current || isCancellingRef.current) return;
    isStoppingRef.current = true;
    setIsProcessing(true);

    // 1. Stop everything immediately so the UI feels responsive
    try { recognitionRef.current?.stop(); } catch {}
    cleanupAudioCapture();
    wsRef.current?.close();

    // 2. Wait a tick for the MediaRecorder onstop to flush final chunk
    await new Promise<void>((resolve) => setTimeout(resolve, 300));

    const isBackendMeeting = backendMeetingRef.current && meetingId && meetingId !== 'live_session';
    const liveTranscript = transcriptSnapshotRef.current;
    const meetingDuration = elapsedRef.current;
    const meetingBookmarks = [...bookmarks];

    // 3. Upload audio (for playback) then run AI on live transcript (skip Whisper)
    try {
      if (isBackendMeeting) {
        if (audioChunksRef.current.length > 0) {
          const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
          const file = new File([audioBlob], `recording_${meetingId}.webm`, { type: 'audio/webm' });
          await apiClient.uploadAudio(meetingId, file, false);
        }

        if (liveTranscript.length > 0) {
          await apiClient.finalizeLiveMeeting(meetingId, {
            transcript: liveTranscript.map((line) => ({
              speaker: line.speaker,
              text: line.text,
              startTime: line.startTime,
            })),
            duration: meetingDuration,
            bookmarks: meetingBookmarks,
          });
        } else if (audioChunksRef.current.length > 0) {
          await apiClient.processMeeting(meetingId);
        }
      }
    } catch (err) {
      console.warn('[SSMI] Finalize meeting failed (navigating anyway):', err);
    } finally {
      const target = isBackendMeeting ? `/meeting/${meetingId}` : '/dashboard';
      router.push(target);
    }
  }

  async function doCancel() {
    if (isStoppingRef.current || isCancellingRef.current) return;
    if (!confirm('Cancel this meeting? The recording and transcript will be discarded.')) return;

    isCancellingRef.current = true;
    setIsProcessing(true);

    try { recognitionRef.current?.stop(); } catch {}
    cleanupAudioCapture();
    wsRef.current?.close();

    const isBackendMeeting = backendMeetingRef.current && meetingId && meetingId !== 'live_session';
    if (isBackendMeeting) {
      try {
        await apiClient.deleteMeeting(meetingId);
      } catch (err) {
        console.warn('[SSMI] Cancel delete failed:', err);
      }
    }

    router.push('/dashboard');
  }

  function handleStop() { doStop(); }
  function handleCancel() { doCancel(); }
  doStopRef.current = doStop;

  const statusColors = { connecting: '#f59e0b', connected: '#22d3a0', offline: '#6b7280' };
  const statusLabels = {
    connecting: 'Starting audio capture…',
    connected: micActive ? 'Live — mic + AI active' : 'Connecting to AI…',
    offline: micActive ? 'Recording — mic active' : 'Waiting for microphone…',
  };


  return (
    <div className={`page-wrapper ${styles.root}`}>
      <div className="container">
        <div className={styles.layout}>

          {/* ── Left column ─────────────────────────────────────── */}
          <div className={styles.main}>

            {/* Recording card */}
            <div className={`glass-card ${styles.recordingCard}`}>
              <div className={styles.recHeader}>
                <div className={styles.recIndicator}>
                  <div className={styles.recDot} />
                  <span className={styles.recLabel}>LIVE RECORDING</span>
                </div>
                <div className={styles.timer}>{formatTime(elapsed)}</div>
              </div>

              {/* Status pill */}
              <div style={{ display:'flex', alignItems:'center', gap:6, padding:'4px 10px', borderRadius:6, background:'rgba(255,255,255,0.04)', marginBottom:8, fontSize:12, color:statusColors[connectionStatus], fontWeight:500 }}>
                <div style={{ width:6, height:6, borderRadius:'50%', background:statusColors[connectionStatus], boxShadow: connectionStatus==='connected' ? `0 0 6px ${statusColors[connectionStatus]}`:'none' }} />
                {statusLabels[connectionStatus]}
              </div>

              {/* Audio input controls — headset / tab capture */}
              <div className={styles.audioControls}>
                <div className={styles.audioRow}>
                  <label className={styles.audioLabel} htmlFor="mic-select">Microphone</label>
                  <select
                    id="mic-select"
                    className={`input ${styles.micSelect}`}
                    value={selectedMicId}
                    onChange={(e) => handleMicChange(e.target.value)}
                    disabled={isProcessing}
                  >
                    {micDevices.length === 0 && (
                      <option value="">No microphone detected</option>
                    )}
                    {micDevices.map((d) => (
                      <option key={d.deviceId} value={d.deviceId}>
                        {d.label}{isHeadsetLikeLabel(d.label) ? ' 🎧' : ''}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    onClick={applyAudioSettings}
                    disabled={isProcessing}
                  >
                    Apply
                  </button>
                </div>

                <label className={styles.tabAudioToggle}>
                  <input
                    type="checkbox"
                    checked={captureTabAudio}
                    onChange={(e) => handleTabAudioToggle(e.target.checked)}
                    disabled={isProcessing}
                  />
                  <span>
                    Also capture system / call audio
                    <small>Required with headphones — when prompted, share your meeting screen/tab and enable &quot;Share system audio&quot;</small>
                  </span>
                </label>

                {tabAudioActive && (
                  <span className={styles.tabAudioBadge}>System audio active</span>
                )}

                {micError && (
                  <div className={styles.micError}>{micError}</div>
                )}

                {micActive && audioLevel < 0.02 && !micError && (
                  <div className={styles.micHint}>
                    No audio detected — speak into your mic, or enable system audio above to capture call audio through headphones.
                  </div>
                )}
              </div>

              <div className={styles.waveWrap}>
                <AudioWaveform isActive={micActive} bars={30} height={64} level={audioLevel} />
              </div>

              {gestureDetected && (
                <div className={`${styles.gestureToast} fade-in-up`}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" />
                  </svg>
                  {gestureDetected}
                </div>
              )}

              <div className={styles.controls}>
                <button className="btn btn-secondary" onClick={handleBookmark} id="btn-bookmark" disabled={isProcessing}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" />
                  </svg>
                  Bookmark
                </button>
                <button
                  type="button"
                  className={`btn btn-secondary ${styles.cancelBtn}`}
                  onClick={handleCancel}
                  id="btn-cancel"
                  disabled={isProcessing}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <line x1="18" y1="6" x2="6" y2="18" />
                    <line x1="6" y1="6" x2="18" y2="18" />
                  </svg>
                  Cancel Meeting
                </button>
                <button
                  className="btn btn-danger"
                  onClick={handleStop}
                  id="btn-stop"
                  disabled={isProcessing}
                  style={{ opacity: isProcessing ? 0.7 : 1, cursor: isProcessing ? 'wait' : 'pointer' }}
                >
                  {isProcessing ? (
                    <>
                      <div style={{ width:12, height:12, border:'2px solid rgba(255,255,255,0.3)', borderTopColor:'#fff', borderRadius:'50%', animation:'spin 0.7s linear infinite' }} />
                      Finishing…
                    </>
                  ) : (
                    <>
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                        <rect x="4" y="4" width="16" height="16" rx="2" />
                      </svg>
                      Stop & Analyze
                    </>
                  )}
                </button>
              </div>
            </div>

            {/* Live transcript */}
            <div className={`glass-card ${styles.transcriptCard}`}>
              <div className={styles.transcriptHeader} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.5rem' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                  <h3>Live Transcript</h3>
                  <span className="badge badge-blue">{transcript.length} lines</span>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    const next = activeSpeaker === 'SPEAKER_1' ? 'SPEAKER_2' : 'SPEAKER_1';
                    setActiveSpeaker(next);
                    currentSpeakerRef.current = next;
                  }}
                  style={{
                    background: activeSpeaker === 'SPEAKER_1' ? 'rgba(79, 142, 247, 0.12)' : 'rgba(245, 158, 11, 0.12)',
                    border: `1px solid ${activeSpeaker === 'SPEAKER_1' ? 'var(--accent-blue)' : 'var(--accent-amber)'}`,
                    color: activeSpeaker === 'SPEAKER_1' ? 'var(--accent-blue)' : 'var(--accent-amber)',
                    borderRadius: '20px',
                    padding: '5px 14px',
                    fontSize: '0.78rem',
                    fontWeight: 600,
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px',
                    transition: 'all 0.2s ease',
                  }}
                  title="Click to toggle active speaker between Sales Rep and Customer"
                >
                  <span>{activeSpeaker === 'SPEAKER_1' ? '🎙 Active: Sales Rep (You)' : `🎤 Active: ${customerLabel}`}</span>
                  <span style={{ fontSize: '0.7rem', opacity: 0.75, textDecoration: 'underline' }}>Switch</span>
                </button>
              </div>
              <div className={styles.transcriptBody} ref={transcriptRef}>
                {transcript.length === 0 && (
                  <p style={{ color:'var(--text-muted)', fontSize:13, textAlign:'center', padding:'24px 0' }}>
                    Transcript will appear as the meeting progresses…
                  </p>
                )}
                {transcript.map((line, i) => (
                  <div
                    key={i}
                    className={`${styles.transcriptLine} fade-in-up`}
                    style={{
                      borderLeft: `3px solid ${line.speaker === 'SPEAKER_1' ? 'var(--accent-blue)' : 'var(--accent-amber)'}`,
                      paddingLeft: '1rem',
                    }}
                  >
                    <button
                      type="button"
                      onClick={() => {
                        // Toggle speaker for this specific line if clicked
                        setTranscript((prev) => {
                          const updated = [...prev];
                          const curSpeaker = updated[i].speaker;
                          updated[i] = {
                            ...updated[i],
                            speaker: curSpeaker === 'SPEAKER_1' ? 'SPEAKER_2' : 'SPEAKER_1',
                          };
                          return updated;
                        });
                      }}
                      style={{
                        background: 'none',
                        border: 'none',
                        padding: 0,
                        fontFamily: 'JetBrains Mono, monospace',
                        fontSize: '0.72rem',
                        fontWeight: 700,
                        letterSpacing: '0.06em',
                        color: line.speaker === 'SPEAKER_1' ? 'var(--accent-blue)' : 'var(--accent-amber)',
                        marginBottom: '0.2rem',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '6px',
                        cursor: 'pointer',
                        textAlign: 'left',
                      }}
                      title="Click to switch who said this"
                    >
                      <span>{line.speaker === 'SPEAKER_1' ? '🎙 Sales Rep (You)' : `🎤 ${customerLabel}`}</span>
                      <span style={{ fontSize: '0.65rem', opacity: 0.55 }}>(swap)</span>
                    </button>
                    <p style={{ margin: 0, fontSize: '0.9rem', lineHeight: 1.6 }}>{line.text}</p>
                  </div>
                ))}

                {/* Live interim "typing" indicator */}
                {interimText && (
                  <div
                    style={{
                      borderLeft: `3px solid ${currentSpeakerRef.current === 'SPEAKER_1' ? 'var(--accent-blue)' : 'var(--accent-amber)'}`,
                      paddingLeft: '1rem',
                      padding: '0.65rem 0.65rem 0.65rem 1rem',
                      background: 'rgba(79,142,247,0.04)',
                      borderRadius: 10,
                      opacity: 0.75,
                    }}
                  >
                    <span style={{
                      fontFamily: 'JetBrains Mono, monospace',
                      fontSize: '0.72rem',
                      fontWeight: 700,
                      letterSpacing: '0.06em',
                      color: currentSpeakerRef.current === 'SPEAKER_1' ? 'var(--accent-blue)' : 'var(--accent-amber)',
                      display: 'block',
                      marginBottom: '0.2rem',
                    }}>
                      {currentSpeakerRef.current === 'SPEAKER_1' ? '🎙 Sales Rep (You)' : `🎤 ${customerLabel}`} · listening…
                    </span>
                    <p style={{ margin: 0, fontSize: '0.9rem', lineHeight: 1.6, color: 'var(--text-muted)', fontStyle: 'italic' }}>
                      {interimText}<span style={{ animation: 'blink 1s step-end infinite', opacity: 1 }}>▋</span>
                    </p>
                  </div>
                )}

              </div>
            </div>
          </div>

          {/* ── Right sidebar ────────────────────────────────────── */}
          <div className={styles.sidebar}>

            {/* Live events */}
            <div className={`glass-card ${styles.eventsCard}`}>
              <div className={styles.eventsHeader}>
                <h3>Detected Events</h3>
                <span className="badge badge-green">{events.length} signals</span>
              </div>
              <div className={styles.eventsList}>
                {events.length === 0 && (
                  <p style={{ color:'var(--text-muted)', fontSize:12, textAlign:'center', padding:16 }}>
                    Listening for business signals…
                  </p>
                )}
                {events.map((evt, i) => (
                  <div key={i} className={`${styles.eventItem} fade-in-up`} style={{ borderColor:evt.color }}>
                    <div className={styles.eventDot} style={{ background:evt.color }} />
                    <div className={styles.eventInfo}>
                      <span className={styles.eventLabel}>{evt.label}</span>
                      <span className={styles.eventTime}>{formatTime(evt.time)}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Voice hints reference */}
            <div className={`glass-card ${styles.voiceHintsCard}`} style={{ padding: '1.25rem' }}>
              <div style={{ fontFamily: 'Outfit', fontWeight: 700, fontSize: '0.9rem', marginBottom: '0.75rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ color: 'var(--accent-amber)' }}>
                  <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
                  <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                </svg>
                Active Voice Cues
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', fontSize: '0.825rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ color: 'var(--text-muted)' }}>Bookmark:</span>
                  <span style={{ fontFamily: 'JetBrains Mono', color: 'var(--accent-amber)', fontWeight: 600 }}>{getBookmarkDisplayLabel(settings)}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ color: 'var(--text-muted)' }}>Stop Meeting:</span>
                  <span style={{ fontFamily: 'JetBrains Mono', color: 'var(--accent-red)', fontWeight: 600 }}>{getStopDisplayLabel(settings)}</span>
                </div>

              </div>
            </div>

            {/* Bookmarks */}
            {bookmarks.length > 0 && (
              <div className={`glass-card ${styles.bookmarksCard}`}>
                <h3>Bookmarks</h3>
                <div className={styles.bookmarkList}>
                  {bookmarks.map((t, i) => (
                    <div key={i} className={styles.bookmarkItem}>
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" />
                      </svg>
                      {formatTime(t)}
                    </div>
                  ))}
                </div>
              </div>
            )}

          </div>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Export: wraps inner in Suspense (required by Next.js for useSearchParams)
// ---------------------------------------------------------------------------
export default function LiveMeetingPage() {
  return (
    <Suspense fallback={
      <div className="page-wrapper">
        <div className="container" style={{ display:'flex', alignItems:'center', justifyContent:'center', minHeight:300 }}>
          <div style={{ textAlign:'center', color:'var(--text-muted)' }}>
            <div style={{ width:36, height:36, border:'3px solid var(--border)', borderTopColor:'var(--accent-blue)', borderRadius:'50%', animation:'spin 0.8s linear infinite', margin:'0 auto 12px' }} />
            Preparing recording session…
          </div>
        </div>
      </div>
    }>
      <LiveMeetingInner />
    </Suspense>
  );
}
