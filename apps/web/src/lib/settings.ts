export interface SSMISettings {
  bookmarkGesture: string;
  customBookmarkKeyword: string;
  stopGesture: string;
  customStopKeyword: string;
  confidenceThreshold: number;
  defaultMode: 'fast' | 'accurate';
  sttModel: string;
  preferredMicDeviceId?: string;
  captureTabAudio?: boolean;
  /** Stereo Mix / VB-Cable / Voicemeeter — captures call audio without a screen picker. */
  preferredLoopbackDeviceId?: string;
  /** When true, skip loopback and always use the browser screen-share picker. */
  forceDisplayMediaCapture?: boolean;
}

export const DEFAULT_SETTINGS: SSMISettings = {
  bookmarkGesture: 'whistle_single',
  customBookmarkKeyword: 'Bookmark',
  stopGesture: 'whistle_double',
  customStopKeyword: 'Stop Meeting',
  confidenceThreshold: 0.95,
  defaultMode: 'fast',
  sttModel: 'small',
  preferredMicDeviceId: '',
  captureTabAudio: false,
  preferredLoopbackDeviceId: '',
  forceDisplayMediaCapture: false,
};

const STORAGE_KEY = 'ssmi_user_settings_v1';

export function loadSettings(): SSMISettings {
  if (typeof window === 'undefined') return DEFAULT_SETTINGS;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_SETTINGS;
    const parsed = JSON.parse(raw);
    return { ...DEFAULT_SETTINGS, ...parsed };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export function saveSettings(settings: SSMISettings): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
    window.dispatchEvent(new Event('ssmi-settings-changed'));
  } catch (err) {
    console.error('[SSMI Settings] Save error:', err);
  }
}

export function getBookmarkDisplayLabel(settings: SSMISettings): string {
  switch (settings.bookmarkGesture) {
    case 'whistle_single':
      return 'Single Whistle';
    case 'tongue_click':
      return 'Tongue Click';
    case 'keyword_bookmark':
      return 'Say "Bookmark"';
    case 'keyword_mark':
      return 'Say "Mark This"';
    case 'custom_keyword':
      return `Say "${settings.customBookmarkKeyword || 'Bookmark'}"`;
    default:
      return 'Single Whistle';
  }
}

export function getStopDisplayLabel(settings: SSMISettings): string {
  switch (settings.stopGesture) {
    case 'whistle_double':
      return 'Double Whistle';
    case 'keyword_stop':
      return 'Say "Stop Meeting"';
    case 'custom_keyword':
      return `Say "${settings.customStopKeyword || 'Stop Meeting'}"`;
    default:
      return 'Double Whistle';
  }
}
