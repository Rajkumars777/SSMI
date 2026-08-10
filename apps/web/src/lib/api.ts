import { Meeting, MeetingEvent, ActionItem, MeetingSummary, SearchResult, EventType } from './types';
import { MOCK_MEETINGS, MOCK_STATS, MOCK_SEARCH_RESULTS } from './mockData';

export const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';
export const WS_BASE_URL = process.env.NEXT_PUBLIC_WS_URL || 'ws://localhost:8000';

export interface CreateMeetingPayload {
  customerName: str;
  customerCompany?: string;
  processingMode?: 'fast' | 'accurate';
  title?: string;
}

class SSMIApiClient {
  private baseUrl: string;

  constructor(baseUrl: string = API_BASE_URL) {
    this.baseUrl = baseUrl;
  }

  /**
   * Fetch all meetings with fallback to realistic mock data if offline.
   */
  async getMeetings(): Promise<Meeting[]> {
    try {
      const res = await fetch(`${this.baseUrl}/api/meetings`, {
        cache: 'no-store',
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (err) {
      console.warn('[SSMI API] Backend offline, using local data fallback.');
      return MOCK_MEETINGS;
    }
  }

  /**
   * Fetch detailed report for a specific meeting.
   */
  async getMeeting(id: string): Promise<Meeting | null> {
    try {
      const res = await fetch(`${this.baseUrl}/api/meetings/${id}`, {
        cache: 'no-store',
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (err) {
      console.warn(`[SSMI API] Fetching meeting ${id} with fallback.`);
      return MOCK_MEETINGS.find((m) => m.id === id) || MOCK_MEETINGS[0];
    }
  }

  /**
   * Create a new meeting session.
   */
  async createMeeting(payload: CreateMeetingPayload): Promise<Meeting> {
    try {
      const res = await fetch(`${this.baseUrl}/api/meetings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (err) {
      console.warn('[SSMI API] Creating meeting with fallback.');
      return {
        id: `meeting_${Date.now().toString(36)}`,
        title: payload.title || `Meeting with ${payload.customerName}`,
        customerName: payload.customerName,
        customerCompany: payload.customerCompany || 'Company',
        date: new Date().toISOString(),
        duration: 0,
        status: 'recording',
        processingMode: payload.processingMode || 'accurate',
        tags: ['live'],
      };
    }
  }

  /**
   * Upload audio file for full transcription and intelligence extraction.
   */
  async uploadAudio(meetingId: string, file: File): Promise<Meeting> {
    const formData = new FormData();
    formData.append('file', file);

    try {
      const res = await fetch(`${this.baseUrl}/api/meetings/${meetingId}/audio`, {
        method: 'POST',
        body: formData,
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (err) {
      console.warn('[SSMI API] Audio upload fallback mode.');
      return MOCK_MEETINGS[0];
    }
  }

  /**
   * Search meetings across pricing, objections, budget, and commitments.
   */
  async searchMeetings(query: string = '', eventType?: EventType): Promise<SearchResult[]> {
    try {
      const params = new URLSearchParams();
      if (query) params.append('q', query);
      if (eventType) params.append('event_type', eventType);

      const res = await fetch(`${this.baseUrl}/api/search?${params.toString()}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (err) {
      console.warn('[SSMI API] Search query fallback.');
      return MOCK_SEARCH_RESULTS.filter((r) => {
        const matchesQ = !query || r.snippet.toLowerCase().includes(query.toLowerCase()) || r.meetingTitle.toLowerCase().includes(query.toLowerCase());
        const matchesType = !eventType || r.eventType === eventType;
        return matchesQ && matchesType;
      });
    }
  }

  /**
   * Connect WebSocket for live recording streaming and event broadcasting.
   */
  connectWebSocket(
    meetingId: string,
    onMessage: (msg: any) => void,
    onError?: (err: any) => void
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
