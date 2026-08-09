'use client';

import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import AudioWaveform from '@/components/AudioWaveform';
import styles from './page.module.css';

const MOCK_EVENTS = [
  { time: 8, type: 'REQUIREMENT', label: 'Customer Requirement', color: '#4f8ef7' },
  { time: 18, type: 'BUDGET', label: 'Budget Disclosed', color: '#f59e0b' },
  { time: 32, type: 'OBJECTION', label: 'Pricing Objection', color: '#ef4444' },
  { time: 48, type: 'NEGOTIATION', label: 'Discount Negotiation', color: '#a855f7' },
  { time: 65, type: 'DECISION', label: 'POC Agreement', color: '#22d3a0' },
];

const MOCK_TRANSCRIPT_LINES = [
  { speaker: 'SALESPERSON', text: 'Good morning! Thanks for joining today. I\'m excited to walk you through SSMI.', delay: 3 },
  { speaker: 'CUSTOMER', text: 'Thanks! We\'ve been looking for something exactly like this.', delay: 8 },
  { speaker: 'SALESPERSON', text: 'Can you tell me about your team size and current tooling?', delay: 13 },
  { speaker: 'CUSTOMER', text: 'We have around 5,000 users across India and Southeast Asia.', delay: 18 },
  { speaker: 'SALESPERSON', text: 'That\'s a significant deployment. Let me walk you through our enterprise pricing.', delay: 24 },
  { speaker: 'CUSTOMER', text: 'Our annual budget for this is around $120,000 including implementation.', delay: 30 },
  { speaker: 'SALESPERSON', text: 'Perfect. That aligns well with our enterprise tier. Let me share the details.', delay: 38 },
  { speaker: 'CUSTOMER', text: 'VoiceAI Pro is quoting us 20% less — can you match that?', delay: 45 },
  { speaker: 'SALESPERSON', text: 'I understand. Our AI accuracy significantly outperforms competitors. Let me see what I can do.', delay: 52 },
];

function formatTime(s: number) {
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
}

export default function LiveMeetingPage() {
  const router = useRouter();
  const [elapsed, setElapsed] = useState(0);
  const [events, setEvents] = useState<typeof MOCK_EVENTS>([]);
  const [transcript, setTranscript] = useState<typeof MOCK_TRANSCRIPT_LINES>([]);
  const [bookmarks, setBookmarks] = useState<number[]>([]);
  const [gestureDetected, setGestureDetected] = useState<string | null>(null);
  const transcriptRef = useRef<HTMLDivElement>(null);

  // Timer
  useEffect(() => {
    const interval = setInterval(() => setElapsed((e) => e + 1), 1000);
    return () => clearInterval(interval);
  }, []);

  // Simulated events appearing
  useEffect(() => {
    MOCK_EVENTS.forEach((evt) => {
      const t = setTimeout(() => {
        setEvents((prev) => [...prev, evt]);
      }, evt.time * 1000);
      return () => clearTimeout(t);
    });
  }, []);

  // Simulated transcript
  useEffect(() => {
    MOCK_TRANSCRIPT_LINES.forEach((line) => {
      const t = setTimeout(() => {
        setTranscript((prev) => [...prev, line]);
        setTimeout(() => {
          transcriptRef.current?.scrollTo({ top: 99999, behavior: 'smooth' });
        }, 50);
      }, line.delay * 1000);
      return () => clearTimeout(t);
    });
  }, []);

  function handleBookmark() {
    setBookmarks((b) => [...b, elapsed]);
    setGestureDetected('Bookmarked at ' + formatTime(elapsed));
    setTimeout(() => setGestureDetected(null), 2500);
  }

  function handleStop() {
    router.push('/meeting/meeting_001');
  }

  return (
    <div className={`page-wrapper ${styles.root}`}>
      <div className="container">
        <div className={styles.layout}>
          {/* Left: recording + transcript */}
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
                <span className="badge badge-blue">AI Processing</span>
              </div>
              <div className={styles.transcriptFeed} ref={transcriptRef}>
                {transcript.length === 0 ? (
                  <div className={styles.transcriptEmpty}>
                    <div className="spinner" />
                    <span>Waiting for speech...</span>
                  </div>
                ) : (
                  transcript.map((line, i) => (
                    <div key={i} className={`${styles.transcriptLine} fade-in-up`}>
                      <span className={`${styles.tSpeaker} ${line.speaker === 'CUSTOMER' ? styles.tCustomer : styles.tSales}`}>
                        {line.speaker === 'CUSTOMER' ? 'Customer' : 'You'}
                      </span>
                      <p className={styles.tText}>{line.text}</p>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>

          {/* Right: events sidebar */}
          <div className={styles.sidebar}>
            <div className={`glass-card ${styles.eventsCard}`}>
              <div className={styles.eventsHeader}>
                <h3>Live Events</h3>
                <span className={styles.eventsCount}>{events.length} detected</span>
              </div>

              <div className={styles.eventsList}>
                {events.length === 0 ? (
                  <div className={styles.eventsEmpty}>
                    <div className={styles.eventsEmptyDots}>
                      {[0, 1, 2].map((i) => (
                        <div key={i} className={styles.emptyDot} style={{ animationDelay: `${i * 300}ms` }} />
                      ))}
                    </div>
                    <span>Analysing conversation...</span>
                  </div>
                ) : (
                  events.map((evt, i) => (
                    <div key={i} className={`${styles.eventItem} fade-in-up`} style={{ '--ev-color': evt.color } as React.CSSProperties}>
                      <div className={styles.evDot} style={{ background: evt.color }} />
                      <div>
                        <div className={styles.evType} style={{ color: evt.color }}>{evt.label}</div>
                        <div className={styles.evTime}>{formatTime(evt.time)}</div>
                      </div>
                    </div>
                  ))
                )}
              </div>

              {bookmarks.length > 0 && (
                <div className={styles.bookmarks}>
                  <div className={styles.bookmarksLabel}>Bookmarks</div>
                  {bookmarks.map((b, i) => (
                    <div key={i} className={styles.bookmark}>{formatTime(b)}</div>
                  ))}
                </div>
              )}
            </div>

            {/* Voice hints */}
            <div className={`glass-card ${styles.voiceHints}`}>
              <h4 className={styles.voiceTitle}>Voice Gestures</h4>
              <div className={styles.voiceHintItem}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ color: 'var(--accent-amber)' }}>
                  <path d="M9 18V5l12-2v13" />
                  <circle cx="6" cy="18" r="3" />
                  <circle cx="18" cy="16" r="3" />
                </svg>
                <span>Whistle → Bookmark</span>
              </div>
              <div className={styles.voiceHintItem}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ color: 'var(--accent-amber)' }}>
                  <path d="M9 18V5l12-2v13" />
                  <circle cx="6" cy="18" r="3" />
                  <circle cx="18" cy="16" r="3" />
                </svg>
                <span>Double Whistle → Stop</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
