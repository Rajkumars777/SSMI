'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
import Link from 'next/link';
import MeetingCard from '@/components/MeetingCard';
import { apiClient, type DashboardStats } from '@/lib/api';
import type { Meeting } from '@/lib/types';
import { loadSettings, getBookmarkDisplayLabel, getStopDisplayLabel, DEFAULT_SETTINGS, type SSMISettings } from '@/lib/settings';
import {
  DEFAULT_FILTERS,
  STATUS_OPTIONS,
  SORT_OPTIONS,
  SENTIMENT_OPTIONS,
  INTENT_OPTIONS,
  DATE_RANGE_OPTIONS,
  filterAndSortMeetings,
  getUniqueCompanies,
  countActiveFilters,
  countByStatus,
  loadSavedFilters,
  saveFilters,
  type DashboardFilters,
} from '@/lib/dashboardFilters';
import styles from './page.module.css';

export default function DashboardPage() {
  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const [stats, setStats] = useState<DashboardStats>({
    totalMeetings: 0,
    totalActionItems: 0,
    avgMeetingMinutes: 0,
    hoursSaved: 0,
    meetingsThisWeek: 0,
    conversionRate: 0,
  });
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [settings, setSettings] = useState<SSMISettings>(DEFAULT_SETTINGS);
  const [filters, setFilters] = useState<DashboardFilters>(() =>
    typeof window !== 'undefined' ? loadSavedFilters() : DEFAULT_FILTERS,
  );
  const [filtersExpanded, setFiltersExpanded] = useState(true);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [selectionMode, setSelectionMode] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [bulkBusy, setBulkBusy] = useState(false);

  useEffect(() => {
    saveFilters(filters);
  }, [filters]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault();
        document.getElementById('dashboard-search')?.focus();
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    function reloadSettings() { setSettings(loadSettings()); }
    reloadSettings();
    window.addEventListener('ssmi-settings-changed', reloadSettings);
    return () => window.removeEventListener('ssmi-settings-changed', reloadSettings);
  }, []);

  const fetchData = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    else setRefreshing(true);
    try {
      const [meetingsData, statsData] = await Promise.all([
        apiClient.getMeetings(),
        apiClient.getDashboardStats(),
      ]);
      setMeetings(meetingsData);
      setStats(statsData);
      return meetingsData;
    } catch (err) {
      console.warn('[SSMI Dashboard] Backend unavailable:', err);
      setMeetings([]);
      return [] as Meeting[];
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    let pollInterval: ReturnType<typeof setInterval> | null = null;

    fetchData().then((meetingsData) => {
      const hasProcessing = meetingsData.some(
        (m) => m.status === 'processing' || m.status === 'recording',
      );
      if (hasProcessing) {
        pollInterval = setInterval(async () => {
          const updated = await fetchData(true);
          const stillProcessing = updated.some(
            (m) => m.status === 'processing' || m.status === 'recording',
          );
          if (!stillProcessing && pollInterval) {
            clearInterval(pollInterval);
            pollInterval = null;
          }
        }, 5000);
      }
    });

    return () => { if (pollInterval) clearInterval(pollInterval); };
  }, [fetchData]);

  const companies = useMemo(() => getUniqueCompanies(meetings), [meetings]);
  const filteredMeetings = useMemo(
    () => filterAndSortMeetings(meetings, filters),
    [meetings, filters],
  );
  const activeFilterCount = countActiveFilters(filters);
  const statusCounts = useMemo(() => countByStatus(meetings), [meetings]);

  const updateCompanies = (values: string[]) => setFilters((f) => ({ ...f, companies: values }));
  const updateSentiments = (values: string[]) =>
    setFilters((f) => ({ ...f, sentiments: values as DashboardFilters['sentiments'] }));
  const updateIntents = (values: string[]) =>
    setFilters((f) => ({ ...f, purchaseIntents: values as DashboardFilters['purchaseIntents'] }));

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectAllVisible = () => {
    setSelectedIds(new Set(filteredMeetings.map((m) => m.id)));
  };

  const clearSelection = () => setSelectedIds(new Set());

  const exitSelectionMode = () => {
    setSelectionMode(false);
    clearSelection();
  };

  const handleDeleteMeeting = async (meetingId: string) => {
    if (!meetingId) return;
    setDeletingId(meetingId);
    try {
      await apiClient.deleteMeeting(meetingId);
      setMeetings((prev) => prev.filter((m) => m.id !== meetingId));
      setSelectedIds((prev) => {
        const next = new Set(prev);
        next.delete(meetingId);
        return next;
      });
      const statsData = await apiClient.getDashboardStats();
      setStats(statsData);
    } catch (err) {
      console.error('[SSMI] Delete failed:', err);
      await fetchData(true);
      alert(err instanceof Error ? err.message : 'Could not delete meeting');
    } finally {
      setDeletingId(null);
    }
  };

  const handleBulkDelete = async () => {
    if (selectedIds.size === 0) return;
    if (!confirm(`Delete ${selectedIds.size} selected meeting(s)? This cannot be undone.`)) return;
    setBulkBusy(true);
    const ids = [...selectedIds];
    let failed = 0;
    for (const id of ids) {
      try {
        await apiClient.deleteMeeting(id);
        setMeetings((prev) => prev.filter((m) => m.id !== id));
      } catch {
        failed++;
      }
    }
    clearSelection();
    await fetchData(true);
    setBulkBusy(false);
    if (failed > 0) alert(`${failed} meeting(s) could not be deleted.`);
  };

  const handleBulkProcess = async () => {
    const eligible = filteredMeetings.filter(
      (m) => selectedIds.has(m.id) && (m.status === 'recording' || m.status === 'failed'),
    );
    if (eligible.length === 0) {
      alert('No selected meetings are ready to process.');
      return;
    }
    if (!confirm(`Start AI processing for ${eligible.length} meeting(s)?`)) return;
    setBulkBusy(true);
    for (const m of eligible) {
      try {
        await apiClient.processMeeting(m.id);
      } catch (err) {
        console.warn('[SSMI] Bulk process failed for', m.id, err);
      }
    }
    clearSelection();
    await fetchData(true);
    setBulkBusy(false);
  };

  const handleMeetingUpdate = (updated: Meeting) => {
    setMeetings((prev) => prev.map((m) => (m.id === updated.id ? updated : m)));
  };

  const toggleStatusFilter = (status: typeof STATUS_OPTIONS[number]['value']) => {
    setFilters((f) => {
      const has = f.statuses.includes(status);
      return {
        ...f,
        statuses: has ? f.statuses.filter((s) => s !== status) : [...f.statuses, status],
      };
    });
  };

  const toggleCompanyFilter = (company: string) => {
    setFilters((f) => {
      const has = f.companies.includes(company);
      return {
        ...f,
        companies: has ? f.companies.filter((c) => c !== company) : [...f.companies, company],
      };
    });
  };

  const resetFilters = () => setFilters(DEFAULT_FILTERS);

  const statCards = [
    {
      label: 'Total Meetings',
      value: stats.totalMeetings,
      suffix: '',
      icon: (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
          <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
          <circle cx="9" cy="7" r="4" />
          <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
          <path d="M16 3.13a4 4 0 0 1 0 7.75" />
        </svg>
      ),
      color: '#4f8ef7',
    },
    {
      label: 'Action Items',
      value: stats.totalActionItems,
      suffix: '',
      icon: (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
          <polyline points="9 11 12 14 22 4" />
          <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
        </svg>
      ),
      color: '#22d3a0',
    },
    {
      label: 'Avg Meeting Length',
      value: stats.avgMeetingMinutes,
      suffix: 'min',
      icon: (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
          <circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" />
        </svg>
      ),
      color: '#f59e0b',
    },
    {
      label: 'Hours Saved',
      value: stats.hoursSaved,
      suffix: 'hrs',
      icon: (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
          <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
        </svg>
      ),
      color: '#7c5df0',
    },
  ];

  const selectedProcessable = filteredMeetings.filter(
    (m) => selectedIds.has(m.id) && (m.status === 'recording' || m.status === 'failed'),
  ).length;

  return (
    <div className={`page-wrapper ${styles.root}`}>
      <div className="container">
        <div className={styles.pageHeader}>
          <div>
            <h1 className={styles.title}>Dashboard</h1>
            <p className={styles.subtitle}>Your meeting intelligence hub</p>
          </div>
          <div className={styles.headerActions}>
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => fetchData(true)}
              disabled={refreshing}
              title="Refresh meetings"
            >
              {refreshing ? 'Refreshing…' : '↻ Refresh'}
            </button>
            <Link href="/search" className="btn btn-secondary">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
              </svg>
              Advanced Search
            </Link>
            <Link href="/meeting/new" className="btn btn-primary">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <circle cx="12" cy="12" r="6" fill="currentColor" opacity="0.3" />
                <circle cx="12" cy="12" r="3" fill="currentColor" />
              </svg>
              New Meeting
            </Link>
          </div>
        </div>

        <div className={styles.statsGrid}>
          {statCards.map((s) => (
            <div
              key={s.label}
              className={`glass-card ${styles.statCard}`}
              style={{ '--card-color': s.color } as React.CSSProperties}
            >
              <div className={styles.statIcon} style={{ color: s.color }}>{s.icon}</div>
              <div className={styles.statInfo}>
                <span className={styles.statValue}>
                  {s.value}<span className={styles.statSuffix}>{s.suffix}</span>
                </span>
                <span className={styles.statLabel}>{s.label}</span>
              </div>
            </div>
          ))}
        </div>

        <div className={styles.quickRow}>
          <div className={`glass-card ${styles.quickCard}`}>
            <div className={styles.quickIcon} style={{ color: 'var(--accent-blue)' }}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
                <line x1="16" y1="2" x2="16" y2="6" />
                <line x1="8" y1="2" x2="8" y2="6" />
                <line x1="3" y1="10" x2="21" y2="10" />
              </svg>
            </div>
            <div>
              <div className={styles.quickVal}>{stats.meetingsThisWeek}</div>
              <div className={styles.quickLabel}>Meetings this week</div>
            </div>
          </div>
          <div className={`glass-card ${styles.quickCard}`}>
            <div className={styles.quickIcon} style={{ color: 'var(--accent-green)' }}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
                <polyline points="22 4 12 14.01 9 11.01" />
              </svg>
            </div>
            <div>
              <div className={styles.quickVal}>{stats.conversionRate}%</div>
              <div className={styles.quickLabel}>Conversion rate</div>
            </div>
          </div>
          <Link href="/settings" className={`glass-card ${styles.quickCard} ${styles.voiceHint}`} style={{ textDecoration: 'none' }}>
            <div className={styles.quickIcon} style={{ color: 'var(--accent-amber)' }}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
                <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                <line x1="12" y1="19" x2="12" y2="23" />
                <line x1="8" y1="23" x2="16" y2="23" />
              </svg>
            </div>
            <div>
              <div className={styles.quickVal}>Voice Gesture Ready</div>
              <div className={styles.quickLabel}>
                {getBookmarkDisplayLabel(settings)} (Bookmark) · {getStopDisplayLabel(settings)} (Stop)
              </div>
            </div>
          </Link>
        </div>

        <div className={styles.meetingsSection}>
          <div className={styles.meetingsHeader}>
            <div>
              <h2>Recent Meetings</h2>
              <p className={styles.resultCount}>
                Showing {filteredMeetings.length} of {meetings.length} meetings
                {activeFilterCount > 0 && ` · ${activeFilterCount} filter${activeFilterCount > 1 ? 's' : ''} active`}
              </p>
            </div>
            <div className={styles.headerToolbar}>
              <button
                type="button"
                className={`btn btn-sm ${selectionMode ? 'btn-primary' : 'btn-secondary'}`}
                onClick={() => {
                  if (selectionMode) exitSelectionMode();
                  else setSelectionMode(true);
                }}
              >
                {selectionMode ? 'Cancel Select' : 'Select Multiple'}
              </button>
            </div>
          </div>

          {/* Search & filter toolbar */}
          <div className={`glass-card ${styles.toolbar}`}>
            <div className={styles.toolbarTop}>
              <div className={styles.searchWrap}>
                <svg className={styles.searchIcon} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
                </svg>
                <input
                  id="dashboard-search"
                  type="search"
                  className={`input ${styles.searchInput}`}
                  placeholder="Search title, customer, company, summary…"
                  value={filters.search}
                  onChange={(e) => setFilters((f) => ({ ...f, search: e.target.value }))}
                  aria-label="Search meetings"
                />
                {filters.search && (
                  <button
                    type="button"
                    className={styles.clearSearch}
                    onClick={() => setFilters((f) => ({ ...f, search: '' }))}
                    aria-label="Clear search"
                  >
                    ×
                  </button>
                )}
                <kbd className={styles.searchHint}>Ctrl+K</kbd>
              </div>
              <button
                type="button"
                className={`btn btn-ghost btn-sm ${styles.filterToggle}`}
                onClick={() => setFiltersExpanded((v) => !v)}
              >
                {filtersExpanded ? 'Hide filters' : 'Show filters'}
                {activeFilterCount > 0 && (
                  <span className={styles.filterBadge}>{activeFilterCount}</span>
                )}
              </button>
            </div>

            {filtersExpanded && (
              <>
                <div className={styles.toolbarRow}>
                  <div className={styles.filterGroup}>
                    <label className={styles.filterLabel}>Status (multi-select)</label>
                    <div className={styles.chipGroup}>
                      {STATUS_OPTIONS.map(({ value, label }) => (
                        <button
                          key={value}
                          type="button"
                          className={`${styles.chip} ${filters.statuses.includes(value) ? styles.chipActive : ''}`}
                          onClick={() => toggleStatusFilter(value)}
                        >
                          {label}
                          <span className={styles.chipCount}>{statusCounts[value] ?? 0}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                </div>

                <div className={styles.toolbarRow}>
                  <div className={styles.filterGroup}>
                    <label className={styles.filterLabel} htmlFor="sort-select">Sort by</label>
                    <select
                      id="sort-select"
                      className={`input ${styles.select}`}
                      value={filters.sort}
                      onChange={(e) => setFilters((f) => ({ ...f, sort: e.target.value as DashboardFilters['sort'] }))}
                    >
                      {SORT_OPTIONS.map((o) => (
                        <option key={o.value} value={o.value}>{o.label}</option>
                      ))}
                    </select>
                  </div>

                  <div className={styles.filterGroup}>
                    <label className={styles.filterLabel} htmlFor="mode-select">Processing mode</label>
                    <select
                      id="mode-select"
                      className={`input ${styles.select}`}
                      value={filters.processingMode}
                      onChange={(e) => setFilters((f) => ({
                        ...f,
                        processingMode: e.target.value as DashboardFilters['processingMode'],
                      }))}
                    >
                      <option value="all">All modes</option>
                      <option value="accurate">Max Accuracy</option>
                      <option value="fast">Fast Mode</option>
                    </select>
                  </div>

                  <div className={styles.filterGroup}>
                    <label className={styles.filterLabel} htmlFor="date-select">Date range</label>
                    <select
                      id="date-select"
                      className={`input ${styles.select}`}
                      value={filters.dateRange}
                      onChange={(e) => setFilters((f) => ({
                        ...f,
                        dateRange: e.target.value as DashboardFilters['dateRange'],
                      }))}
                    >
                      {DATE_RANGE_OPTIONS.map((o) => (
                        <option key={o.value} value={o.value}>{o.label}</option>
                      ))}
                    </select>
                  </div>
                </div>

                <div className={styles.toolbarRow}>
                  {companies.length > 0 && (
                    <div className={styles.filterGroup}>
                      <label className={styles.filterLabel} htmlFor="company-multi">
                        Company (multi-select) — hold Ctrl/Cmd
                      </label>
                      <select
                        id="company-multi"
                        multiple
                        className={`input ${styles.multiSelect}`}
                        value={filters.companies}
                        onChange={(e) => {
                          const selected = Array.from(e.target.selectedOptions, (o) => o.value);
                          updateCompanies(selected);
                        }}
                      >
                        {companies.map((company) => (
                          <option key={company} value={company}>{company}</option>
                        ))}
                      </select>
                    </div>
                  )}

                  <div className={styles.filterGroup}>
                    <label className={styles.filterLabel} htmlFor="sentiment-multi">Sentiment (multi-select)</label>
                    <select
                      id="sentiment-multi"
                      multiple
                      className={`input ${styles.multiSelect}`}
                      value={filters.sentiments}
                      onChange={(e) => {
                        const selected = Array.from(e.target.selectedOptions, (o) => o.value);
                        updateSentiments(selected);
                      }}
                    >
                      {SENTIMENT_OPTIONS.map((o) => (
                        <option key={o.value} value={o.value}>{o.label}</option>
                      ))}
                    </select>
                  </div>

                  <div className={styles.filterGroup}>
                    <label className={styles.filterLabel} htmlFor="intent-multi">Purchase intent (multi-select)</label>
                    <select
                      id="intent-multi"
                      multiple
                      className={`input ${styles.multiSelect}`}
                      value={filters.purchaseIntents}
                      onChange={(e) => {
                        const selected = Array.from(e.target.selectedOptions, (o) => o.value);
                        updateIntents(selected);
                      }}
                    >
                      {INTENT_OPTIONS.map((o) => (
                        <option key={o.value} value={o.value}>{o.label}</option>
                      ))}
                    </select>
                  </div>
                </div>

                {companies.length > 0 && (
                  <div className={styles.filterGroup}>
                    <label className={styles.filterLabel}>Quick company filter</label>
                    <div className={styles.chipGroup}>
                      {companies.slice(0, 12).map((company) => (
                        <button
                          key={company}
                          type="button"
                          className={`${styles.chip} ${filters.companies.includes(company) ? styles.chipActive : ''}`}
                          onClick={() => toggleCompanyFilter(company)}
                        >
                          {company}
                        </button>
                      ))}
                      {companies.length > 12 && (
                        <span className={styles.moreHint}>+{companies.length - 12} more in dropdown</span>
                      )}
                    </div>
                  </div>
                )}

                {activeFilterCount > 0 && (
                  <div className={styles.activeFilters}>
                    <span className={styles.filterLabel}>Active:</span>
                    {filters.search && (
                      <span className={styles.activePill}>Search: &quot;{filters.search}&quot;</span>
                    )}
                    {filters.statuses.map((s) => (
                      <span key={s} className={styles.activePill}>
                        {STATUS_OPTIONS.find((o) => o.value === s)?.label}
                      </span>
                    ))}
                    {filters.companies.map((c) => (
                      <span key={c} className={styles.activePill}>{c}</span>
                    ))}
                    <button type="button" className={`btn btn-ghost btn-sm ${styles.resetFilters}`} onClick={resetFilters}>
                      Clear all
                    </button>
                  </div>
                )}
              </>
            )}
          </div>

          {/* Bulk action bar */}
          {selectionMode && (
            <div className={`glass-card ${styles.bulkBar}`}>
              <div className={styles.bulkLeft}>
                <label className={styles.selectAllLabel}>
                  <input
                    type="checkbox"
                    checked={filteredMeetings.length > 0 && filteredMeetings.every((m) => selectedIds.has(m.id))}
                    onChange={(e) => (e.target.checked ? selectAllVisible() : clearSelection())}
                  />
                  Select all visible ({filteredMeetings.length})
                </label>
                {selectedIds.size > 0 && (
                  <span className={styles.selectedCount}>{selectedIds.size} selected</span>
                )}
              </div>
              <div className={styles.bulkActions}>
                {selectedProcessable > 0 && (
                  <button
                    type="button"
                    className="btn btn-primary btn-sm"
                    disabled={bulkBusy}
                    onClick={handleBulkProcess}
                  >
                    Process Selected ({selectedProcessable})
                  </button>
                )}
                {selectedIds.size > 0 && (
                  <button
                    type="button"
                    className="btn btn-danger btn-sm"
                    disabled={bulkBusy}
                    onClick={handleBulkDelete}
                  >
                    Delete Selected ({selectedIds.size})
                  </button>
                )}
                {selectedIds.size > 0 && (
                  <button type="button" className="btn btn-ghost btn-sm" onClick={clearSelection}>
                    Clear
                  </button>
                )}
              </div>
            </div>
          )}

          {loading ? (
            <div className={styles.emptyState}>Loading meetings from backend database…</div>
          ) : meetings.length === 0 ? (
            <div className={styles.emptyCard}>
              <h3>No meetings recorded yet</h3>
              <p>Start a live meeting recording or upload an audio file to extract AI intelligence.</p>
              <Link href="/meeting/new" className="btn btn-primary">Start New Meeting</Link>
            </div>
          ) : filteredMeetings.length === 0 ? (
            <div className={styles.emptyCard}>
              <h3>No meetings match your filters</h3>
              <p>Try adjusting search or filter options.</p>
              <button type="button" className="btn btn-secondary" onClick={resetFilters}>Clear filters</button>
            </div>
          ) : (
            <div className={styles.meetingsList}>
              {filteredMeetings.map((m) => (
                <MeetingCard
                  key={m.id}
                  meeting={m}
                  onDelete={handleDeleteMeeting}
                  onUpdate={handleMeetingUpdate}
                  deleting={deletingId === m.id}
                  selectable={selectionMode}
                  selected={selectedIds.has(m.id)}
                  onSelectToggle={() => toggleSelect(m.id)}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
