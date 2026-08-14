'use client';

// The rep's own scoreboard. Knocks and conversations first, because those
// are the two things a rep controls; the ratios follow underneath.

import { fieldPlatform } from './platform';
import type { FieldRep, FieldStats, FieldTotals } from './types';

export function MePanel({
  rep,
  stats,
  onLogout,
}: {
  rep: FieldRep;
  stats: FieldStats | null;
  onLogout: () => void;
}) {
  const version = fieldPlatform().version;
  return (
    <div className="field-me">
      <section className="field-me-block">
        <h2>Today</h2>
        <Scoreboard totals={stats?.today ?? null} />
      </section>

      <section className="field-me-block">
        <h2>Last 7 days</h2>
        <Scoreboard totals={stats?.week ?? null} />
        {stats?.week && stats.week.contacts > 0 && (
          <p className="field-me-note">
            {pct(stats.week.contactRate)} of doors answered, and {pct(stats.week.closeRate)} of those
            conversations closed.
            {stats.week.knocksPerSale !== null &&
              ` That is ${Math.round(stats.week.knocksPerSale)} knocks per sale.`}
          </p>
        )}
      </section>

      {stats?.team && (
        <section className="field-me-block">
          <h2>Team, last 7 days</h2>
          <Scoreboard totals={stats.team} />
        </section>
      )}

      <section className="field-me-block">
        <h2>Account</h2>
        <p className="field-me-note">
          {rep.name} · {rep.email}
          {rep.team ? ` · ${rep.team}` : ''}
        </p>
        <button type="button" className="field-signout" onClick={onLogout}>
          Sign out
        </button>
        <p className="field-me-note field-me-fine">
          Signing out clears anything still waiting to send from this phone. Make sure you are synced
          first.
        </p>
        {/* So a rep reporting a problem can say which build they are on,
            which is the difference between a fixed bug and a mystery. */}
        {version && <p className="field-me-note field-me-fine">Version {version}</p>}
      </section>
    </div>
  );
}

function Scoreboard({ totals }: { totals: FieldTotals | null }) {
  const cells: Array<[string, string]> = [
    ['Knocks', totals ? String(totals.visits) : '..'],
    ['Conversations', totals ? String(totals.contacts) : '..'],
    ['Appointments', totals ? String(totals.appointments) : '..'],
    ['Sales', totals ? String(totals.sales) : '..'],
  ];
  return (
    <div className="field-score">
      {cells.map(([label, value]) => (
        <div className="field-score-cell" key={label}>
          <span className="field-score-value">{value}</span>
          <span className="field-score-label">{label}</span>
        </div>
      ))}
    </div>
  );
}

function pct(ratio: number): string {
  return `${Math.round(ratio * 100)}%`;
}
