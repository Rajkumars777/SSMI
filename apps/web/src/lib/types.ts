// ─── Core Types for SSMI ─────────────────────────────────────────────────────

export type ProcessingMode = 'fast' | 'accurate';
export type MeetingStatus = 'recording' | 'processing' | 'completed' | 'failed';
export type SpeakerType = 'CUSTOMER' | 'SALESPERSON' | 'UNKNOWN';
export type EventType =
  | 'REQUIREMENT'
  | 'PRICING'
  | 'BUDGET'
  | 'OBJECTION'
  | 'NEGOTIATION'
  | 'DECISION'
  | 'ACTION_ITEM'
  | 'COMPETITOR'
  | 'COMMITMENT'
  | 'RISK'
  | 'PURCHASE_INTENT';

export type ImportanceLevel = 1 | 2 | 3 | 4 | 5;
export type SentimentType = 'positive' | 'neutral' | 'negative' | 'mixed';
export type PurchaseIntent = 'very_high' | 'high' | 'medium' | 'low' | 'none';

// ─── Meeting ──────────────────────────────────────────────────────────────────

export interface Meeting {
  id: string;
  title: string;
  customerName: string;
  customerCompany: string;
  date: string;          // ISO string
  duration: number;      // seconds
  status: MeetingStatus;
  processingMode: ProcessingMode;
  summary?: MeetingSummary;
  timeline?: TimelineEvent[];
  actionItems?: ActionItem[];
  transcript?: TranscriptSegment[];
  sentiment?: SentimentType;
  purchaseIntent?: PurchaseIntent;
  tags?: string[];
}

// ─── Timeline ────────────────────────────────────────────────────────────────

export interface TimelineEvent {
  id: string;
  meetingId: string;
  type: EventType;
  title: string;
  description: string;
  startTime: number;    // seconds
  endTime: number;      // seconds
  speaker: SpeakerType;
  importance: ImportanceLevel;
  confidence: number;   // 0–1
  evidence: string[];   // quote snippets
  purchaseIntent?: PurchaseIntent;
  entities?: string[];
  bookmarked?: boolean;
}

// ─── Transcript ───────────────────────────────────────────────────────────────

export interface TranscriptSegment {
  id: string;
  speaker: SpeakerType;
  startTime: number;
  endTime: number;
  text: string;
  confidence: number;
  eventId?: string;     // linked timeline event if any
}

// ─── Summary ─────────────────────────────────────────────────────────────────

export interface MeetingSummary {
  objective: string;
  keyPoints: string[];
  decisions: string[];
  risks: string[];
  customerSentiment: SentimentType;
  purchaseIntent: PurchaseIntent;
  nextSteps: string[];
  overview: string;
}

// ─── Action Items ─────────────────────────────────────────────────────────────

export interface ActionItem {
  id: string;
  meetingId: string;
  title: string;
  description: string;
  owner: SpeakerType;
  deadline?: string;
  confidence: number;
  evidenceTimestamp?: number;
  completed: boolean;
  priority: 'high' | 'medium' | 'low';
}

// ─── Search ───────────────────────────────────────────────────────────────────

export interface SearchResult {
  meetingId: string;
  meetingTitle: string;
  customerName: string;
  customerCompany: string;
  date: string;
  eventType: EventType;
  snippet: string;
  startTime: number;
  importance: ImportanceLevel;
  confidence: number;
}

// ─── Stats ────────────────────────────────────────────────────────────────────

export interface DashboardStats {
  totalMeetings: number;
  totalActionItems: number;
  avgMeetingMinutes: number;
  hoursSaved: number;
  meetingsThisWeek: number;
  conversionRate: number;
}
