import styles from './AudioWaveform.module.css';

interface AudioWaveformProps {
  isActive?: boolean;
  bars?: number;
  color?: string;
  height?: number;
}

export default function AudioWaveform({
  isActive = false,
  bars = 20,
  color,
  height = 40,
}: AudioWaveformProps) {
  return (
    <div
      className={`${styles.waveform} ${isActive ? styles.active : styles.idle}`}
      style={{ height, '--wave-color': color } as React.CSSProperties}
      aria-label={isActive ? 'Recording active' : 'Audio idle'}
    >
      {Array.from({ length: bars }).map((_, i) => (
        <span
          key={i}
          className={styles.bar}
          style={{
            animationDelay: `${(i * 80) % 600}ms`,
            '--dur': `${700 + (i * 97) % 400}ms`,
            height: '60%',
          } as React.CSSProperties}
        />
      ))}
    </div>
  );
}
