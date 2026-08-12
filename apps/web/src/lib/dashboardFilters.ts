import type { Meeting, MeetingStatus, ProcessingMode, SentimentType, PurchaseIntent } from './types';

export type SortOption = 'date_desc' | 'date_asc' | 'title_asc' | 'duration_desc';

export type DateRange = 'all' | 'week' | 'month';

export interface DashboardFilters {
  search: string;
  statuses: MeetingStatus[];
  companies: string[];
  sentiments: SentimentType[];
  purchaseIntents: PurchaseIntent[];
  processingMode: ProcessingMode | 'all';
  dateRange: DateRange;
  sort: SortOption;
}

export const DEFAULT_FILTERS: DashboardFilters = {
  search: '',
  statuses: [],
  companies: [],
  sentiments: [],
  purchaseIntents: [],
  processingMode: 'all',
  dateRange: 'all',
  sort: 'date_desc',
};

export const STATUS_OPTIONS: { value: MeetingStatus; label: string }[] = [
  { value: 'completed', label: 'Completed' },
  { value: 'processing', label: 'Processing' },
  { value: 'recording', label: 'Ready to Process' },
  { value: 'failed', label: 'Failed' },
];

export const SORT_OPTIONS: { value: SortOption; label: string }[] = [
  { value: 'date_desc', label: 'Newest first' },
  { value: 'date_asc', label: 'Oldest first' },
  { value: 'title_asc', label: 'Title A–Z' },
  { value: 'duration_desc', label: 'Longest first' },
];

export const SENTIMENT_OPTIONS: { value: SentimentType; label: string }[] = [
  { value: 'positive', label: 'Positive' },
  { value: 'neutral', label: 'Neutral' },
  { value: 'negative', label: 'Negative' },
  { value: 'mixed', label: 'Mixed' },
];

export const INTENT_OPTIONS: { value: PurchaseIntent; label: string }[] = [
  { value: 'very_high', label: 'Very High' },
  { value: 'high', label: 'High' },
  { value: 'medium', label: 'Medium' },
  { value: 'low', label: 'Low' },
  { value: 'none', label: 'None' },
];

export const DATE_RANGE_OPTIONS: { value: DateRange; label: string }[] = [
  { value: 'all', label: 'All time' },
  { value: 'week', label: 'This week' },
  { value: 'month', label: 'This month' },
];

function inDateRange(iso: string, range: DateRange): boolean {
  if (range === 'all') return true;
  const d = new Date(iso).getTime();
  const now = Date.now();
  const days = range === 'week' ? 7 : 30;
  return d >= now - days * 24 * 60 * 60 * 1000;
}

function matchesSearch(meeting: Meeting, query: string): boolean {
  if (!query.trim()) return true;
  const q = query.toLowerCase().trim();
  const haystack = [
    meeting.title,
    meeting.customerName,
    meeting.customerCompany,
    meeting.summary?.overview,
    meeting.summary?.objective,
    ...(meeting.tags ?? []),
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  return haystack.includes(q);
}

export function filterAndSortMeetings(meetings: Meeting[], filters: DashboardFilters): Meeting[] {
  let result = meetings.filter((m) => {
    if (!matchesSearch(m, filters.search)) return false;
    if (filters.statuses.length > 0 && !filters.statuses.includes(m.status)) return false;
    if (filters.companies.length > 0 && !filters.companies.includes(m.customerCompany)) return false;
    if (filters.sentiments.length > 0 && (!m.sentiment || !filters.sentiments.includes(m.sentiment))) return false;
    if (filters.purchaseIntents.length > 0 && (!m.purchaseIntent || !filters.purchaseIntents.includes(m.purchaseIntent))) return false;
    if (filters.processingMode !== 'all' && m.processingMode !== filters.processingMode) return false;
    if (!inDateRange(m.date, filters.dateRange)) return false;
    return true;
  });

  result = [...result].sort((a, b) => {
    switch (filters.sort) {
      case 'date_asc':
        return new Date(a.date).getTime() - new Date(b.date).getTime();
      case 'title_asc':
        return a.title.localeCompare(b.title);
      case 'duration_desc':
        return b.duration - a.duration;
      case 'date_desc':
      default:
        return new Date(b.date).getTime() - new Date(a.date).getTime();
    }
  });

  return result;
}

export function getUniqueCompanies(meetings: Meeting[]): string[] {
  return [...new Set(meetings.map((m) => m.customerCompany).filter(Boolean))].sort((a, b) =>
    a.localeCompare(b),
  );
}

export function countActiveFilters(filters: DashboardFilters): number {
  let n = 0;
  if (filters.search.trim()) n++;
  if (filters.statuses.length > 0) n++;
  if (filters.companies.length > 0) n++;
  if (filters.sentiments.length > 0) n++;
  if (filters.purchaseIntents.length > 0) n++;
  if (filters.processingMode !== 'all') n++;
  if (filters.dateRange !== 'all') n++;
  return n;
}

export function countByStatus(meetings: Meeting[]): Record<MeetingStatus, number> {
  return meetings.reduce(
    (acc, m) => {
      acc[m.status] = (acc[m.status] ?? 0) + 1;
      return acc;
    },
    { completed: 0, processing: 0, recording: 0, failed: 0 } as Record<MeetingStatus, number>,
  );
}

const FILTERS_STORAGE_KEY = 'ssmi-dashboard-filters';

export function loadSavedFilters(): DashboardFilters {
  if (typeof window === 'undefined') return DEFAULT_FILTERS;
  try {
    const raw = localStorage.getItem(FILTERS_STORAGE_KEY);
    if (!raw) return DEFAULT_FILTERS;
    return { ...DEFAULT_FILTERS, ...JSON.parse(raw) };
  } catch {
    return DEFAULT_FILTERS;
  }
}

export function saveFilters(filters: DashboardFilters): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(FILTERS_STORAGE_KEY, JSON.stringify(filters));
  } catch {
    // ignore quota errors
  }
}
