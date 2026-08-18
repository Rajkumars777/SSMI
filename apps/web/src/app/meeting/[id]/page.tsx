'use client';

import { use, useState, useEffect, useRef, useCallback } from 'react';
import Link from 'next/link';
import { formatTimestamp, formatDuration, EVENT_TYPE_LABELS, EVENT_TYPE_COLORS, SENTIMENT_LABELS, PURCHASE_INTENT_LABELS } from '@/lib/mockData';
import { apiClient } from '@/lib/api';
import ProcessingControls from '@/components/ProcessingControls';
import MeetingAudioPlayer, { type MeetingAudioPlayerHandle } from '@/components/MeetingAudioPlayer';
import type { Meeting } from '@/lib/types';
import TimelineEventCard from '@/components/TimelineEventCard';
import ActionItemCard from '@/components/ActionItemCard';
import styles from './page.module.css';

type Tab = 'summary' | 'timeline' | 'actions' | 'transcript';

const intentColors: Record<string, string> = {
  very_high: 'badge-green',
  high: 'badge-green',
  medium: 'badge-amber',
  low: 'badge-red',
  none: 'badge-red',
};

const sentimentColors: Record<string, string> = {
  positive: 'badge-green',
  neutral: 'badge-blue',
  negative: 'badge-red',
  mixed: 'badge-amber',
};

export default function MeetingDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [meeting, setMeeting] = useState<Meeting | null>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<Tab>('summary');
  const [activeEvent, setActiveEvent] = useState<string | null>(null);
  const [processingElapsed, setProcessingElapsed] = useState(0);
  const [emailDraft, setEmailDraft] = useState<{ subject: string; body: string; toName: string } | null>(null);
  const [emailLoading, setEmailLoading] = useState(false);
  const [emailError, setEmailError] = useState<string | null>(null);
  const [copiedField, setCopiedField] = useState<'subject' | 'body' | 'all' | null>(null);
  const audioPlayerRef = useRef<MeetingAudioPlayerHandle>(null);

  const jumpToTime = useCallback((seconds: number) => {
    audioPlayerRef.current?.playAt(seconds);
  }, []);

  const handleGenerateEmail = useCallback(async () => {
    setEmailLoading(true);
    setEmailError(null);
    try {
      const draft = await apiClient.generateFollowUpEmail(id);
      setEmailDraft(draft);
    } catch (err) {
      setEmailError(err instanceof Error ? err.message : 'Failed to generate email');
    } finally {
      setEmailLoading(false);
    }
  }, [id]);

  const handleCopyEmail = useCallback(async (field: 'subject' | 'body' | 'all') => {
    if (!emailDraft) return;
    const text = field === 'subject'
      ? emailDraft.subject
      : field === 'body'
        ? emailDraft.body
        : `Subject: ${emailDraft.subject}\n\n${emailDraft.body}`;
    try {
      await navigator.clipboard.writeText(text);
      setCopiedField(field);
      setTimeout(() => setCopiedField(null), 2000);
    } catch {
      alert('Could not copy to clipboard');
    }
  }, [emailDraft]);

  useEffect(() => {
    let pollInterval: ReturnType<typeof setInterval> | null = null;
    let timerInterval: ReturnType<typeof setInterval> | null = null;

    const fetchMeeting = async () => {
      try {
        const data = await apiClient.getMeeting(id);
        setMeeting(data);
        setLoading(false);

        // If processing or recording, poll every 3 seconds until completed/failed
        if (data && (data.status === 'processing' || data.status === 'recording')) {
          if (!timerInterval) {
            timerInterval = setInterval(() => {
              setProcessingElapsed((prev) => prev + 1);
            }, 1000);
          }

          if (!pollInterval) {
            pollInterval = setInterval(async () => {
              const updated = await apiClient.getMeeting(id);
              if (updated) {
                setMeeting(updated);
                if (updated.status !== 'processing' && updated.status !== 'recording') {
                  if (pollInterval) clearInterval(pollInterval);
                  if (timerInterval) clearInterval(timerInterval);
                  pollInterval = null;
                  timerInterval = null;
                }
              }
            }, 3000);
          }
        } else {
          if (pollInterval) clearInterval(pollInterval);
          if (timerInterval) clearInterval(timerInterval);
          pollInterval = null;
          timerInterval = null;
        }
      } catch (err) {
        console.error('[SSMI] Error loading meeting detail:', err);
        setLoading(false);
      }
    };

    fetchMeeting();

    return () => {
      if (pollInterval) clearInterval(pollInterval);
      if (timerInterval) clearInterval(timerInterval);
    };
  }, [id]);

  if (loading) {
    return (
      <div className="page-wrapper">
        <div className="container" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: 300 }}>
          <div style={{ textAlign: 'center', color: 'var(--text-muted)' }}>
            <div style={{ width: 40, height: 40, border: '3px solid var(--border)', borderTopColor: 'var(--accent-blue)', borderRadius: '50%', animation: 'spin 0.8s linear infinite', margin: '0 auto 12px' }} />
            Loading meeting intelligence…
          </div>
        </div>
      </div>
    );
  }

  if (!meeting) {
    return (
      <div className="page-wrapper">
        <div className="container">
          <div className={styles.notFound}>
            <h2>Meeting not found</h2>
            <Link href="/dashboard" className="btn btn-primary">Back to Dashboard</Link>
          </div>
        </div>
      </div>
    );
  }

  if (meeting.status === 'failed') {
    return (
      <div className="page-wrapper">
        <div className="container">
          <div className={styles.notFound}>
            <h2>Processing failed</h2>
            <p style={{ color: 'var(--text-muted)', marginBottom: '0.75rem' }}>
              The AI pipeline could not transcribe your audio. No demo/fake data was used.
            </p>
            {meeting.processingError && (
              <div style={{
                marginBottom: '1.25rem',
                padding: '0.85rem 1rem',
                borderRadius: '10px',
                background: 'rgba(239, 68, 68, 0.1)',
                border: '1px solid rgba(239, 68, 68, 0.3)',
                color: '#fca5a5',
                fontSize: '0.9rem',
                textAlign: 'left',
                maxWidth: 560,
                margin: '0 auto 1.25rem',
              }}>
                {meeting.processingError}
              </div>
            )}
            <Link href="/meeting/new" className="btn btn-primary" style={{ marginRight: '0.75rem' }}>Try Again</Link>
            <ProcessingControls
              meetingId={id}
              status="failed"
              onUpdate={(m) => setMeeting(m)}
            />
          </div>
        </div>
      </div>
    );
  }

  const { summary, timeline, actionItems, transcript } = meeting;
  const completedActions = actionItems?.filter((a) => a.completed).length ?? 0;
  const isProcessingStatus = meeting.status === 'processing' || meeting.status === 'recording';
  const awaitingProcess = meeting.status === 'recording';
  const activeSummary = summary;

  const formatSecs = (totalSecs: number) => {
    const m = Math.floor(totalSecs / 60);
    const s = totalSecs % 60;
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  };

  return (
    <div className={`page-wrapper ${styles.root}`}>
      <div className="container">
        {/* Breadcrumb */}
        <div className={styles.breadcrumb}>
          <Link href="/dashboard" className={styles.breadcrumbLink}>Dashboard</Link>
          <span className={styles.breadSep}>›</span>
          <span>{meeting.title}</span>
        </div>

        {/* Header */}
        <div className={`glass-card ${styles.header}`}>
          <div className={styles.headerLeft}>
            <div className={styles.headerMeta}>
              <span className={styles.company}>{meeting.customerCompany}</span>
              <span className={styles.dot}>·</span>
              <span className={styles.date}>
                {new Date(meeting.date).toLocaleDateString('en-IN', {
                  weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
                })}
              </span>
              <span className={styles.dot}>·</span>
              <span>{formatDuration(meeting.duration)}</span>
            </div>
            <h1 className={styles.headerTitle}>{meeting.title}</h1>
            <div className={styles.headerBadges}>
              {meeting.sentiment && (
                <span className={`badge ${sentimentColors[meeting.sentiment]}`}>
                  Sentiment: {SENTIMENT_LABELS[meeting.sentiment]}
                </span>
              )}
              {meeting.purchaseIntent && (
                <span className={`badge ${intentColors[meeting.purchaseIntent]}`}>
                  Purchase Intent: {PURCHASE_INTENT_LABELS[meeting.purchaseIntent]}
                </span>
              )}
              <span className={`badge ${meeting.processingMode === 'accurate' ? 'badge-violet' : 'badge-blue'}`}>
                {meeting.processingMode === 'accurate' ? 'Max Accuracy' : 'Fast Mode'}
              </span>
              {isProcessingStatus && (
                <span className="badge badge-amber">AI Pipeline Processing</span>
              )}
            </div>
          </div>
          <div className={styles.headerRight}>
            {awaitingProcess && (
              <ProcessingControls
                meetingId={id}
                status={meeting.status}
                onUpdate={(m) => setMeeting(m)}
                compact
              />
            )}
            {meeting.status === 'processing' && (
              <button
                type="button"
                className="btn btn-danger"
                style={{ marginRight: '0.75rem', fontSize: '0.85rem' }}
                onClick={async () => {
                  if (!confirm('Stop AI processing?')) return;
                  try {
                    const updated = await apiClient.cancelProcessing(id);
                    setMeeting(updated);
                  } catch {
                    alert('Could not stop processing');
                  }
                }}
              >
                Stop Processing
              </button>
            )}
            {meeting.status === 'completed' && (
              <button
                type="button"
                className="btn btn-secondary"
                style={{ marginRight: '0.75rem', fontSize: '0.85rem' }}
                onClick={async () => {
                  try {
                    await apiClient.reprocessMeeting(id);
                    setMeeting({ ...meeting, status: 'processing' });
                    window.location.reload();
                  } catch {
                    alert('Reprocess failed. Restart backend using start-backend.bat');
                  }
                }}
              >
                Reprocess Audio
              </button>
            )}
            {meeting.status === 'completed' && activeSummary && (
              <button
                type="button"
                className="btn btn-primary"
                style={{ marginRight: '0.75rem', fontSize: '0.85rem' }}
                onClick={handleGenerateEmail}
                disabled={emailLoading}
              >
                {emailLoading ? 'Generating…' : 'Follow-Up Email'}
              </button>
            )}
            <div className={styles.headerStat}>
              <div className={styles.headerStatVal}>{timeline?.length ?? 0}</div>
              <div className={styles.headerStatLab}>Events</div>
            </div>
            <div className={styles.headerStat}>
              <div className={styles.headerStatVal}>{actionItems?.length ?? 0}</div>
              <div className={styles.headerStatLab}>Actions</div>
            </div>
            <div className={styles.headerStat}>
              <div className={styles.headerStatVal}>{completedActions}</div>
              <div className={styles.headerStatLab}>Completed</div>
            </div>
          </div>
        </div>

        {(meeting.status === 'completed' || meeting.status === 'recording') && (
          <MeetingAudioPlayer ref={audioPlayerRef} meetingId={id} />
        )}

        {/* Tabs */}
        <div className={`tabs ${styles.tabs}`}>
          {(['summary', 'timeline', 'actions', 'transcript'] as Tab[]).map((t) => (
            <button
              key={t}
              className={`tab-btn ${tab === t ? 'active' : ''}`}
              onClick={() => setTab(t)}
              id={`tab-${t}`}
            >
              {t.charAt(0).toUpperCase() + t.slice(1)}
              {t === 'actions' && actionItems && actionItems.length > 0 && (
                <span className={styles.tabCount}>{actionItems.length}</span>
              )}
            </button>
          ))}
        </div>

        {/* Real-time processing banner when transcript is ready but LLM is still running */}
        {isProcessingStatus && transcript && transcript.length > 0 && !activeSummary && (
          <div style={{
            marginBottom: '1.25rem',
            padding: '0.85rem 1.25rem',
            borderRadius: '10px',
            background: 'rgba(16, 185, 129, 0.12)',
            border: '1px solid rgba(16, 185, 129, 0.35)',
            color: '#10b981',
            fontSize: '0.9rem',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '1rem',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
              <span style={{ fontSize: '1.1rem' }}>⚡</span>
              <div>
                <strong>Live transcript ready!</strong> Captured <strong>{transcript.length} segments</strong> during the meeting.
                <span style={{ color: 'var(--text-secondary)', marginLeft: '0.5rem' }}>
                  Qwen 14B is generating the summary, timeline, and action items — view the Transcript tab now.
                </span>
              </div>
            </div>
            <button
              className="btn btn-secondary"
              style={{ fontSize: '0.8rem', padding: '0.35rem 0.75rem', whiteSpace: 'nowrap' }}
              onClick={() => setTab('transcript')}
            >
              View Live Transcript →
            </button>
          </div>
        )}

        {/* Awaiting process — audio uploaded but pipeline not started */}
        {awaitingProcess && (
          <div className={`${styles.processingCard} fade-in-up`}>
            <div className={styles.processingHeader}>
              <h2 className={styles.processingTitle}>Audio Ready for Processing</h2>
              <p className={styles.processingSubtitle}>
                Your recording has been saved. Start AI processing to transcribe the audio and generate the intelligence report.
              </p>
              <ProcessingControls
                meetingId={id}
                status={meeting.status}
                onUpdate={(m) => setMeeting(m)}
              />
            </div>
          </div>
        )}

        {/* Dedicated Audio Processing Screen */}
        {meeting.status === 'processing' && !activeSummary && (
          <div className={`${styles.processingCard} fade-in-up`}>
            <div className={styles.processingHeader}>
              <div className={styles.processingSpinnerWrap}>
                <div className={styles.processingSpinner} />
                <div className={styles.processingIcon}>
                  <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M12 2a10 10 0 0 0 0 20 10 10 0 0 0 0-20z" opacity="0.2" />
                    <path d="M12 6v6l4 2" />
                  </svg>
                </div>
              </div>
              <h2 className={styles.processingTitle}>
                {transcript && transcript.length > 0
                  ? 'Step 4/4: Generating AI Intelligence…'
                  : 'Processing Audio Recording…'}
              </h2>
              <p className={styles.processingSubtitle}>
                {transcript && transcript.length > 0
                  ? `Using your live transcript (${transcript.length} segments). Qwen 2.5 14B is extracting key points, sentiment, and action items — Whisper was skipped.`
                  : 'SSMI AI Pipeline is running Speech-to-Text (Whisper) and Qwen 14B intelligence extraction (Diarization on hold).'}
              </p>

              <div className={styles.processingTimeBadge} style={{ marginTop: '0.75rem' }}>
                <span>Elapsed: <strong>{formatSecs(processingElapsed)}</strong></span>
                <span style={{ opacity: 0.5 }}>·</span>
                <span style={{ color: 'var(--text-accent)' }}>
                  {transcript && transcript.length > 0
                    ? '🤖 Qwen 14B Generating Summary & Actions…'
                    : '🎙️ Transcribing Audio on GPU (Whisper)…'}
                </span>
              </div>
            </div>

            {/* AI Pipeline Stepper — driven by REAL backend state */}
            <div className={styles.pipelineStepper}>
              <div className={`${styles.pipelineStep} ${styles.stepActive}`}>
                <div className={`${styles.stepIcon} ${styles.stepIconActive}`}>✓</div>
                <div className={styles.stepLabel}>Audio Storage</div>
                <div className={styles.stepDetail}>File Saved ✓</div>
              </div>
              <div className={`${styles.pipelineStep} ${transcript && transcript.length > 0 ? styles.stepActive : ''}`}>
                <div className={`${styles.stepIcon} ${transcript && transcript.length > 0 ? styles.stepIconActive : ''}`}>
                  {transcript && transcript.length > 0 ? '✓' : '2'}
                </div>
                <div className={styles.stepLabel}>Transcription</div>
                <div className={styles.stepDetail}>
                  {transcript && transcript.length > 0
                    ? `${transcript.length} Segments ✓`
                    : 'Whisper GPU Running…'}
                </div>
              </div>
              <div className={`${styles.pipelineStep} ${transcript && transcript.length > 0 ? styles.stepActive : ''}`}>
                <div className={`${styles.stepIcon} ${transcript && transcript.length > 0 ? styles.stepIconActive : ''}`}>
                  {transcript && transcript.length > 0 ? '✓' : '⏸'}
                </div>
                <div className={styles.stepLabel}>Diarization</div>
                <div className={styles.stepDetail}>
                  Held / Skipped
                </div>
              </div>
              <div className={`${styles.pipelineStep} ${activeSummary ? styles.stepActive : ''}`}>
                <div className={`${styles.stepIcon} ${activeSummary ? styles.stepIconActive : ''}`}>
                  {activeSummary ? '✓' : '4'}
                </div>
                <div className={styles.stepLabel}>AI Intelligence</div>
                <div className={styles.stepDetail}>
                  {activeSummary
                    ? 'Summary & Actions ✓'
                    : (transcript && transcript.length > 0 ? 'Qwen 14B Running…' : 'Queued')}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Summary Tab */}
        {tab === 'summary' && activeSummary && (
          <div className={`${styles.tabContent} fade-in-up`}>
            <div className={styles.summaryGrid}>
              <div className={`glass-card ${styles.summaryMain}`}>
                <h3>Meeting Overview</h3>
                <p className={styles.overviewText}>{activeSummary.overview}</p>

                <h4 className={styles.sectionLabel}>Objective</h4>
                <p className={styles.objectiveText}>{activeSummary.objective}</p>

                <h4 className={styles.sectionLabel}>Key Discussion Points</h4>
                <ul className={styles.bulletList}>
                  {(activeSummary.keyPoints ?? []).map((p, i) => (
                    <li key={i}>{p}</li>
                  ))}
                </ul>

                <h4 className={styles.sectionLabel}>Decisions Made</h4>
                <ul className={`${styles.bulletList} ${styles.decisions}`}>
                  {(activeSummary.decisions ?? []).map((d, i) => (
                    <li key={i}>{d}</li>
                  ))}
                </ul>

                {activeSummary.risks && activeSummary.risks.length > 0 && (
                  <>
                    <h4 className={styles.sectionLabel}>Risks & Mitigation</h4>
                    <ul className={`${styles.bulletList} ${styles.risks}`}>
                      {activeSummary.risks.map((r, i) => (
                        <li key={i}>{r}</li>
                      ))}
                    </ul>
                  </>
                )}
              </div>

              <div className={styles.summaryRight}>
                <div className={`glass-card ${styles.nextSteps}`}>
                  <h4>Next Steps</h4>
                  <div className={styles.nextStepsList}>
                    {(activeSummary.nextSteps ?? []).map((s, i) => (
                      <div key={i} className={styles.nextStep}>
                        <div className={styles.nextStepNum}>{i + 1}</div>
                        <span>{s}</span>
                      </div>
                    ))}
                  </div>
                </div>

                <div className={`glass-card ${styles.intelCard}`}>
                  <h4>AI Intelligence</h4>
                  <div className={styles.intelRow}>
                    <span>Customer Sentiment</span>
                    <span className={`badge ${sentimentColors[activeSummary.customerSentiment]}`}>
                      {SENTIMENT_LABELS[activeSummary.customerSentiment]}
                    </span>
                  </div>
                  <div className={styles.intelRow}>
                    <span>Purchase Intent</span>
                    <span className={`badge ${intentColors[activeSummary.purchaseIntent]}`}>
                      {PURCHASE_INTENT_LABELS[activeSummary.purchaseIntent]}
                    </span>
                  </div>
                  <div className={styles.intelRow}>
                    <span>Events Detected</span>
                    <span className="badge badge-blue">{timeline?.length ?? 0}</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}


        {/* Timeline Tab */}
        {tab === 'timeline' && (
          <div className={`${styles.tabContent} fade-in-up`}>
            {!timeline || timeline.length === 0 ? (
              <div className={styles.empty}>No events detected</div>
            ) : (
              <div className={styles.timelineWrap}>
                <div className={styles.timelineHeader}>
                  <h3>AI-Generated Timeline</h3>
                  <p>Click any event to jump directly to that moment</p>
                </div>
                <div className="timeline-track">
                  <div className={styles.timelineList}>
                    {timeline.map((evt) => (
                      <TimelineEventCard
                        key={evt.id}
                        event={evt}
                        isActive={activeEvent === evt.id}
                        onClick={() => setActiveEvent(activeEvent === evt.id ? null : evt.id)}
                        onJumpToTime={jumpToTime}
                      />
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Action Items Tab */}
        {tab === 'actions' && (
          <div className={`${styles.tabContent} fade-in-up`}>
            <div className={styles.actionsHeader}>
              <h3>Action Items</h3>
              <span className={styles.actionsProgress}>
                {completedActions} / {actionItems?.length ?? 0} completed
              </span>
            </div>
            {!actionItems || actionItems.length === 0 ? (
              <div className={styles.empty}>No action items extracted</div>
            ) : (
              <div className={styles.actionsList}>
                {['high', 'medium', 'low'].map((priority) => {
                  const items = actionItems.filter((a) => a.priority === priority);
                  if (items.length === 0) return null;
                  return (
                    <div key={priority} className={styles.actionsGroup}>
                      <div className={styles.actionsGroupLabel}>
                        <span className={`badge badge-${priority === 'high' ? 'red' : priority === 'medium' ? 'amber' : 'blue'}`}>
                          {priority.toUpperCase()} PRIORITY
                        </span>
                      </div>
                      {items.map((item) => (
                        <ActionItemCard key={item.id} item={item} onJumpToTime={jumpToTime} />
                      ))}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* Transcript Tab */}
        {tab === 'transcript' && (
          <div className={`${styles.tabContent} fade-in-up`}>
            <div className={`glass-card ${styles.transcriptWrap}`}>
              <div className={styles.transcriptHead}>
                <h3>Full Transcript</h3>
                <span className="badge badge-blue">Speaker Diarised</span>
              </div>
              {!transcript || transcript.length === 0 ? (
                <div className={styles.empty}>No transcript available</div>
              ) : (
                <div className={styles.transcriptList}>
                  {transcript.map((seg) => {
                    const linkedEvent = timeline?.find((e) => e.id === seg.eventId);
                    return (
                      <div
                        key={seg.id}
                        className={`${styles.transcriptSeg} ${linkedEvent ? styles.linked : ''}`}
                        style={linkedEvent ? { '--seg-color': EVENT_TYPE_COLORS[linkedEvent.type] } as React.CSSProperties : {}}
                      >
                        <div className={styles.segMeta}>
                          <span className={`${styles.segSpeaker} ${seg.speaker === 'CUSTOMER' ? styles.segCustomer : styles.segSales}`}>
                            {seg.speaker === 'CUSTOMER' ? 'Customer' : 'Salesperson'}
                          </span>
                          <button
                            type="button"
                            className={styles.segTimeBtn}
                            onClick={() => jumpToTime(seg.startTime)}
                            title="Play audio from here"
                          >
                            {formatTimestamp(seg.startTime)} – {formatTimestamp(seg.endTime)}
                          </button>
                          {linkedEvent && (
                            <span className={styles.segEvent} style={{ color: EVENT_TYPE_COLORS[linkedEvent.type] }}>
                              {EVENT_TYPE_LABELS[linkedEvent.type]}
                            </span>
                          )}
                        </div>
                        <p className={styles.segText}>{seg.text}</p>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Follow-up email modal */}
      {(emailDraft || emailError) && (
        <div className={styles.emailOverlay} onClick={() => { setEmailDraft(null); setEmailError(null); }}>
          <div className={`glass-card ${styles.emailModal}`} onClick={(e) => e.stopPropagation()}>
            <div className={styles.emailModalHeader}>
              <div>
                <h2 className={styles.emailModalTitle}>Follow-Up Email Draft</h2>
                {emailDraft && (
                  <p className={styles.emailModalSub}>
                    To: {emailDraft.toName || meeting.customerName}
                  </p>
                )}
              </div>
              <button
                type="button"
                className={styles.emailCloseBtn}
                onClick={() => { setEmailDraft(null); setEmailError(null); }}
                aria-label="Close"
              >
                ×
              </button>
            </div>

            {emailError && (
              <div className={styles.emailError}>{emailError}</div>
            )}

            {emailDraft && (
              <>
                <div className={styles.emailField}>
                  <div className={styles.emailFieldHead}>
                    <label>Subject</label>
                    <button
                      type="button"
                      className="btn btn-secondary"
                      style={{ fontSize: '0.75rem', padding: '0.25rem 0.6rem' }}
                      onClick={() => handleCopyEmail('subject')}
                    >
                      {copiedField === 'subject' ? 'Copied!' : 'Copy'}
                    </button>
                  </div>
                  <div className={styles.emailSubject}>{emailDraft.subject}</div>
                </div>

                <div className={styles.emailField}>
                  <div className={styles.emailFieldHead}>
                    <label>Body</label>
                    <button
                      type="button"
                      className="btn btn-secondary"
                      style={{ fontSize: '0.75rem', padding: '0.25rem 0.6rem' }}
                      onClick={() => handleCopyEmail('body')}
                    >
                      {copiedField === 'body' ? 'Copied!' : 'Copy'}
                    </button>
                  </div>
                  <textarea
                    className={styles.emailBody}
                    readOnly
                    value={emailDraft.body}
                    rows={16}
                  />
                </div>

                <div className={styles.emailActions}>
                  <button
                    type="button"
                    className="btn btn-primary"
                    onClick={() => handleCopyEmail('all')}
                  >
                    {copiedField === 'all' ? 'Copied to Clipboard!' : 'Copy Full Email'}
                  </button>
                  <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={() => { setEmailDraft(null); setEmailError(null); }}
                  >
                    Close
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
