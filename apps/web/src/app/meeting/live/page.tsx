'use client';

import { useState, useEffect, useRef, useCallback, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import AudioWaveform from '@/components/AudioWaveform';
import { apiClient } from '@/lib/api';
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
// Demo data (used when backend is unreachable)
// ---------------------------------------------------------------------------
const DEMO_EVENTS: LiveEvent[] = [
  { time: 8,  type: 'REQUIREMENT', label: 'Customer Requirement', color: '#4f8ef7' },
  { time: 18, type: 'BUDGET',      label: 'Budget Disclosed',      color: '#f59e0b' },
  { time: 32, type: 'OBJECTION',   label: 'Pricing Objection',     color: '#ef4444' },
  { time: 48, type: 'NEGOTIATION', label: 'Discount Negotiation',  color: '#a855f7' },
  { time: 65, type: 'DECISION',    label: 'POC Agreement',         color: '#22d3a0' },
];

const DEMO_LINES: LiveTranscriptLine[] = [
  { speaker: 'SALESPERSON', text: 'Good morning! Thanks for joining. Let me walk you through SSMI.' },
  { speaker: 'CUSTOMER',    text: "We've been looking for exactly this kind of solution." },
  { speaker: 'SALESPERSON', text: 'Can you share your team size and current tooling?' },
  { speaker: 'CUSTOMER',    text: 'Around 5,000 users across India and Southeast Asia.' },
  { speaker: 'SALESPERSON', text: 'Great. Let me walk you through our enterprise pricing.' },
  { speaker: 'CUSTOMER',    text: 'Our annual budget is around $120,000 including implementation.' },
  { speaker: 'SALESPERSON', text: 'That aligns with our enterprise tier. Here are the details.' },
  { speaker: 'CUSTOMER',    text: 'VoiceAI Pro quotes 20% less — can you match that?' },
  { speaker: 'SALESPERSON', text: 'Our AI accuracy significantly outperforms. Let me check options.' },
];

// ---------------------------------------------------------------------------
// Inner component (uses useSearchParams — must live inside <Suspense>)
// ---------------------------------------------------------------------------
function LiveMeetingInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const meetingId = searchParams.get('id') || 'live_session';

  const [elapsed, setElapsed]                   = useState(0);
  const [events, setEvents]                     = useState<LiveEvent[]>([]);
  const [transcript, setTranscript]             = useState<LiveTranscriptLine[]>([]);
  const [bookmarks, setBookmarks]               = useState<number[]>([]);
  const [gestureDetected, setGestureDetected]   = useState<string | null>(null);
  const [connectionStatus, setConnectionStatus] = useState<'connecting' | 'connected' | 'offline'>('connecting');

  const transcriptRef    = useRef<HTMLDivElement>(null);
  const wsRef            = useRef<WebSocket | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const streamRef        = useRef<MediaStream | null>(null);
  const demoTimersRef    = useRef<ReturnType<typeof setTimeout>[]>([]);

  // ── Timer ─────────────────────────────────────────────────────────────────
  useEffect(() => {
    const interval = setInterval(() => setElapsed((e) => e + 1), 1000);
    return () => clearInterval(interval);
  }, []);

  // ── Offline Demo ───────────────────────────────────────────────────────────
  const startOfflineDemo = useCallback(() => {
    demoTimersRef.current.forEach(clearTimeout);
    demoTimersRef.current = [];
    setConnectionStatus('offline');

    DEMO_EVENTS.forEach((evt) => {
      const t = setTimeout(() => setEvents((prev) => [...prev, evt]), evt.time * 1000);
      demoTimersRef.current.push(t);
    });

    DEMO_LINES.forEach((line, i) => {
      const t = setTimeout(() => {
        setTranscript((prev) => [...prev, line]);
        setTimeout(() => transcriptRef.current?.scrollTo({ top: 99999, behavior: 'smooth' }), 50);
      }, (i * 7 + 3) * 1000);
      demoTimersRef.current.push(t);
    });
  }, []);

  // ── Microphone ────────────────────────────────────────────────────────────
  const startMicrophoneStream = useCallback(async (ws: WebSocket) => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const recorder = new MediaRecorder(stream, { mimeType: 'audio/webm;codecs=opus' });
      mediaRecorderRef.current = recorder;
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0 && ws.readyState === WebSocket.OPEN) ws.send(e.data);
      };
      recorder.start(250);
    } catch {
      startOfflineDemo();
    }
  }, [startOfflineDemo]);

  // ── WebSocket ─────────────────────────────────────────────────────────────
  useEffect(() => {
    let ws: WebSocket;

    try {
      ws = apiClient.connectWebSocket(
        meetingId,
        (msg) => {
          if (msg.type === 'event' || msg.event_type === 'LIVE_BUSINESS_EVENT') {
            setEvents((prev) => [...prev, {
              time: Math.floor(Date.now() / 1000),
              type: msg.type || msg.event_type,
              label: msg.title || msg.type || 'Signal Detected',
              color: EVENT_COLORS[msg.type || msg.event_type] || '#4f8ef7',
            }]);
          } else if (msg.type === 'transcript') {
            setTranscript((prev) => [...prev, { speaker: msg.speaker || 'UNKNOWN', text: msg.text }]);
            setTimeout(() => transcriptRef.current?.scrollTo({ top: 99999, behavior: 'smooth' }), 50);
          } else if (msg.type === 'gesture' || msg.event_type === 'GESTURE_DETECTED') {
            const gesture = msg.gesture?.toLowerCase() || '';
            setGestureDetected(gesture === 'bookmark' ? `Bookmarked at ${formatTime(elapsed)}` : 'Stopped');
            setTimeout(() => setGestureDetected(null), 2500);
            if (gesture === 'bookmark') setBookmarks((b) => [...b, elapsed]);
          }
        },
        () => startOfflineDemo()
      );

      ws.onopen = () => {
        setConnectionStatus('connected');
        startMicrophoneStream(ws);
      };

      ws.onclose = () => startOfflineDemo();
      wsRef.current = ws;
    } catch {
      startOfflineDemo();
    }

    return () => {
      wsRef.current?.close();
      mediaRecorderRef.current?.stop();
      streamRef.current?.getTracks().forEach((t) => t.stop());
      demoTimersRef.current.forEach(clearTimeout);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [meetingId]);

  // ── Controls ──────────────────────────────────────────────────────────────
  function handleBookmark() {
    setBookmarks((b) => [...b, elapsed]);
    setGestureDetected(`Bookmarked at ${formatTime(elapsed)}`);
    setTimeout(() => setGestureDetected(null), 2500);
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'bookmark', timestamp: elapsed }));
    }
  }

  function handleStop() {
    mediaRecorderRef.current?.stop();
    streamRef.current?.getTracks().forEach((t) => t.stop());
    wsRef.current?.close();
    router.push(`/meeting/${meetingId !== 'live_session' ? meetingId : 'meeting_001'}`);
  }

  const statusColors = { connecting: '#f59e0b', connected: '#22d3a0', offline: '#6b7280' };
  const statusLabels = { connecting: 'Connecting to AI…', connected: 'Live — AI Active', offline: 'Demo Mode (offline)' };

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

              <div className={styles.waveWrap}>
                <AudioWaveform isActive bars={30} height={64} />
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
                <button className="btn btn-secondary" onClick={handleBookmark} id="btn-bookmark">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" />
                  </svg>
                  Bookmark
                </button>
                <button className="btn btn-danger" onClick={handleStop} id="btn-stop">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                    <rect x="4" y="4" width="16" height="16" rx="2" />
                  </svg>
                  Stop Recording
                </button>
              </div>
            </div>

            {/* Live transcript */}
            <div className={`glass-card ${styles.transcriptCard}`}>
              <div className={styles.transcriptHeader}>
                <h3>Live Transcript</h3>
                <span className="badge badge-blue">{transcript.length} lines</span>
              </div>
              <div className={styles.transcriptBody} ref={transcriptRef}>
                {transcript.length === 0 && (
                  <p style={{ color:'var(--text-muted)', fontSize:13, textAlign:'center', padding:'24px 0' }}>
                    Transcript will appear as the meeting progresses…
                  </p>
                )}
                {transcript.map((line, i) => (
                  <div key={i} className={`${styles.transcriptLine} ${line.speaker === 'CUSTOMER' ? styles.customer : styles.salesperson}`}>
                    <span className={styles.speakerBadge}>{line.speaker === 'CUSTOMER' ? 'Customer' : 'You'}</span>
                    <p>{line.text}</p>
                  </div>
                ))}
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
