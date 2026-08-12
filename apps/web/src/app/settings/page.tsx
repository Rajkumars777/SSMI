'use client';

import { useEffect, useState } from 'react';
import { loadSettings, saveSettings, DEFAULT_SETTINGS, type SSMISettings } from '@/lib/settings';
import {
  ensureMicPermission,
  listAudioInputDevices,
  isHeadsetLikeLabel,
  type AudioInputDevice,
} from '@/lib/audioCapture';
import styles from './page.module.css';

const sections = [
  {
    id: 'voice',
    title: 'Voice Gestures',
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
        <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
        <line x1="12" y1="19" x2="12" y2="23" />
        <line x1="8" y1="23" x2="16" y2="23" />
      </svg>
    ),
  },
  {
    id: 'processing',
    title: 'Processing',
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
      </svg>
    ),
  },
  {
    id: 'account',
    title: 'Account',
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
        <circle cx="12" cy="7" r="4" />
      </svg>
    ),
  },
  {
    id: 'ai',
    title: 'AI Pipeline',
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <rect x="2" y="2" width="20" height="20" rx="5" ry="5" />
        <path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z" />
        <line x1="17.5" y1="6.5" x2="17.51" y2="6.5" />
      </svg>
    ),
  },
];

export default function SettingsPage() {
  const [bookmarkGesture, setBookmarkGesture] = useState('whistle_single');
  const [customBookmarkKeyword, setCustomBookmarkKeyword] = useState('Bookmark');
  const [stopGesture, setStopGesture] = useState('whistle_double');
  const [customStopKeyword, setCustomStopKeyword] = useState('Stop Meeting');
  const [confidenceThreshold, setConfidenceThreshold] = useState(0.95);
  const [defaultMode, setDefaultMode] = useState<'fast' | 'accurate'>('accurate');
  const [sttModel, setSttModel] = useState('large-v3-turbo');
  const [preferredMicDeviceId, setPreferredMicDeviceId] = useState('');
  const [captureTabAudio, setCaptureTabAudio] = useState(false);
  const [micDevices, setMicDevices] = useState<AudioInputDevice[]>([]);
  const [activeSection, setActiveSection] = useState('voice');
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    const initial = loadSettings();
    setBookmarkGesture(initial.bookmarkGesture);
    setCustomBookmarkKeyword(initial.customBookmarkKeyword);
    setStopGesture(initial.stopGesture);
    setCustomStopKeyword(initial.customStopKeyword);
    setConfidenceThreshold(initial.confidenceThreshold);
    setDefaultMode(initial.defaultMode);
    setSttModel(initial.sttModel);
    setPreferredMicDeviceId(initial.preferredMicDeviceId || '');
    setCaptureTabAudio(!!initial.captureTabAudio);
  }, []);

  useEffect(() => {
    async function loadDevices() {
      const permitted = await ensureMicPermission();
      if (!permitted) return;
      setMicDevices(await listAudioInputDevices());
    }
    loadDevices();
    navigator.mediaDevices?.addEventListener('devicechange', loadDevices);
    return () => navigator.mediaDevices?.removeEventListener('devicechange', loadDevices);
  }, []);

  function handleSave() {
    const updated: SSMISettings = {
      ...loadSettings(),
      bookmarkGesture,
      customBookmarkKeyword: customBookmarkKeyword.trim() || 'Bookmark',
      stopGesture,
      customStopKeyword: customStopKeyword.trim() || 'Stop Meeting',
      confidenceThreshold,
      defaultMode,
      sttModel,
      preferredMicDeviceId,
      captureTabAudio,
    };

    saveSettings(updated);
    setSaved(true);
    setTimeout(() => setSaved(false), 2500);
  }


  return (
    <div className={`page-wrapper ${styles.root}`}>
      <div className="container">
        <div className={styles.pageHeader}>
          <h1>Settings</h1>
          <p>Configure your SSMI voice gestures, processing preferences, and AI pipeline</p>
        </div>

        <div className={styles.layout}>
          {/* Sidebar nav */}
          <nav className={`glass-card ${styles.nav}`}>
            {sections.map((s) => (
              <button
                key={s.id}
                className={`${styles.navItem} ${activeSection === s.id ? styles.navActive : ''}`}
                onClick={() => setActiveSection(s.id)}
                id={`nav-${s.id}`}
              >
                <span className={styles.navIcon}>{s.icon}</span>
                <span>{s.title}</span>
              </button>
            ))}
          </nav>

          {/* Main content */}
          <div className={styles.main}>
            {/* Voice Gestures */}
            {activeSection === 'voice' && (
              <div className={`glass-card ${styles.section} fade-in-up`}>
                <div className={styles.sectionHeader}>
                  <h2>Voice Gesture Configuration</h2>
                  <p>Configure the voice cues used to bookmark moments and stop recordings hands-free.</p>
                </div>

                <div className={styles.form}>
                  <div className={styles.formGroup}>
                    <label className={styles.label}>Bookmark Gesture</label>
                    <p className={styles.hint}>The sound or spoken keyword that creates a bookmark at the current timestamp.</p>
                    <div className={styles.gestureOptions}>
                      {[
                        { val: 'whistle_single', label: 'Single Whistle', desc: 'Recommended — highly reliable' },
                        { val: 'tongue_click', label: 'Tongue Click', desc: 'Works well in quiet environments' },
                        { val: 'keyword_bookmark', label: 'Say "Bookmark"', desc: 'Voice keyword via local STT' },
                        { val: 'keyword_mark', label: 'Say "Mark This"', desc: 'Alternative voice keyword' },
                        { val: 'custom_keyword', label: 'Custom Spoken Keyword', desc: 'Manually set your custom voice phrase' },
                      ].map((opt) => (
                        <label key={opt.val} className={`${styles.gestureOption} ${bookmarkGesture === opt.val ? styles.gestureActive : ''}`}>
                          <input
                            type="radio"
                            name="bookmark"
                            value={opt.val}
                            checked={bookmarkGesture === opt.val}
                            onChange={() => setBookmarkGesture(opt.val)}
                            style={{ display: 'none' }}
                          />
                          <div>
                            <div className={styles.gestureLabel}>{opt.label}</div>
                            <div className={styles.gestureDesc}>{opt.desc}</div>
                          </div>
                          {bookmarkGesture === opt.val && (
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" style={{ color: 'var(--accent-green)', flexShrink: 0 }}>
                              <polyline points="20 6 9 17 4 12" />
                            </svg>
                          )}
                        </label>
                      ))}
                    </div>

                    {(bookmarkGesture === 'custom_keyword' || bookmarkGesture.startsWith('keyword_')) && (
                      <div className={styles.customKeywordBox}>
                        <label className={styles.customLabel}>Manually Set Voice Keyword / Phrase:</label>
                        <div className={styles.customInputGroup}>
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ color: 'var(--accent-blue)', flexShrink: 0 }}>
                            <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
                            <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                            <line x1="12" y1="19" x2="12" y2="23" />
                            <line x1="8" y1="23" x2="16" y2="23" />
                          </svg>
                          <input
                            type="text"
                            className="input"
                            placeholder="e.g. Bookmark, Mark this, Flag item, Important"
                            value={customBookmarkKeyword}
                            onChange={(e) => setCustomBookmarkKeyword(e.target.value)}
                            id="custom-bookmark-keyword"
                          />
                        </div>
                        <span className={styles.customHint}>
                          Local STT continuously monitors live speech for: <strong>"{customBookmarkKeyword || 'Bookmark'}"</strong>
                        </span>
                      </div>
                    )}
                  </div>

                  <div className="divider" />

                  <div className={styles.formGroup}>
                    <label className={styles.label}>Stop Gesture</label>
                    <p className={styles.hint}>The sound or spoken keyword that ends the meeting recording.</p>
                    <div className={styles.gestureOptions}>
                      {[
                        { val: 'whistle_double', label: 'Double Whistle', desc: 'Recommended — distinct from bookmark' },
                        { val: 'keyword_stop', label: 'Say "Stop Meeting"', desc: 'Voice keyword via local STT' },
                        { val: 'custom_keyword', label: 'Custom Spoken Keyword', desc: 'Manually set your custom stop phrase' },
                      ].map((opt) => (
                        <label key={opt.val} className={`${styles.gestureOption} ${stopGesture === opt.val ? styles.gestureActive : ''}`}>
                          <input
                            type="radio"
                            name="stop"
                            value={opt.val}
                            checked={stopGesture === opt.val}
                            onChange={() => setStopGesture(opt.val)}
                            style={{ display: 'none' }}
                          />
                          <div>
                            <div className={styles.gestureLabel}>{opt.label}</div>
                            <div className={styles.gestureDesc}>{opt.desc}</div>
                          </div>
                          {stopGesture === opt.val && (
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" style={{ color: 'var(--accent-green)', flexShrink: 0 }}>
                              <polyline points="20 6 9 17 4 12" />
                            </svg>
                          )}
                        </label>
                      ))}
                    </div>

                    {(stopGesture === 'custom_keyword' || stopGesture === 'keyword_stop') && (
                      <div className={styles.customKeywordBox}>
                        <label className={styles.customLabel}>Manually Set Stop Voice Keyword / Phrase:</label>
                        <div className={styles.customInputGroup}>
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ color: 'var(--accent-red)', flexShrink: 0 }}>
                            <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
                            <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                            <line x1="12" y1="19" x2="12" y2="23" />
                            <line x1="8" y1="23" x2="16" y2="23" />
                          </svg>
                          <input
                            type="text"
                            className="input"
                            placeholder="e.g. Stop meeting, Finish recording, End call"
                            value={customStopKeyword}
                            onChange={(e) => setCustomStopKeyword(e.target.value)}
                            id="custom-stop-keyword"
                          />
                        </div>
                        <span className={styles.customHint}>
                          Local STT continuously monitors live speech for: <strong>"{customStopKeyword || 'Stop Meeting'}"</strong>
                        </span>
                      </div>
                    )}
                  </div>


                  <div className="divider" />

                  <div className={styles.formGroup}>
                    <label className={styles.label}>Microphone (Live Meetings)</label>
                    <p className={styles.hint}>
                      Choose your headset microphone for live recording. SSMI auto-selects headset devices when detected.
                    </p>
                    <select
                      className="input"
                      value={preferredMicDeviceId}
                      onChange={(e) => setPreferredMicDeviceId(e.target.value)}
                      id="preferred-mic"
                    >
                      <option value="">System default</option>
                      {micDevices.map((d) => (
                        <option key={d.deviceId} value={d.deviceId}>
                          {d.label}{isHeadsetLikeLabel(d.label) ? ' 🎧' : ''}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className={styles.formGroup}>
                    <label className={styles.checkboxRow}>
                      <input
                        type="checkbox"
                        checked={captureTabAudio}
                        onChange={(e) => setCaptureTabAudio(e.target.checked)}
                      />
                      <span>
                        Also capture system / call audio
                        <small className={styles.hint} style={{ display: 'block', marginTop: 4 }}>
                          Required with headphones — share your meeting screen/tab with &quot;Share system audio&quot; enabled.
                        </small>
                      </span>
                    </label>
                  </div>

                  <div className="divider" />

                  <div className={styles.formGroup}>
                    <label className={styles.label}>
                      Detection Confidence Threshold
                      <span className={styles.thresholdVal}>{Math.round(confidenceThreshold * 100)}%</span>
                    </label>
                    <p className={styles.hint}>Higher threshold = fewer false positives. Recommended: 95%+</p>
                    <input
                      type="range"
                      min="0.7"
                      max="0.99"
                      step="0.01"
                      value={confidenceThreshold}
                      onChange={(e) => setConfidenceThreshold(parseFloat(e.target.value))}
                      className={styles.slider}
                      id="confidence-threshold"
                    />
                    <div className={styles.sliderLabels}>
                      <span>70% (More sensitive)</span>
                      <span>99% (Most precise)</span>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Processing */}
            {activeSection === 'processing' && (
              <div className={`glass-card ${styles.section} fade-in-up`}>
                <div className={styles.sectionHeader}>
                  <h2>Processing Settings</h2>
                  <p>Configure the default AI processing mode for new meetings.</p>
                </div>

                <div className={styles.form}>
                  <div className={styles.formGroup}>
                    <label className={styles.label}>Default Processing Mode</label>
                    <div className={styles.modeCards}>
                      <button
                        className={`${styles.modeCard} ${defaultMode === 'fast' ? styles.modeCardActive : ''}`}
                        onClick={() => setDefaultMode('fast')}
                        id="default-mode-fast"
                      >
                        <div className={styles.modeCardIcon} style={{ color: 'var(--accent-blue)' }}>
                          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
                          </svg>
                        </div>
                        <div className={styles.modeCardTitle}>Fast Mode</div>
                        <div className={styles.modeCardFeatures}>
                          <div>Whisper Large-v3-Turbo</div>
                          <div>Low latency real-time</div>
                          <div>Fast event classifiers</div>
                        </div>
                      </button>
                      <button
                        className={`${styles.modeCard} ${defaultMode === 'accurate' ? styles.modeCardActive : ''}`}
                        onClick={() => setDefaultMode('accurate')}
                        id="default-mode-accurate"
                      >
                        <div className={styles.modeCardIcon} style={{ color: 'var(--accent-violet)' }}>
                          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <circle cx="12" cy="12" r="10" />
                            <circle cx="12" cy="12" r="6" />
                            <circle cx="12" cy="12" r="2" />
                          </svg>
                        </div>
                        <div className={styles.modeCardTitle}>Maximum Accuracy</div>
                        <div className={styles.modeCardFeatures}>
                          <div>Whisper Large-v3</div>
                          <div>pyannote diarization</div>
                          <div>Qwen 14B analysis</div>
                        </div>
                      </button>
                    </div>
                  </div>

                  <div className="divider" />

                  <div className={styles.formGroup}>
                    <label className={styles.label}>STT Model</label>
                    <select className="input" value={sttModel} onChange={(e) => setSttModel(e.target.value)} id="stt-model">
                      <option value="large-v3-turbo">Whisper Large-v3-Turbo (Recommended)</option>
                      <option value="large-v3">Whisper Large-v3 (Max Accuracy)</option>
                      <option value="medium">Whisper Medium (Faster, Less Accurate)</option>
                    </select>
                  </div>

                  <div className={styles.infoBox}>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" />
                    </svg>
                    <p>Actual processing speed depends on your GPU VRAM, batch size, and concurrent requests. Benchmark on your hardware to find the optimal configuration.</p>
                  </div>
                </div>
              </div>
            )}

            {/* Account */}
            {activeSection === 'account' && (
              <div className={`glass-card ${styles.section} fade-in-up`}>
                <div className={styles.sectionHeader}>
                  <h2>Account Settings</h2>
                  <p>Manage your profile and organisation details.</p>
                </div>

                <div className={styles.form}>
                  <div className={styles.profileRow}>
                    <div className={styles.profileAvatar}>SP</div>
                    <div>
                      <div className={styles.profileName}>Sales Professional</div>
                      <div className={styles.profileRole}>Sales Executive</div>
                    </div>
                  </div>

                  <div className="divider" />

                  <div className={styles.formRow}>
                    <div className={styles.formGroup}>
                      <label className={styles.label}>Full Name</label>
                      <input className="input" type="text" placeholder="Your name" defaultValue="Sales Professional" id="account-name" />
                    </div>
                    <div className={styles.formGroup}>
                      <label className={styles.label}>Email</label>
                      <input className="input" type="email" placeholder="you@company.com" defaultValue="sales@company.com" id="account-email" />
                    </div>
                  </div>

                  <div className={styles.formRow}>
                    <div className={styles.formGroup}>
                      <label className={styles.label}>Organisation</label>
                      <input className="input" type="text" placeholder="Your company" defaultValue="SSMI Corp" id="account-org" />
                    </div>
                    <div className={styles.formGroup}>
                      <label className={styles.label}>Role</label>
                      <input className="input" type="text" placeholder="Your role" defaultValue="Sales Executive" id="account-role" />
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* AI Pipeline */}
            {activeSection === 'ai' && (
              <div className={`glass-card ${styles.section} fade-in-up`}>
                <div className={styles.sectionHeader}>
                  <h2>AI Pipeline</h2>
                  <p>Current SSMI AI stack configuration. All processing is local — ₹0 API cost.</p>
                </div>

                <div className={styles.pipelineGrid}>
                  {[
                    { stage: 'Speech-to-Text', model: 'WhisperX + Whisper Large-v3-Turbo', status: 'active', badge: 'badge-green' },
                    { stage: 'Speaker Diarization', model: 'pyannote.audio', status: 'active', badge: 'badge-green' },
                    { stage: 'Voice Activity Detection', model: 'Silero VAD', status: 'active', badge: 'badge-green' },
                    { stage: 'Embeddings', model: 'BGE-M3', status: 'active', badge: 'badge-green' },
                    { stage: 'LLM (Business Intelligence)', model: 'Qwen 14B Instruct via vLLM', status: 'active', badge: 'badge-green' },
                    { stage: 'Vector Search', model: 'PostgreSQL + pgvector', status: 'active', badge: 'badge-green' },
                    { stage: 'Voice Gesture Detection', model: 'ONNX Runtime (custom model)', status: 'active', badge: 'badge-green' },
                    { stage: 'Audio Processing', model: 'FFmpeg', status: 'active', badge: 'badge-green' },
                  ].map((p) => (
                    <div key={p.stage} className={styles.pipelineRow}>
                      <div className={styles.pipelineStage}>{p.stage}</div>
                      <div className={styles.pipelineModel}>{p.model}</div>
                      <span className={`badge ${p.badge}`}>{p.status}</span>
                    </div>
                  ))}
                </div>

                <div className={styles.costBadge}>
                  <span className={styles.costLabel}>Core API/Service Cost</span>
                  <span className={styles.costVal}>₹0</span>
                </div>
              </div>
            )}

            {/* Save button */}
            <div className={styles.saveRow}>
              <button
                className={`btn ${saved ? 'btn-success' : 'btn-primary'} btn-lg`}
                onClick={handleSave}
                id="btn-save-settings"
              >
                {saved ? (
                  <>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                    Saved!
                  </>
                ) : (
                  'Save Settings'
                )}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
