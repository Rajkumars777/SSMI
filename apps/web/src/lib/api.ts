import { Meeting, SearchResult, EventType } from './types';

export const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';
export const WS_BASE_URL = process.env.NEXT_PUBLIC_WS_URL || 'ws://localhost:8000';

export interface CreateMeetingPayload {
  customerName: string;
  customerCompany?: string;
  processingMode?: 'fast' | 'accurate';
  title?: string;
}

export interface LiveTranscriptLinePayload {
  speaker: string;
  text: string;
  startTime: number;
}

export interface FinalizeLiveMeetingPayload {
  transcript: LiveTranscriptLinePayload[];
  duration: number;
  bookmarks?: number[];
}

export interface DashboardStats {
  totalMeetings: number;
  totalActionItems: number;
  avgMeetingMinutes: number;
  hoursSaved: number;
  meetingsThisWeek: number;
  conversionRate: number;
}

export interface MeetingStatusResponse {
  status: string;
  duration: number;
}

class ApiError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { cache: 'no-store', ...init });
  if (!res.ok) {
    let detail = `HTTP ${res.status}`;
    try {
      const body = await res.json();
      detail = body.detail || body.message || detail;
    } catch {
      // ignore parse errors
    }
    throw new ApiError(String(detail), res.status);
  }
  return res.json() as Promise<T>;
}

class SSMIApiClient {
  private baseUrl: string;

  constructor(baseUrl: string = API_BASE_URL) {
    this.baseUrl = baseUrl;
  }

  /** Check if backend is reachable. */
  async healthCheck(): Promise<boolean> {
    try {
      const res = await fetch(`${this.baseUrl}/health`, { cache: 'no-store' });
      return res.ok;
    } catch {
      return false;
    }
  }

  async getMeetings(): Promise<Meeting[]> {
    return requestJson<Meeting[]>(`${this.baseUrl}/api/meetings`);
  }

  async getDashboardStats(): Promise<DashboardStats> {
    return requestJson<DashboardStats>(`${this.baseUrl}/api/meetings/dashboard/stats`);
  }

  async getMeeting(id: string): Promise<Meeting | null> {
    try {
      return await requestJson<Meeting>(`${this.baseUrl}/api/meetings/${id}`);
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) return null;
      throw err;
    }
  }

  async getMeetingStatus(id: string): Promise<MeetingStatusResponse> {
    return requestJson<MeetingStatusResponse>(`${this.baseUrl}/api/meetings/${id}/status`);
  }

  async reprocessMeeting(id: string): Promise<Meeting> {
    return requestJson<Meeting>(`${this.baseUrl}/api/meetings/${id}/reprocess`, {
      method: 'POST',
    });
  }

  async processMeeting(id: string): Promise<Meeting> {
    return requestJson<Meeting>(`${this.baseUrl}/api/meetings/${id}/process`, {
      method: 'POST',
    });
  }

  async cancelProcessing(id: string): Promise<Meeting> {
    return requestJson<Meeting>(`${this.baseUrl}/api/meetings/${id}/cancel`, {
      method: 'POST',
    });
  }

  async deleteMeeting(id: string): Promise<void> {
    if (!id || id === 'undefined') {
      throw new ApiError('Invalid meeting id', 400);
    }
    const res = await fetch(`${this.baseUrl}/api/meetings/${encodeURIComponent(id)}`, {
      method: 'DELETE',
      cache: 'no-store',
    });
    if (res.status === 404) {
      // Idempotent — already deleted
      return;
    }
    if (!res.ok) {
      let detail = `HTTP ${res.status}`;
      try {
        const body = await res.json();
        detail = body.detail || body.message || detail;
      } catch {
        // ignore
      }
      throw new ApiError(String(detail), res.status);
    }
  }

  async createMeeting(payload: CreateMeetingPayload): Promise<Meeting> {
    return requestJson<Meeting>(`${this.baseUrl}/api/meetings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
  }

  getMeetingAudioUrl(meetingId: string): string {
    return `${this.baseUrl}/api/meetings/${encodeURIComponent(meetingId)}/audio`;
  }

  async uploadAudio(meetingId: string, file: File, autoProcess = true): Promise<Meeting> {
    const formData = new FormData();
    formData.append('file', file);
    formData.append('auto_process', autoProcess ? 'true' : 'false');

    return requestJson<Meeting>(`${this.baseUrl}/api/meetings/${meetingId}/audio`, {
      method: 'POST',
      body: formData,
    });
  }

  /** Finalize a live meeting using browser-captured transcript (skips Whisper). */
  async finalizeLiveMeeting(meetingId: string, payload: FinalizeLiveMeetingPayload): Promise<Meeting> {
    return requestJson<Meeting>(`${this.baseUrl}/api/meetings/${meetingId}/finalize-live`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        transcript: payload.transcript.map((line) => ({
          speaker: line.speaker,
          text: line.text,
          startTime: line.startTime,
        })),
        duration: payload.duration,
        bookmarks: payload.bookmarks ?? [],
      }),
    });
  }

  async searchMeetings(query: string = '', eventType?: EventType): Promise<SearchResult[]> {
    const params = new URLSearchParams();
    if (query) params.append('q', query);
    if (eventType) params.append('event_type', eventType);
    return requestJson<SearchResult[]>(`${this.baseUrl}/api/search?${params.toString()}`);
  }

  /**
   * Poll meeting until processing completes or fails.
   */
  async waitForMeetingProcessing(
    meetingId: string,
    onUpdate?: (meeting: Meeting) => void,
    intervalMs = 3000,
    timeoutMs = 30 * 60 * 1000,
  ): Promise<Meeting> {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      const meeting = await this.getMeeting(meetingId);
      if (!meeting) throw new ApiError('Meeting not found', 404);
      onUpdate?.(meeting);
      if (meeting.status === 'completed' || meeting.status === 'failed') {
        return meeting;
      }
      await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }
    throw new ApiError('Processing timed out', 408);
  }

  connectWebSocket(
    meetingId: string,
    onMessage: (msg: Record<string, unknown>) => void,
    onError?: (err: Event) => void,
  ): WebSocket {
    const ws = new WebSocket(`${WS_BASE_URL}/ws/meetings/${meetingId}`);

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        onMessage(data);
      } catch (err) {
        console.error('[SSMI WS] Error parsing message:', err);
      }
    };

    if (onError) {
      ws.onerror = onError;
    }

    return ws;
  }
}

export const apiClient = new SSMIApiClient();
export { ApiError };
