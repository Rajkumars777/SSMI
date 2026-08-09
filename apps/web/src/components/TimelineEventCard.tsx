import type { TimelineEvent } from '@/lib/types';
import { formatTimestamp, EVENT_TYPE_LABELS, EVENT_TYPE_COLORS, PURCHASE_INTENT_LABELS } from '@/lib/mockData';
import styles from './TimelineEventCard.module.css';

interface TimelineEventCardProps {
  event: TimelineEvent;
  isActive?: boolean;
  onClick?: () => void;
}

function ImportanceIndicator({ level }: { level: number }) {
  return (
    <div className={styles.importance} title={`Priority Level: ${level}/5`}>
      <span className={styles.importanceLabel}>Priority</span>
      <div className={styles.importanceBars}>
        {Array.from({ length: 5 }).map((_, i) => (
          <span
            key={i}
            className={`${styles.importanceBar} ${i < level ? styles.importanceBarActive : ''}`}
          />
        ))}
      </div>
    </div>
  );
}

export default function TimelineEventCard({ event, isActive, onClick }: TimelineEventCardProps) {
  const color = EVENT_TYPE_COLORS[event.type] || '#4f8ef7';
  const label = EVENT_TYPE_LABELS[event.type] || event.type;

  return (
    <div
      className={`${styles.card} ${isActive ? styles.active : ''}`}
      onClick={onClick}
      style={{ '--event-color': color } as React.CSSProperties}
    >
      <div className={styles.dot} />

      <div className={styles.content}>
        <div className={styles.header}>
          <div className={styles.left}>
            <span className={styles.typeBadge} style={{ color, background: `${color}18`, borderColor: `${color}30` }}>
              {label}
            </span>
            <span className={styles.time}>
              {formatTimestamp(event.startTime)} – {formatTimestamp(event.endTime)}
            </span>
          </div>
          <ImportanceIndicator level={event.importance} />
        </div>

        <h4 className={styles.title}>{event.title}</h4>
        <p className={styles.desc}>{event.description}</p>

        {event.evidence && event.evidence.length > 0 && (
          <div className={styles.evidence}>
            {event.evidence.slice(0, 1).map((e, i) => (
              <blockquote key={i} className={styles.quote}>{e}</blockquote>
            ))}
          </div>
        )}

        <div className={styles.footer}>
          <div className={styles.footerLeft}>
            {event.purchaseIntent && (
              <span className={styles.intent}>
                Intent: {PURCHASE_INTENT_LABELS[event.purchaseIntent]}
              </span>
            )}
            <span className={styles.confidence}>
              {Math.round(event.confidence * 100)}% confidence
            </span>
          </div>
          <button className={`btn btn-ghost btn-sm ${styles.jumpBtn}`}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <polygon points="5 3 19 12 5 21 5 3" />
            </svg>
            Jump to {formatTimestamp(event.startTime)}
          </button>
        </div>
      </div>
    </div>
  );
}
