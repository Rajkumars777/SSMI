'use client';

import { useState } from 'react';
import { apiClient } from '@/lib/api';
import type { Meeting } from '@/lib/types';

interface ProcessingControlsProps {
  meetingId: string;
  status: Meeting['status'];
  onUpdate?: (meeting: Meeting) => void;
  compact?: boolean;
}

export default function ProcessingControls({
  meetingId,
  status,
  onUpdate,
  compact = false,
}: ProcessingControlsProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canProcess = status === 'recording' || status === 'failed';
  const isProcessing = status === 'processing';

  async function handleProcess() {
    setBusy(true);
    setError(null);
    try {
      const updated = await apiClient.processMeeting(meetingId);
      onUpdate?.(updated);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Could not start processing');
    } finally {
      setBusy(false);
    }
  }

  async function handleStop() {
    if (!confirm('Stop AI processing? Partial results may be saved.')) return;
    setBusy(true);
    setError(null);
    try {
      const updated = await apiClient.cancelProcessing(meetingId);
      onUpdate?.(updated);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Could not stop processing');
    } finally {
      setBusy(false);
    }
  }

  if (!canProcess && !isProcessing) return null;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', alignItems: compact ? 'flex-start' : 'stretch' }}>
      <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
        {canProcess && (
          <button
            type="button"
            className="btn btn-primary"
            onClick={handleProcess}
            disabled={busy}
            style={compact ? { fontSize: '0.85rem', padding: '0.4rem 0.85rem' } : undefined}
          >
            {busy ? 'Starting…' : 'Process Audio'}
          </button>
        )}
        {isProcessing && (
          <button
            type="button"
            className="btn btn-danger"
            onClick={handleStop}
            disabled={busy}
            style={compact ? { fontSize: '0.85rem', padding: '0.4rem 0.85rem' } : undefined}
          >
            {busy ? 'Stopping…' : 'Stop Processing'}
          </button>
        )}
      </div>
      {error && (
        <span style={{ color: '#fca5a5', fontSize: '0.82rem' }}>{error}</span>
      )}
    </div>
  );
}
