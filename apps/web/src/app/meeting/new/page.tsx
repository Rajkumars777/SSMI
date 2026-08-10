'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { apiClient } from '@/lib/api';
import styles from './page.module.css';

export default function NewMeetingPage() {
  const router = useRouter();
  const [tab, setTab] = useState<'live' | 'upload'>('live');
  const [mode, setMode] = useState<'fast' | 'accurate'>('accurate');
  const [customerName, setCustomerName] = useState('');
  const [customerCompany, setCustomerCompany] = useState('');
  const [dragging, setDragging] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleStartMeeting() {
    if (!customerName.trim()) return;
    setLoading(true);
    try {
      const meeting = await apiClient.createMeeting({
        customerName: customerName.trim(),
        customerCompany: customerCompany.trim(),
        processingMode: mode,
      });
      router.push(`/meeting/live?id=${meeting.id}`);
    } catch (err) {
      router.push('/meeting/live');
    } finally {
      setLoading(false);
    }
  }

  async function handleUpload() {
    if (!file) return;
    setLoading(true);
    try {
      const created = await apiClient.createMeeting({
        customerName: customerName.trim() || 'Client',
        customerCompany: customerCompany.trim() || 'Organization',
        processingMode: mode,
        title: file.name,
      });
      const processed = await apiClient.uploadAudio(created.id, file);
      router.push(`/meeting/${processed.id}`);
    } catch (err) {
      router.push('/meeting/meeting_001');
    } finally {
      setLoading(false);
    }
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragging(false);
    const f = e.dataTransfer.files[0];
    if (f) setFile(f);
  }

  return (
    <div className={`page-wrapper ${styles.root}`}>
      <div className="container">
        <div className={styles.inner}>
          <div className={styles.header}>
            <h1>New Meeting</h1>
            <p>Start a live recording or analyse an existing audio file</p>
          </div>

          {/* Tabs */}
          <div className={`tabs ${styles.tabs}`}>
            <button
              className={`tab-btn ${tab === 'live' ? 'active' : ''}`}
              onClick={() => setTab('live')}
              id="tab-live"
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <circle cx="12" cy="12" r="6" fill="currentColor" opacity="0.3" />
                <circle cx="12" cy="12" r="3" fill="currentColor" />
              </svg>
              Live Meeting
            </button>
            <button
              className={`tab-btn ${tab === 'upload' ? 'active' : ''}`}
              onClick={() => setTab('upload')}
              id="tab-upload"
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <polyline points="17 8 12 3 7 8" />
                <line x1="12" y1="3" x2="12" y2="15" />
              </svg>
              Upload Recording
            </button>
          </div>

          {tab === 'live' && (
            <div className={`glass-card ${styles.panel} fade-in-up`}>
              <h2 className={styles.panelTitle}>Start Live Recording</h2>
              <p className={styles.panelDesc}>
                SSMI will record and analyse your meeting in real time. Use a voice cue to
                bookmark important moments — no manual interaction needed.
              </p>

              <div className={styles.form}>
                <div className={styles.formRow}>
                  <div className={styles.formGroup}>
                    <label className={styles.label}>Customer Name *</label>
                    <input
                      className="input"
                      type="text"
                      placeholder="e.g. Arjun Mehta"
                      value={customerName}
                      onChange={(e) => setCustomerName(e.target.value)}
                      id="customer-name"
                    />
                  </div>
                  <div className={styles.formGroup}>
                    <label className={styles.label}>Company</label>
                    <input
                      className="input"
                      type="text"
                      placeholder="e.g. TechCorp Solutions"
                      value={customerCompany}
                      onChange={(e) => setCustomerCompany(e.target.value)}
                      id="customer-company"
                    />
                  </div>
                </div>

                <div className={styles.formGroup}>
                  <label className={styles.label}>Processing Mode</label>
                  <div className={styles.modeSelector}>
                    <button
                      className={`${styles.modeBtn} ${mode === 'fast' ? styles.modeBtnActive : ''}`}
                      onClick={() => setMode('fast')}
                      id="mode-fast"
                    >
                      <div className={styles.modeIcon} style={{ color: 'var(--accent-blue)' }}>
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
                        </svg>
                      </div>
                      <div>
                        <div className={styles.modeName}>Fast</div>
                        <div className={styles.modeDesc}>Low latency · Real-time feedback</div>
                      </div>
                    </button>
                    <button
                      className={`${styles.modeBtn} ${mode === 'accurate' ? styles.modeBtnActive : ''}`}
                      onClick={() => setMode('accurate')}
                      id="mode-accurate"
                    >
                      <div className={styles.modeIcon} style={{ color: 'var(--accent-violet)' }}>
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <circle cx="12" cy="12" r="10" />
                          <circle cx="12" cy="12" r="6" />
                          <circle cx="12" cy="12" r="2" />
                        </svg>
                      </div>
                      <div>
                        <div className={styles.modeName}>Maximum Accuracy</div>
                        <div className={styles.modeDesc}>Whisper Large-v3 · Deep analysis</div>
                      </div>
                    </button>
                  </div>
                </div>

                {/* Voice gesture hints */}
                <div className={styles.gestureHints}>
                  <div className={styles.gestureHint}>
                    <div className={styles.gestureIcon} style={{ color: 'var(--accent-amber)' }}>
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M9 18V5l12-2v13" />
                        <circle cx="6" cy="18" r="3" />
                        <circle cx="18" cy="16" r="3" />
                      </svg>
                    </div>
                    <div>
                      <div className={styles.gestureName}>Single Whistle</div>
                      <div className={styles.gestureAction}>→ Bookmark important moment</div>
                    </div>
                  </div>
                  <div className={styles.gestureHint}>
                    <div className={styles.gestureIcon} style={{ color: 'var(--accent-amber)' }}>
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M9 18V5l12-2v13" />
                        <circle cx="6" cy="18" r="3" />
                        <circle cx="18" cy="16" r="3" />
                      </svg>
                    </div>
                    <div>
                      <div className={styles.gestureName}>Double Whistle</div>
                      <div className={styles.gestureAction}>→ Stop recording</div>
                    </div>
                  </div>
                </div>

                <button
                  className={`btn btn-primary btn-xl ${styles.startBtn}`}
                  onClick={handleStartMeeting}
                  disabled={!customerName.trim() || loading}
                  id="btn-start-meeting"
                >
                  {loading ? (
                    <>
                      <div className="spinner" style={{ width: 16, height: 16 }} />
                      Starting...
                    </>
                  ) : (
                    <>
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                        <circle cx="12" cy="12" r="6" fill="currentColor" opacity="0.3" />
                        <circle cx="12" cy="12" r="3" fill="currentColor" />
                      </svg>
                      Start Meeting
                    </>
                  )}
                </button>
              </div>
            </div>
          )}

          {tab === 'upload' && (
            <div className={`glass-card ${styles.panel} fade-in-up`}>
              <h2 className={styles.panelTitle}>Upload Audio Recording</h2>
              <p className={styles.panelDesc}>
                Upload an existing recording. SSMI will transcribe, diarise speakers, and generate
                a full intelligence report including timeline, summary, and action items.
              </p>

              <div
                className={`${styles.dropzone} ${dragging ? styles.dragging : ''} ${file ? styles.hasFile : ''}`}
                onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
                onDragLeave={() => setDragging(false)}
                onDrop={handleDrop}
                onClick={() => document.getElementById('file-input')?.click()}
                id="dropzone"
              >
                <input
                  type="file"
                  id="file-input"
                  accept=".mp3,.wav,.m4a,.aac,.ogg,.flac"
                  style={{ display: 'none' }}
                  onChange={(e) => e.target.files && setFile(e.target.files[0])}
                />
                {file ? (
                  <div className={styles.fileInfo}>
                    <div className={styles.fileIcon} style={{ color: 'var(--accent-blue)' }}>
                      <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                        <path d="M3 18v-6a9 9 0 0 1 18 0v6" />
                        <path d="M21 19a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3zM3 19a2 2 0 0 0 2 2h1a2 2 0 0 0 2-2v-3a2 2 0 0 0-2-2H3z" />
                      </svg>
                    </div>
                    <div className={styles.fileName}>{file.name}</div>
                    <div className={styles.fileSize}>{(file.size / 1024 / 1024).toFixed(2)} MB</div>
                    <button
                      className="btn btn-ghost btn-sm"
                      onClick={(e) => { e.stopPropagation(); setFile(null); }}
                    >
                      Remove
                    </button>
                  </div>
                ) : (
                  <div className={styles.dropzoneContent}>
                    <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" style={{ color: 'var(--accent-blue)', opacity: 0.6 }}>
                      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                      <polyline points="17 8 12 3 7 8" />
                      <line x1="12" y1="3" x2="12" y2="15" />
                    </svg>
                    <div className={styles.dropzoneText}>Drop audio file here or click to browse</div>
                    <div className={styles.dropzoneFormats}>MP3 · WAV · M4A · AAC · OGG · FLAC</div>
                  </div>
                )}
              </div>

              <div className={styles.formGroup} style={{ marginTop: '1.25rem' }}>
                <label className={styles.label}>Processing Mode</label>
                <div className={styles.modeSelector}>
                  <button
                    className={`${styles.modeBtn} ${mode === 'fast' ? styles.modeBtnActive : ''}`}
                    onClick={() => setMode('fast')}
                  >
                    <div className={styles.modeIcon} style={{ color: 'var(--accent-blue)' }}>
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
                      </svg>
                    </div>
                    <div>
                      <div className={styles.modeName}>Fast</div>
                      <div className={styles.modeDesc}>WhisperX Turbo</div>
                    </div>
                  </button>
                  <button
                    className={`${styles.modeBtn} ${mode === 'accurate' ? styles.modeBtnActive : ''}`}
                    onClick={() => setMode('accurate')}
                  >
                    <div className={styles.modeIcon} style={{ color: 'var(--accent-violet)' }}>
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <circle cx="12" cy="12" r="10" />
                        <circle cx="12" cy="12" r="6" />
                        <circle cx="12" cy="12" r="2" />
                      </svg>
                    </div>
                    <div>
                      <div className={styles.modeName}>Maximum Accuracy</div>
                      <div className={styles.modeDesc}>Whisper Large-v3 · Qwen 14B</div>
                    </div>
                  </button>
                </div>
              </div>

              <button
                className={`btn btn-primary btn-xl ${styles.startBtn}`}
                onClick={handleUpload}
                disabled={!file || loading}
                id="btn-process-upload"
              >
                {loading ? (
                  <>
                    <div className="spinner" style={{ width: 16, height: 16 }} />
                    Processing...
                  </>
                ) : (
                  <>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" />
                    </svg>
                    Analyse Recording
                  </>
                )}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
