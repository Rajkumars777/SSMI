import Link from 'next/link';
import type { Meeting } from '@/lib/types';
import { formatDuration, SENTIMENT_LABELS, PURCHASE_INTENT_LABELS } from '@/lib/mockData';
import ProcessingControls from '@/components/ProcessingControls';
import styles from './MeetingCard.module.css';

interface MeetingCardProps {
  meeting: Meeting;
  onDelete?: (id: string) => void;
  onUpdate?: (meeting: Meeting) => void;
  deleting?: boolean;
  selectable?: boolean;
  selected?: boolean;
  onSelectToggle?: () => void;
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

const sentimentColors: Record<string, string> = {
  positive: 'badge-green',
  neutral: 'badge-blue',
  negative: 'badge-red',
  mixed: 'badge-amber',
};

const intentColors: Record<string, string> = {
  very_high: 'badge-green',
  high: 'badge-green',
  medium: 'badge-amber',
  low: 'badge-red',
  none: 'badge-red',
};

export default function MeetingCard({
  meeting,
  onDelete,
  onUpdate,
  deleting = false,
  selectable = false,
  selected = false,
  onSelectToggle,
}: MeetingCardProps) {
  const eventCount = meeting.timeline?.length ?? 0;
  const actionCount = meeting.actionItems?.length ?? 0;
  const showProcessControls = meeting.status === 'recording' || meeting.status === 'processing' || meeting.status === 'failed';

  return (
    <div className={`glass-card glass-card--interactive ${styles.card} ${selected ? styles.cardSelected : ''}`}>
      {selectable && (
        <label className={styles.selectCheckbox} onClick={(e) => e.stopPropagation()}>
          <input
            type="checkbox"
            checked={selected}
            onChange={() => onSelectToggle?.()}
            aria-label={`Select ${meeting.title}`}
          />
        </label>
      )}
      <Link href={`/meeting/${meeting.id}`} className={styles.cardLink}>
        <div className={styles.header}>
          <div className={styles.meta}>
            <span className={styles.company}>{meeting.customerCompany}</span>
            <span className={styles.dot}>·</span>
            <span className={styles.date}>{formatDate(meeting.date)}</span>
          </div>
          <div className={styles.badges}>
            {(meeting.status === 'processing' || meeting.status === 'recording') && (
              <span className="badge badge-amber">
                {meeting.status === 'recording' ? 'Ready to Process' : 'Processing'}
              </span>
            )}
            {meeting.status === 'failed' && (
              <span className="badge badge-red">Failed</span>
            )}
            {meeting.sentiment && (
              <span className={`badge ${sentimentColors[meeting.sentiment]}`}>
                {SENTIMENT_LABELS[meeting.sentiment]}
              </span>
            )}
            {meeting.purchaseIntent && (
              <span className={`badge ${intentColors[meeting.purchaseIntent]}`}>
                Intent: {PURCHASE_INTENT_LABELS[meeting.purchaseIntent]}
              </span>
            )}
          </div>
        </div>

        <h3 className={styles.title}>{meeting.title}</h3>

        {meeting.summary?.overview && (
          <p className={styles.overview}>{meeting.summary.overview}</p>
        )}

        <div className={styles.stats}>
          <div className={styles.stat}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" />
            </svg>
            <span>{formatDuration(meeting.duration)}</span>
          </div>
          <div className={styles.stat}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M3 3h18v18H3z" /><path d="M3 9h18M9 21V9" />
            </svg>
            <span>{eventCount} events</span>
          </div>
          <div className={styles.stat}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polyline points="9 11 12 14 22 4" /><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
            </svg>
            <span>{actionCount} actions</span>
          </div>
          <div className={styles.stat}>
            <span className={`badge ${meeting.processingMode === 'accurate' ? 'badge-violet' : 'badge-blue'}`}>
              {meeting.processingMode === 'accurate' ? 'Max Accuracy' : 'Fast Mode'}
            </span>
          </div>
        </div>

        {meeting.tags && meeting.tags.length > 0 && (
          <div className={styles.tags}>
            {meeting.tags.map((tag) => (
              <span key={tag} className={styles.tag}>{tag}</span>
            ))}
          </div>
        )}

        <div className={styles.arrow}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <polyline points="9 18 15 12 9 6" />
          </svg>
        </div>
      </Link>

      <div className={styles.cardActions}>
        {showProcessControls && (
          <ProcessingControls
            meetingId={meeting.id}
            status={meeting.status}
            onUpdate={onUpdate}
            compact
          />
        )}
        {onDelete && meeting.id && (
          <button
            type="button"
            className={`btn btn-ghost btn-sm ${styles.deleteBtn}`}
            disabled={deleting}
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              if (confirm(`Delete "${meeting.title}"? This cannot be undone.`)) {
                void onDelete(meeting.id);
              }
            }}
          >
            {deleting ? 'Deleting…' : 'Delete'}
          </button>
        )}
      </div>
    </div>
  );
}
