'use client';

import { forwardRef, useImperativeHandle, useRef, useState, useEffect, useCallback } from 'react';
import { formatTimestamp } from '@/lib/mockData';
import { apiClient } from '@/lib/api';
import styles from './MeetingAudioPlayer.module.css';

export interface MeetingAudioPlayerHandle {
  playAt: (seconds: number) => void;
}

interface MeetingAudioPlayerProps {
  meetingId: string;
}

const MeetingAudioPlayer = forwardRef<MeetingAudioPlayerHandle, MeetingAudioPlayerProps>(
  function MeetingAudioPlayer({ meetingId }, ref) {
    const audioRef = useRef<HTMLAudioElement>(null);
    const [available, setAvailable] = useState(true);
    const [playing, setPlaying] = useState(false);
    const [currentTime, setCurrentTime] = useState(0);
    const [duration, setDuration] = useState(0);
    const [loading, setLoading] = useState(true);

    const audioUrl = apiClient.getMeetingAudioUrl(meetingId);

    const playAt = useCallback((seconds: number) => {
      const audio = audioRef.current;
      if (!audio || !available) return;
      const t = Math.max(0, seconds);
      audio.currentTime = t;
      setCurrentTime(t);
      audio.play().catch((err) => console.warn('[SSMI Audio] Play failed:', err));
    }, [available]);

    useImperativeHandle(ref, () => ({ playAt }), [playAt]);

    useEffect(() => {
      const audio = audioRef.current;
      if (!audio) return;

      const onTimeUpdate = () => setCurrentTime(audio.currentTime);
      const onDurationChange = () => setDuration(audio.duration || 0);
      const onPlay = () => setPlaying(true);
      const onPause = () => setPlaying(false);
      const onCanPlay = () => { setLoading(false); setAvailable(true); };
      const onError = () => { setAvailable(false); setLoading(false); };

      audio.addEventListener('timeupdate', onTimeUpdate);
      audio.addEventListener('durationchange', onDurationChange);
      audio.addEventListener('loadedmetadata', onDurationChange);
      audio.addEventListener('play', onPlay);
      audio.addEventListener('pause', onPause);
      audio.addEventListener('canplay', onCanPlay);
      audio.addEventListener('error', onError);

      return () => {
        audio.removeEventListener('timeupdate', onTimeUpdate);
        audio.removeEventListener('durationchange', onDurationChange);
        audio.removeEventListener('loadedmetadata', onDurationChange);
        audio.removeEventListener('play', onPlay);
        audio.removeEventListener('pause', onPause);
        audio.removeEventListener('canplay', onCanPlay);
        audio.removeEventListener('error', onError);
      };
    }, [meetingId]);

    function togglePlay() {
      const audio = audioRef.current;
      if (!audio || !available) return;
      if (playing) audio.pause();
      else audio.play().catch(console.warn);
    }

    function handleSeek(e: React.ChangeEvent<HTMLInputElement>) {
      const audio = audioRef.current;
      if (!audio) return;
      const t = Number(e.target.value);
      audio.currentTime = t;
      setCurrentTime(t);
    }

    if (!available && !loading) {
      return (
        <div className={`glass-card ${styles.unavailable}`}>
          <span>No audio recording available for this meeting.</span>
        </div>
      );
    }

    return (
      <div className={`glass-card ${styles.player}`}>
        <audio ref={audioRef} src={audioUrl} preload="metadata" />

        <button
          type="button"
          className={styles.playBtn}
          onClick={togglePlay}
          disabled={loading || !available}
          aria-label={playing ? 'Pause' : 'Play'}
        >
          {playing ? (
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
              <rect x="6" y="4" width="4" height="16" /><rect x="14" y="4" width="4" height="16" />
            </svg>
          ) : (
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
              <polygon points="5 3 19 12 5 21 5 3" />
            </svg>
          )}
        </button>

        <div className={styles.trackWrap}>
          <input
            type="range"
            className={styles.seekBar}
            min={0}
            max={duration || 100}
            step={0.1}
            value={currentTime}
            onChange={handleSeek}
            disabled={!available || loading}
          />
          <div className={styles.timeRow}>
            <span>{formatTimestamp(currentTime)}</span>
            <span>{duration > 0 ? formatTimestamp(duration) : '--:--'}</span>
          </div>
        </div>

        <span className={styles.hint}>Click timestamps in Actions, Timeline, or Transcript to jump here</span>
      </div>
    );
  },
);

export default MeetingAudioPlayer;
