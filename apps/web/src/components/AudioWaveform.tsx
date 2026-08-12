import styles from './AudioWaveform.module.css';

interface AudioWaveformProps {
  isActive?: boolean;
  bars?: number;
  color?: string;
  height?: number;
  /** Live input level 0–1 (from microphone analyser) */
  level?: number;
}

export default function AudioWaveform({
  isActive = false,
  bars = 20,
  color,
  height = 40,
  level = 0,
}: AudioWaveformProps) {
  return (
    <div
      className={`${styles.waveform} ${isActive ? styles.active : styles.idle}`}
      style={{ height, '--wave-color': color } as React.CSSProperties}
      aria-label={isActive ? 'Recording active' : 'Audio idle'}
    >
      {Array.from({ length: bars }).map((_, i) => {
        const center = bars / 2;
        const dist = Math.abs(i - center) / center;
        const barLevel = isActive ? Math.max(0.15, level * (1 - dist * 0.5)) : 0.15;
        return (
          <span
            key={i}
            className={styles.bar}
            style={{
              animationDelay: `${(i * 80) % 600}ms`,
              '--dur': `${700 + (i * 97) % 400}ms`,
              height: `${Math.round(barLevel * 100)}%`,
            } as React.CSSProperties}
          />
        );
      })}
    </div>
  );
}
