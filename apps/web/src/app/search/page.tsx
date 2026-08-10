'use client';

import { useState } from 'react';
import Link from 'next/link';
import { formatTimestamp, EVENT_TYPE_LABELS, EVENT_TYPE_COLORS } from '@/lib/mockData';
import { apiClient } from '@/lib/api';
import type { EventType, SearchResult } from '@/lib/types';
import styles from './page.module.css';

const FILTERS: { label: string; type: EventType }[] = [
  { label: 'Pricing', type: 'PRICING' },
  { label: 'Budget', type: 'BUDGET' },
  { label: 'Objection', type: 'OBJECTION' },
  { label: 'Decision', type: 'DECISION' },
  { label: 'Requirement', type: 'REQUIREMENT' },
  { label: 'Negotiation', type: 'NEGOTIATION' },
];

const importanceLabel = (level: number) => `Priority ${level}/5`;

export default function SearchPage() {
  const [query, setQuery] = useState('');
  const [activeFilters, setActiveFilters] = useState<EventType[]>([]);
  const [results, setResults] = useState<SearchResult[]>([]);
  const [searched, setSearched] = useState(false);

  function toggleFilter(type: EventType) {
    setActiveFilters((prev) =>
      prev.includes(type) ? prev.filter((f) => f !== type) : [...prev, type]
    );
  }

  async function executeSearch(qStr: string, filters: EventType[]) {
    setSearched(true);
    const filter = filters.length > 0 ? filters[0] : undefined;
    const res = await apiClient.searchMeetings(qStr, filter);
    setResults(res);
  }

  function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    executeSearch(query, activeFilters);
  }

  return (
    <div className={`page-wrapper ${styles.root}`}>
      <div className="container">
        <div className={styles.pageHeader}>
          <h1>Search Meetings</h1>
          <p>Find any meeting, topic, decision, or customer insight across your history</p>
        </div>

        {/* Search form */}
        <form onSubmit={handleSearch} className={`glass-card ${styles.searchCard}`}>
          <div className={styles.searchRow}>
            <div className={`input-icon-wrap ${styles.searchInput}`}>
              <svg className="input-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
              </svg>
              <input
                className="input"
                type="text"
                placeholder='Try "pricing objection" or "budget discussion"...'
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                id="search-input"
              />
            </div>
            <button type="submit" className="btn btn-primary" id="btn-search">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
              </svg>
              Search
            </button>
          </div>

          {/* Filters */}
          <div className={styles.filters}>
            <span className={styles.filterLabel}>Filter by event type:</span>
            <div className={styles.filterChips}>
              {FILTERS.map((f) => (
                <button
                  key={f.type}
                  type="button"
                  className={`${styles.filterChip} ${activeFilters.includes(f.type) ? styles.filterActive : ''}`}
                  onClick={() => { toggleFilter(f.type); setSearched(true); }}
                  style={{ '--chip-color': EVENT_TYPE_COLORS[f.type] } as React.CSSProperties}
                  id={`filter-${f.type}`}
                >
                  {f.label}
                </button>
              ))}
            </div>
          </div>
        </form>

        {/* Results */}
        {searched && (
          <div className={`${styles.results} fade-in-up`}>
            <div className={styles.resultsHeader}>
              <span className={styles.resultsCount}>
                {results.length} result{results.length !== 1 ? 's' : ''} found
              </span>
              {query && <span className={styles.resultsQuery}>for &ldquo;{query}&rdquo;</span>}
            </div>

            {results.length === 0 ? (
              <div className={`glass-card ${styles.noResults}`}>
                <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" style={{ color: 'var(--text-muted)' }}>
                  <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
                </svg>
                <h3>No results found</h3>
                <p>Try a different search term or remove some filters.</p>
              </div>
            ) : (
              <div className={styles.resultsList}>
                {results.map((r, i) => {
                  const color = EVENT_TYPE_COLORS[r.eventType] || '#4f8ef7';
                  return (
                    <Link
                      href={`/meeting/${r.meetingId}`}
                      key={i}
                      className={`glass-card glass-card--interactive ${styles.resultCard}`}
                      style={{ '--r-color': color } as React.CSSProperties}
                    >
                      <div className={styles.resultLeft}>
                        <div className={styles.resultMeta}>
                          <span className={styles.resultType} style={{ color, background: `${color}15`, borderColor: `${color}30` }}>
                            {EVENT_TYPE_LABELS[r.eventType]}
                          </span>
                          <span className={styles.resultCompany}>{r.customerCompany}</span>
                          <span className={styles.resultDot}>·</span>
                          <span className={styles.resultDate}>
                            {new Date(r.date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
                          </span>
                        </div>
                        <div className={styles.resultTitle}>{r.meetingTitle}</div>
                        <blockquote className={styles.resultSnippet}>{r.snippet}</blockquote>
                        <div className={styles.resultFooter}>
                          <span className={styles.resultTime}>
                            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                              <circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" />
                            </svg>
                            {formatTimestamp(r.startTime)}
                          </span>
                          <span className={styles.resultImportance}>
                            {importanceLabel(r.importance)}
                          </span>
                          <span className={styles.resultConfidence}>
                            {Math.round(r.confidence * 100)}% confidence
                          </span>
                        </div>
                      </div>
                      <div className={styles.resultArrow}>
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <polyline points="9 18 15 12 9 6" />
                        </svg>
                      </div>
                    </Link>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* Empty state before search */}
        {!searched && (
          <div className={styles.preSearch}>
            <div className={styles.preSearchGrid}>
              <div className={`glass-card ${styles.preCard}`}>
                <div className={styles.preCardIcon} style={{ color: 'var(--accent-red)' }}>
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <line x1="12" y1="1" x2="12" y2="23" />
                    <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
                  </svg>
                </div>
                <div className={styles.preCardTitle}>Pricing Objections</div>
                <div className={styles.preCardDesc}>Find all meetings where customers raised pricing concerns</div>
              </div>
              <div className={`glass-card ${styles.preCard}`}>
                <div className={styles.preCardIcon} style={{ color: 'var(--accent-amber)' }}>
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <rect x="2" y="7" width="20" height="14" rx="2" ry="2" />
                    <path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16" />
                  </svg>
                </div>
                <div className={styles.preCardTitle}>Budget Discussions</div>
                <div className={styles.preCardDesc}>Surface all budget-related conversations across your meetings</div>
              </div>
              <div className={`glass-card ${styles.preCard}`}>
                <div className={styles.preCardIcon} style={{ color: 'var(--accent-green)' }}>
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                </div>
                <div className={styles.preCardTitle}>Decisions Made</div>
                <div className={styles.preCardDesc}>Review all confirmed decisions and commitments</div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
