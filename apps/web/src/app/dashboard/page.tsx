import Link from 'next/link';
import MeetingCard from '@/components/MeetingCard';
import { MOCK_MEETINGS, MOCK_STATS, formatDuration } from '@/lib/mockData';
import styles from './page.module.css';

const statCards = [
  {
    label: 'Total Meetings',
    value: MOCK_STATS.totalMeetings,
    suffix: '',
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
        <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
        <circle cx="9" cy="7" r="4" />
        <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
        <path d="M16 3.13a4 4 0 0 1 0 7.75" />
      </svg>
    ),
    color: '#4f8ef7',
  },
  {
    label: 'Action Items',
    value: MOCK_STATS.totalActionItems,
    suffix: '',
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
        <polyline points="9 11 12 14 22 4" />
        <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
      </svg>
    ),
    color: '#22d3a0',
  },
  {
    label: 'Avg Meeting Length',
    value: MOCK_STATS.avgMeetingMinutes,
    suffix: 'min',
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
        <circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" />
      </svg>
    ),
    color: '#f59e0b',
  },
  {
    label: 'Hours Saved',
    value: MOCK_STATS.hoursSaved,
    suffix: 'hrs',
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
        <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
      </svg>
    ),
    color: '#7c5df0',
  },
];

export default function DashboardPage() {
  return (
    <div className={`page-wrapper ${styles.root}`}>
      <div className="container">
        {/* Header */}
        <div className={styles.pageHeader}>
          <div>
            <h1 className={styles.title}>Dashboard</h1>
            <p className={styles.subtitle}>Your meeting intelligence hub</p>
          </div>
          <div className={styles.headerActions}>
            <Link href="/search" className="btn btn-secondary">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
              </svg>
              Search Meetings
            </Link>
            <Link href="/meeting/new" className="btn btn-primary">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <circle cx="12" cy="12" r="6" fill="currentColor" opacity="0.3" />
                <circle cx="12" cy="12" r="3" fill="currentColor" />
              </svg>
              New Meeting
            </Link>
          </div>
        </div>

        {/* Stats */}
        <div className={styles.statsGrid}>
          {statCards.map((s) => (
            <div
              key={s.label}
              className={`glass-card ${styles.statCard}`}
              style={{ '--card-color': s.color } as React.CSSProperties}
            >
              <div className={styles.statIcon} style={{ color: s.color }}>{s.icon}</div>
              <div className={styles.statInfo}>
                <span className={styles.statValue}>
                  {s.value}<span className={styles.statSuffix}>{s.suffix}</span>
                </span>
                <span className={styles.statLabel}>{s.label}</span>
              </div>
            </div>
          ))}
        </div>

        {/* Quick stats row */}
        <div className={styles.quickRow}>
          <div className={`glass-card ${styles.quickCard}`}>
            <div className={styles.quickIcon} style={{ color: 'var(--accent-blue)' }}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
                <line x1="16" y1="2" x2="16" y2="6" />
                <line x1="8" y1="2" x2="8" y2="6" />
                <line x1="3" y1="10" x2="21" y2="10" />
              </svg>
            </div>
            <div>
              <div className={styles.quickVal}>{MOCK_STATS.meetingsThisWeek}</div>
              <div className={styles.quickLabel}>Meetings this week</div>
            </div>
          </div>
          <div className={`glass-card ${styles.quickCard}`}>
            <div className={styles.quickIcon} style={{ color: 'var(--accent-green)' }}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
                <polyline points="22 4 12 14.01 9 11.01" />
              </svg>
            </div>
            <div>
              <div className={styles.quickVal}>{MOCK_STATS.conversionRate}%</div>
              <div className={styles.quickLabel}>Conversion rate</div>
            </div>
          </div>
          <div className={`glass-card ${styles.quickCard} ${styles.voiceHint}`}>
            <div className={styles.quickIcon} style={{ color: 'var(--accent-amber)' }}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
                <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                <line x1="12" y1="19" x2="12" y2="23" />
                <line x1="8" y1="23" x2="16" y2="23" />
              </svg>
            </div>
            <div>
              <div className={styles.quickVal}>Voice Gesture Ready</div>
              <div className={styles.quickLabel}>Whistle to bookmark · Double to stop</div>
            </div>
          </div>
        </div>

        {/* Meetings list */}
        <div className={styles.meetingsSection}>
          <div className={styles.meetingsHeader}>
            <h2>Recent Meetings</h2>
            <div className={styles.meetingsFilters}>
              <span className="badge badge-blue">All</span>
              <span className="badge badge-green" style={{ cursor: 'pointer', opacity: 0.6 }}>High Intent</span>
              <span className="badge badge-amber" style={{ cursor: 'pointer', opacity: 0.6 }}>This Week</span>
            </div>
          </div>
          <div className={styles.meetingsList}>
            {MOCK_MEETINGS.map((m) => (
              <MeetingCard key={m.id} meeting={m} />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
