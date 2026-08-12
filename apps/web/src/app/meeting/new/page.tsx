'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { apiClient } from '@/lib/api';
import { loadSettings, saveSettings, getBookmarkDisplayLabel, getStopDisplayLabel, DEFAULT_SETTINGS, type SSMISettings } from '@/lib/settings';
import ProcessingControls from '@/components/ProcessingControls';
import type { Meeting } from '@/lib/types';
import styles from './page.module.css';

export default function NewMeetingPage() {
  const router = useRouter();
  const [tab, setTab] = useState<'live' | 'upload'>('live');
  const [mode, setMode] = useState<'fast' | 'accurate'>('accurate');
  const [customerName, setCustomerName] = useState('');
  const [customerCompany, setCustomerCompany] = useState('');
  const [meetingTitle, setMeetingTitle] = useState('');
  const [isTitleUserEdited, setIsTitleUserEdited] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [uploadedMeeting, setUploadedMeeting] = useState<Meeting | null>(null);

  const [settings, setSettings] = useState<SSMISettings>(DEFAULT_SETTINGS);
  const [isEditingGestures, setIsEditingGestures] = useState(false);
  const [customBookmarkInput, setCustomBookmarkInput] = useState(DEFAULT_SETTINGS.customBookmarkKeyword);
  const [customStopInput, setCustomStopInput] = useState(DEFAULT_SETTINGS.customStopKeyword);

  // Auto-generate suggested meeting title if user hasn't manually customized it
  useEffect(() => {
    if (!isTitleUserEdited) {
      if (customerCompany.trim()) {
        setMeetingTitle(`Discussion — ${customerCompany.trim()}`);
      } else if (customerName.trim()) {
        setMeetingTitle(`Meeting with ${customerName.trim()}`);
      } else {
        setMeetingTitle('');
      }
    }
  }, [customerName, customerCompany, isTitleUserEdited]);

  useEffect(() => {
    function reload() {
      const updated = loadSettings();
      setSettings(updated);
      setCustomBookmarkInput(updated.customBookmarkKeyword);
      setCustomStopInput(updated.customStopKeyword);
    }
    reload();
    window.addEventListener('ssmi-settings-changed', reload);
    return () => window.removeEventListener('ssmi-settings-changed', reload);
  }, []);


  async function handleStartMeeting() {
    if (!customerName.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const healthy = await apiClient.healthCheck();
      if (!healthy) {
        throw new Error('Backend API is not reachable. Start the FastAPI server on port 8000.');
      }

      const meeting = await apiClient.createMeeting({
        customerName: customerName.trim(),
        customerCompany: customerCompany.trim(),
        processingMode: mode,
        title: meetingTitle.trim() || undefined,
      });
      const encodedName = encodeURIComponent(customerName.trim());
      router.push(`/meeting/live?id=${meeting.id}&customer=${encodedName}&backend=true`);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Could not start meeting session.';
      console.error('[SSMI] Error creating meeting:', err);
      setError(message);
    } finally {
      setLoading(false);
    }
  }

  async function handleUpload() {
    if (!file) return;
    setLoading(true);
    setError(null);
    setUploadedMeeting(null);
    try {
      const healthy = await apiClient.healthCheck();
      if (!healthy) {
        throw new Error('Backend API is not reachable. Start the FastAPI server on port 8000.');
      }

      const created = await apiClient.createMeeting({
        customerName: customerName.trim() || 'Client',
        customerCompany: customerCompany.trim() || 'Organization',
        processingMode: mode,
        title: meetingTitle.trim() || file.name,
      });
      const uploaded = await apiClient.uploadAudio(created.id, file, false);
      setUploadedMeeting(uploaded);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Could not upload audio recording.';
      console.error('[SSMI] Error uploading audio:', err);
      setError(message);
    } finally {
      setLoading(false);
    }
  }

  async function handleUploadedMeetingUpdate(meeting: Meeting) {
    setUploadedMeeting(meeting);
    if (meeting.status === 'processing') {
      try {
        const finalMeeting = await apiClient.waitForMeetingProcessing(meeting.id, setUploadedMeeting);
        if (finalMeeting.status === 'completed') {
          router.push(`/meeting/${meeting.id}`);
        }
      } catch (err) {
        console.warn('[SSMI] Processing wait ended:', err);
      }
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

          {error && (
            <div className={`glass-card ${styles.errorBanner}`} role="alert">
              {error}
            </div>
          )}

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

                {/* Custom Meeting Name / Title */}
                <div className={styles.formGroup}>
                  <div className={styles.titleHeaderRow}>
                    <label className={styles.label}>Meeting Name / Title</label>
                    {isTitleUserEdited && (
                      <button
                        type="button"
                        className={styles.resetTitleBtn}
                        onClick={() => {
                          setIsTitleUserEdited(false);
                          if (customerCompany.trim()) {
                            setMeetingTitle(`Discussion — ${customerCompany.trim()}`);
                          } else if (customerName.trim()) {
                            setMeetingTitle(`Meeting with ${customerName.trim()}`);
                          } else {
                            setMeetingTitle('');
                          }
                        }}
                      >
                        ↻ Reset to auto-suggested title
                      </button>
                    )}
                  </div>
                  <input
                    className="input"
                    type="text"
                    placeholder={
                      customerCompany.trim()
                        ? `Discussion — ${customerCompany.trim()}`
                        : customerName.trim()
                        ? `Meeting with ${customerName.trim()}`
                        : 'e.g. Q3 Licensing Discussion'
                    }
                    value={meetingTitle}
                    onChange={(e) => {
                      setMeetingTitle(e.target.value);
                      setIsTitleUserEdited(true);
                    }}
                    id="meeting-title"
                  />
                </div>

                <div className={styles.formGroup}>
                  <label className={styles.label}>Processing Mode</label>
                  <div className={styles.modeSelector}>
                    <div
                      className={`${styles.modeBtn} ${mode === 'fast' ? styles.modeBtnActive : ''}`}
                      onClick={() => setMode('fast')}
                      id="mode-fast"
                      role="button"
                      tabIndex={0}
                    >
                      <div className={styles.modeHeader}>
                        <div className={styles.modeIcon} style={{ color: 'var(--accent-blue)' }}>
                          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
                          </svg>
                        </div>
                        <div>
                          <div className={styles.modeName}>Fast Mode</div>
                          <div className={styles.modeDesc}>Real-Time Streaming · Low Latency</div>
                        </div>
                      </div>

                      {/* Feature Hints for Fast Mode */}
                      <div className={styles.modeFeatureList}>
                        <div className={styles.modeFeatureItem}>
                          <span className={styles.modeFeatureIcon} style={{ color: 'var(--accent-blue)' }}>⚡</span>
                          <span><strong>Real-time streaming:</strong> Instant live transcript & waveform</span>
                        </div>
                        <div className={styles.modeFeatureItem}>
                          <span className={styles.modeFeatureIcon} style={{ color: 'var(--accent-blue)' }}>⚡</span>
                          <span><strong>Fast classifier:</strong> Instant detection of budget, pricing & objections</span>
                        </div>
                        <div className={styles.modeFeatureItem}>
                          <span className={styles.modeFeatureIcon} style={{ color: 'var(--accent-blue)' }}>⚡</span>
                          <span><strong>Minimal latency:</strong> Optimized for low compute & quick check-ins</span>
                        </div>
                      </div>
                    </div>

                    <div
                      className={`${styles.modeBtn} ${mode === 'accurate' ? styles.modeBtnActive : ''}`}
                      onClick={() => setMode('accurate')}
                      id="mode-accurate"
                      role="button"
                      tabIndex={0}
                    >
                      <div className={styles.modeHeader}>
                        <div className={styles.modeIcon} style={{ color: 'var(--accent-violet)' }}>
                          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <circle cx="12" cy="12" r="10" />
                            <circle cx="12" cy="12" r="6" />
                            <circle cx="12" cy="12" r="2" />
                          </svg>
                        </div>
                        <div>
                          <div className={styles.modeName}>Maximum Accuracy Mode</div>
                          <div className={styles.modeDesc}>Whisper Large-v3 · Qwen 14B Deep AI</div>
                        </div>
                      </div>

                      {/* Feature Hints for Maximum Accuracy Mode */}
                      <div className={styles.modeFeatureList}>
                        <div className={styles.modeFeatureItem}>
                          <span className={styles.modeFeatureIcon} style={{ color: 'var(--accent-violet)' }}>🎯</span>
                          <span><strong>Whisper Large-v3 STT:</strong> Highest accuracy transcription with VAD</span>
                        </div>
                        <div className={styles.modeFeatureItem}>
                          <span className={styles.modeFeatureIcon} style={{ color: 'var(--accent-violet)' }}>👥</span>
                          <span><strong>Speaker Diarization:</strong> pyannote Salesperson vs Customer separation</span>
                        </div>
                        <div className={styles.modeFeatureItem}>
                          <span className={styles.modeFeatureIcon} style={{ color: 'var(--accent-violet)' }}>🧠</span>
                          <span><strong>Qwen 14B Intelligence:</strong> Executive summary, decisions, risks & next steps</span>
                        </div>
                        <div className={styles.modeFeatureItem}>
                          <span className={styles.modeFeatureIcon} style={{ color: 'var(--accent-violet)' }}>📋</span>
                          <span><strong>Action Item Extraction:</strong> Task assignment, deadlines & quotes</span>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Voice gesture hints with inline editor */}
                <div className={styles.gestureHintsCard}>
                  <div className={styles.gestureHintsHeader}>
                    <div className={styles.gestureHintsTitle}>
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ color: 'var(--accent-amber)' }}>
                        <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
                        <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                        <line x1="12" y1="19" x2="12" y2="23" />
                        <line x1="8" y1="23" x2="16" y2="23" />
                      </svg>
                      Active Voice Gestures
                    </div>
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      onClick={() => setIsEditingGestures(!isEditingGestures)}
                      style={{ color: 'var(--text-accent)' }}
                    >
                      {isEditingGestures ? 'Close Editor' : '⚙️ Customize Gestures'}
                    </button>
                  </div>

                  {!isEditingGestures ? (
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
                          <div className={styles.gestureName}>{getBookmarkDisplayLabel(settings)}</div>
                          <div className={styles.gestureAction}>→ Bookmark important moment</div>
                        </div>
                      </div>
                      <div className={styles.gestureHint}>
                        <div className={styles.gestureIcon} style={{ color: 'var(--accent-red)' }}>
                          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <circle cx="12" cy="12" r="10" />
                            <rect x="9" y="9" width="6" height="6" fill="currentColor" />
                          </svg>
                        </div>
                        <div>
                          <div className={styles.gestureName}>{getStopDisplayLabel(settings)}</div>
                          <div className={styles.gestureAction}>→ Stop recording</div>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className={styles.inlineGestureEditor}>
                      <div className={styles.editorRow}>
                        <div className={styles.editorGroup}>
                          <label className={styles.editorLabel}>Bookmark Voice Keyword / Sound:</label>
                          <select
                            className="input"
                            value={settings.bookmarkGesture}
                            onChange={(e) => {
                              const updated = { ...settings, bookmarkGesture: e.target.value };
                              setSettings(updated);
                              saveSettings(updated);
                            }}
                          >
                            <option value="whistle_single">Single Whistle</option>
                            <option value="tongue_click">Tongue Click</option>
                            <option value="keyword_bookmark">Say "Bookmark"</option>
                            <option value="keyword_mark">Say "Mark This"</option>
                            <option value="custom_keyword">Custom Spoken Keyword</option>
                          </select>
                          {(settings.bookmarkGesture === 'custom_keyword' || settings.bookmarkGesture.startsWith('keyword_')) && (
                            <input
                              type="text"
                              className="input"
                              style={{ marginTop: '0.4rem' }}
                              placeholder="e.g. Bookmark, Note this, Flag item"
                              value={customBookmarkInput}
                              onChange={(e) => setCustomBookmarkInput(e.target.value)}
                            />
                          )}
                        </div>

                        <div className={styles.editorGroup}>
                          <label className={styles.editorLabel}>Stop Voice Keyword / Sound:</label>
                          <select
                            className="input"
                            value={settings.stopGesture}
                            onChange={(e) => {
                              const updated = { ...settings, stopGesture: e.target.value };
                              setSettings(updated);
                              saveSettings(updated);
                            }}
                          >
                            <option value="whistle_double">Double Whistle</option>
                            <option value="keyword_stop">Say "Stop Meeting"</option>
                            <option value="custom_keyword">Custom Spoken Keyword</option>
                          </select>
                          {(settings.stopGesture === 'custom_keyword' || settings.stopGesture === 'keyword_stop') && (
                            <input
                              type="text"
                              className="input"
                              style={{ marginTop: '0.4rem' }}
                              placeholder="e.g. Stop meeting, End call, Finish"
                              value={customStopInput}
                              onChange={(e) => setCustomStopInput(e.target.value)}
                            />
                          )}
                        </div>
                      </div>

                      <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '0.75rem' }}>
                        <button
                          type="button"
                          className="btn btn-primary btn-sm"
                          onClick={() => {
                            const updated: SSMISettings = {
                              ...settings,
                              customBookmarkKeyword: customBookmarkInput.trim() || 'Bookmark',
                              customStopKeyword: customStopInput.trim() || 'Stop Meeting',
                            };
                            setSettings(updated);
                            saveSettings(updated);
                            setIsEditingGestures(false);
                          }}
                        >
                          Save & Apply Gestures
                        </button>
                      </div>
                    </div>
                  )}
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
                  accept=".mp3,.wav,.m4a,.aac,.ogg,.flac,.webm"
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
                    <div className={styles.dropzoneFormats}>MP3 · WAV · M4A · AAC · OGG · FLAC · WEBM</div>
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
                disabled={!file || loading || !!uploadedMeeting}
                id="btn-process-upload"
              >
                {loading ? (
                  <>
                    <div className="spinner" style={{ width: 16, height: 16 }} />
                    Uploading...
                  </>
                ) : uploadedMeeting ? (
                  <>Uploaded</>
                ) : (
                  <>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                      <polyline points="17 8 12 3 7 8" />
                      <line x1="12" y1="3" x2="12" y2="15" />
                    </svg>
                    Upload Recording
                  </>
                )}
              </button>

              {uploadedMeeting && (
                <div className={`${styles.uploadActions} fade-in-up`}>
                  <p className={styles.uploadReadyText}>
                    Audio uploaded. Start AI processing when you are ready, or open the meeting to review later.
                  </p>
                  <ProcessingControls
                    meetingId={uploadedMeeting.id}
                    status={uploadedMeeting.status}
                    onUpdate={handleUploadedMeetingUpdate}
                  />
                  <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={() => router.push(`/meeting/${uploadedMeeting.id}`)}
                  >
                    Open Meeting
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
