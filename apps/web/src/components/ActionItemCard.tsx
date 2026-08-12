import type { ActionItem } from '@/lib/types';
import { formatTimestamp } from '@/lib/mockData';
import styles from './ActionItemCard.module.css';

interface ActionItemCardProps {
  item: ActionItem;
  onJumpToTime?: (seconds: number) => void;
}

const priorityColors = {
  high: 'badge-red',
  medium: 'badge-amber',
  low: 'badge-blue',
};

const ownerLabels = {
  SALESPERSON: 'You',
  CUSTOMER: 'Customer',
  UNKNOWN: 'TBD',
};

export default function ActionItemCard({ item, onJumpToTime }: ActionItemCardProps) {
  function formatDeadline(d?: string) {
    if (!d) return null;
    return new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
  }

  return (
    <div className={`${styles.card} ${item.completed ? styles.completed : ''}`}>
      <div className={styles.checkbox}>
        {item.completed ? (
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
            <polyline points="20 6 9 17 4 12" />
          </svg>
        ) : null}
      </div>

      <div className={styles.content}>
        <div className={styles.header}>
          <span className={`badge ${priorityColors[item.priority]}`}>{item.priority}</span>
          <span className={styles.owner}>Owner: {ownerLabels[item.owner]}</span>
        </div>

        <p className={styles.title}>{item.title}</p>
        <p className={styles.desc}>{item.description}</p>

        <div className={styles.footer}>
          {item.deadline && (
            <span className={styles.deadline}>
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
                <line x1="16" y1="2" x2="16" y2="6" />
                <line x1="8" y1="2" x2="8" y2="6" />
                <line x1="3" y1="10" x2="21" y2="10" />
              </svg>
              {formatDeadline(item.deadline)}
            </span>
          )}
          <span className={styles.confidence}>
            {Math.round(item.confidence * 100)}% confidence
          </span>
          {item.evidenceTimestamp !== undefined && (
            <button
              type="button"
              className={`btn btn-ghost btn-sm ${styles.jumpBtn}`}
              onClick={() => onJumpToTime?.(item.evidenceTimestamp!)}
              title="Play audio at this moment"
            >
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <polygon points="5 3 19 12 5 21 5 3" />
              </svg>
              {formatTimestamp(item.evidenceTimestamp)}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
