'use client';

import { use, useState, useEffect } from 'react';
import Link from 'next/link';
import { getMeetingById, formatTimestamp, formatDuration, EVENT_TYPE_LABELS, EVENT_TYPE_COLORS, SENTIMENT_LABELS, PURCHASE_INTENT_LABELS } from '@/lib/mockData';
import { apiClient } from '@/lib/api';
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

  useEffect(() => {
    // Try API first, fall back to mock data
    apiClient.getMeeting(id).then((data) => {
      setMeeting(data ?? getMeetingById(id) ?? null);
    }).catch(() => {
      setMeeting(getMeetingById(id) ?? null);
    }).finally(() => setLoading(false));
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

  const { summary, timeline, actionItems, transcript } = meeting;
  const completedActions = actionItems?.filter((a) => a.completed).length ?? 0;

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
            </div>
          </div>
          <div className={styles.headerRight}>
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
              {t === 'actions' && actionItems && (
                <span className={styles.tabCount}>{actionItems.length}</span>
              )}
            </button>
          ))}
        </div>

        {/* Summary Tab */}
        {tab === 'summary' && summary && (
          <div className={`${styles.tabContent} fade-in-up`}>
            <div className={styles.summaryGrid}>
              <div className={`glass-card ${styles.summaryMain}`}>
                <h3>Meeting Overview</h3>
                <p className={styles.overviewText}>{summary.overview}</p>

                <h4 className={styles.sectionLabel}>Objective</h4>
                <p className={styles.objectiveText}>{summary.objective}</p>

                <h4 className={styles.sectionLabel}>Key Discussion Points</h4>
                <ul className={styles.bulletList}>
                  {summary.keyPoints.map((p, i) => (
                    <li key={i}>{p}</li>
                  ))}
                </ul>

                <h4 className={styles.sectionLabel}>Decisions Made</h4>
                <ul className={`${styles.bulletList} ${styles.decisions}`}>
                  {summary.decisions.map((d, i) => (
                    <li key={i}>{d}</li>
                  ))}
                </ul>

                {summary.risks.length > 0 && (
                  <>
                    <h4 className={styles.sectionLabel}>Risks & Mitigation</h4>
                    <ul className={`${styles.bulletList} ${styles.risks}`}>
                      {summary.risks.map((r, i) => (
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
                    {summary.nextSteps.map((s, i) => (
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
                    <span className={`badge ${sentimentColors[summary.customerSentiment]}`}>
                      {SENTIMENT_LABELS[summary.customerSentiment]}
                    </span>
                  </div>
                  <div className={styles.intelRow}>
                    <span>Purchase Intent</span>
                    <span className={`badge ${intentColors[summary.purchaseIntent]}`}>
                      {PURCHASE_INTENT_LABELS[summary.purchaseIntent]}
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
                        <ActionItemCard key={item.id} item={item} />
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
                          <span className={styles.segTime}>
                            {formatTimestamp(seg.startTime)} – {formatTimestamp(seg.endTime)}
                          </span>
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
    </div>
  );
}
