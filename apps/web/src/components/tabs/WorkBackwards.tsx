'use client';

// Work Backwards: the reverse funnel for the master date range, top down
// through the tenant's labeled stages, bars split into channel colored
// segments, conversion rates between stages, cost per lead and cost per
// completed, and a ROAS card per channel. All from monthly_metrics.

import { channelColor, fmtMoney, fmtNum, fmtPct } from '@/lib/format';
import { mergeMonthData } from '@/lib/mergeMonthData';
import { monthsInRange } from '@/lib/monthRange';
import type { FunnelLabels } from '@/lib/types';
import { useMonthRangeData } from '@/lib/useMonthRangeData';

export function WorkBackwardsTab({
  labels,
  months,
  rangeStart,
  rangeEnd,
}: {
  labels: FunnelLabels;
  months: string[];
  rangeStart: string;
  rangeEnd: string;
}) {
  const selectedMonths = monthsInRange(months, rangeStart, rangeEnd);
  const { raw } = useMonthRangeData(selectedMonths, 'first');
  const data = mergeMonthData(raw);

  if (months.length === 0) {
    return <div className="card muted">No months yet. Import data first.</div>;
  }

  const stages: Array<{ key: 'purchases' | 'completed' | 'scheduled' | 'leads'; label: string }> = [
    { key: 'purchases', label: labels.purchase },
    { key: 'completed', label: labels.completed },
    { key: 'scheduled', label: labels.scheduled },
    { key: 'leads', label: labels.lead },
  ];

  const total = (field: 'purchases' | 'completed' | 'scheduled' | 'leads' | 'spend' | 'revenue') =>
    (data?.channels ?? []).reduce((a, ch) => a + Number(ch[field]), 0);

  const maxCount = Math.max(...stages.map((s) => total(s.key)), 1);

  return (
    <div className="stack" style={{ gap: 20 }}>
      <h2>KPIs</h2>

      {!data && <div className="skeleton" style={{ minHeight: 200 }} />}
      {data && (
        <>
          <div className="card stack">
            {stages.map((stage, idx) => {
              const value = total(stage.key);
              const next = idx < stages.length - 1 ? total(stages[idx + 1]!.key) : null;
              const rate = next && next > 0 ? value / next : null;
              return (
                <div key={stage.key} className="stack" style={{ gap: 4 }}>
                  <div className="row" style={{ justifyContent: 'space-between' }}>
                    <strong>{stage.label}</strong>
                    <span className="num">{fmtNum(value)}</span>
                  </div>
                  <div className="funnel-bar" style={{ width: `${Math.max((value / maxCount) * 100, 4)}%` }}>
                    {data.channels
                      .filter((ch) => Number(ch[stage.key]) > 0)
                      .map((ch) => (
                        <div
                          key={ch.channel}
                          className="funnel-seg"
                          title={`${ch.channel}: ${fmtNum(Number(ch[stage.key]))}`}
                          style={{
                            background: channelColor(ch.channel),
                            width: `${(Number(ch[stage.key]) / Math.max(value, 1)) * 100}%`,
                          }}
                        />
                      ))}
                  </div>
                  {rate !== null && (
                    <span className="muted" style={{ fontSize: 12 }}>
                      {fmtPct(rate)} of {stages[idx + 1]!.label.toLowerCase()} convert
                    </span>
                  )}
                </div>
              );
            })}
          </div>

          <div className="kpi-grid">
            <div className="kpi">
              <div className="label">Cost per {labels.lead.replace(/s$/, '').toLowerCase()}</div>
              <div className="value num">{total('leads') > 0 ? fmtMoney(total('spend') / total('leads')) : '-'}</div>
            </div>
            <div className="kpi">
              <div className="label">Cost per {labels.completed.replace(/s$/, '').toLowerCase()}</div>
              <div className="value num">
                {total('completed') > 0 ? fmtMoney(total('spend') / total('completed')) : '-'}
              </div>
            </div>
            {data.channels
              .filter((ch) => ch.spend > 0)
              .map((ch) => (
                <div className="kpi" key={ch.channel}>
                  <div className="label">{ch.channel} ROAS</div>
                  <div className="value num" style={{ color: channelColor(ch.channel) }}>
                    {(ch.revenue / ch.spend).toFixed(1)}x
                  </div>
                </div>
              ))}
          </div>
        </>
      )}
    </div>
  );
}
