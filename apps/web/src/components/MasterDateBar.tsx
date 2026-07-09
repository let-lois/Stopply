'use client';

// One master month/range control shown once above the client-facing
// dashboard. Performance, WorkBackwards, Present, and Planning all read
// their selected period from here instead of each keeping its own picker.

import { monthLabel } from '@/lib/format';

export function MasterDateBar({
  months,
  timezone,
  start,
  end,
  onChange,
}: {
  months: string[];
  timezone: string;
  start: string;
  end: string;
  onChange: (start: string, end: string) => void;
}) {
  if (months.length === 0) return null;

  const endIdx = months.indexOf(end);

  // Arrows always collapse back to a single month, stepping from the
  // range's end month.
  const step = (dir: -1 | 1) => {
    const next = months[endIdx + dir];
    if (next) onChange(next, next);
  };

  return (
    <div className="row master-date-bar" style={{ gap: 20, flexWrap: 'wrap' }}>
      <div className="row" style={{ gap: 8, width: 'auto' }}>
        <button className="small" aria-label="Previous month" onClick={() => step(1)} disabled={endIdx + 1 >= months.length}>
          &larr;
        </button>
        <select
          value={end}
          onChange={(e) => onChange(e.target.value, e.target.value)}
          aria-label="Month"
          style={{ width: 'auto' }}
        >
          {months.map((m) => (
            <option key={m} value={m}>
              {monthLabel(m, timezone)}
            </option>
          ))}
        </select>
        <button className="small" aria-label="Next month" onClick={() => step(-1)} disabled={endIdx <= 0}>
          &rarr;
        </button>
      </div>

      <label className="row" style={{ gap: 8, width: 'auto', fontSize: 13, color: 'var(--ink-soft)' }}>
        Date range
        <select value={start} onChange={(e) => onChange(e.target.value, end)} aria-label="Range start" style={{ width: 'auto' }}>
          {months.map((m) => (
            <option key={m} value={m}>
              {monthLabel(m, timezone)}
            </option>
          ))}
        </select>
        <span className="muted">to</span>
        <select value={end} onChange={(e) => onChange(start, e.target.value)} aria-label="Range end" style={{ width: 'auto' }}>
          {months.map((m) => (
            <option key={m} value={m}>
              {monthLabel(m, timezone)}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}
