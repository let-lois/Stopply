'use client';

// Work Backwards: the reverse funnel for the master date range, top down
// through the tenant's labeled stages, bars split into channel colored
// segments, conversion rates between stages, cost per lead and cost per
// completed, and a ROAS card per channel. All from monthly_metrics.

import { channelColor, fmtMoney, fmtNum, fmtPct } from '@/lib/format';
import { mergeMonthData } from '@/lib/mergeMonthData';
import { monthsInRange } from '@/lib/monthRange';
import type { AdLineItem, FunnelLabels } from '@/lib/types';
import { useMonthRangeData } from '@/lib/useMonthRangeData';

// Groups ad line items by treatment (a campaign-level tag, e.g. "BBL",
// "PDO Threads") for tenants that report per treatment/service line.
// Tenants that don't tag campaigns this way simply have none of these
// groups, and the section doesn't render.
function groupByTreatment(
  campaigns: { channel: string; campaign: string; treatment: string | null }[],
  adLineItems: AdLineItem[]
): Array<{ channel: string; treatment: string; ads: AdLineItem[] }> {
  const treatmentByKey = new Map<string, string>();
  for (const c of campaigns) {
    if (c.treatment) treatmentByKey.set(`${c.channel}|${c.campaign}`, c.treatment);
  }
  if (treatmentByKey.size === 0) return [];

  const map = new Map<string, { channel: string; treatment: string; ads: AdLineItem[] }>();
  for (const a of adLineItems) {
    const treatment = treatmentByKey.get(`${a.channel}|${a.campaign}`);
    if (!treatment) continue;
    const key = `${a.channel}|${treatment}`;
    const cur = map.get(key);
    if (cur) cur.ads.push(a);
    else map.set(key, { channel: a.channel, treatment, ads: [a] });
  }
  return [...map.values()];
}

function groupTotals(ads: AdLineItem[]) {
  const spend = ads.reduce((a, r) => a + r.spend, 0);
  const leads = ads.reduce((a, r) => a + (r.leads_reported ?? 0), 0);
  const shows = ads.reduce((a, r) => a + (r.completed ?? 0), 0);
  const bookings = ads.reduce((a, r) => a + (r.purchases ?? 0), 0);
  return { spend, leads, shows, bookings };
}

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
  const treatmentGroups = data ? groupByTreatment(data.campaigns, data.adLineItems) : [];
  const treatmentChannels = [...new Set(treatmentGroups.map((g) => g.channel))];

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

          {treatmentChannels.length > 0 && (
            <>
              <h3>Campaigns by treatment</h3>
              <div className="stack" style={{ gap: 20 }}>
                {treatmentChannels.map((channel) => {
                  const groups = treatmentGroups.filter((g) => g.channel === channel);
                  const channelTotals = groupTotals(groups.flatMap((g) => g.ads));
                  return (
                    <div key={channel} className="stack" style={{ gap: 12 }}>
                      <div className="row" style={{ gap: 6 }}>
                        <span style={{ color: channelColor(channel) }}>{'●'}</span>
                        <strong>{channel}</strong>
                      </div>
                      {groups.map((g) => {
                        const t = groupTotals(g.ads);
                        return (
                          <div key={g.treatment} className="campaign-block stack" style={{ gap: 10 }}>
                            <span style={{ fontWeight: 700, fontSize: 15 }}>{g.treatment}</span>
                            <div className="campaign-stats">
                              <span>
                                <span className="muted">Spend</span>
                                <span className="num">{fmtMoney(t.spend)}</span>
                              </span>
                              <span>
                                <span className="muted">Leads</span>
                                <span className="num">{fmtNum(t.leads)}</span>
                              </span>
                              <span>
                                <span className="muted">Shows</span>
                                <span className="num">{fmtNum(t.shows)}</span>
                              </span>
                              <span>
                                <span className="muted">Conversion rate</span>
                                <span className="num">{t.leads > 0 ? fmtPct(t.bookings / t.leads) : '-'}</span>
                              </span>
                              <span>
                                <span className="muted">Cost / lead</span>
                                <span className="num">{t.leads > 0 ? fmtMoney(t.spend / t.leads) : '-'}</span>
                              </span>
                              <span>
                                <span className="muted">Cost / booking</span>
                                <span className="num">{t.bookings > 0 ? fmtMoney(t.spend / t.bookings) : '-'}</span>
                              </span>
                            </div>
                            <div style={{ overflowX: 'auto' }}>
                              <table className="data">
                                <thead>
                                  <tr>
                                    <th>Creative</th>
                                    <th>Spend</th>
                                    <th>Leads</th>
                                    <th>Shows</th>
                                    <th>Conversion rate</th>
                                    <th>Cost / lead</th>
                                    <th>Cost / booking</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {g.ads.map((a) => {
                                    const leads = a.leads_reported ?? 0;
                                    const bookings = a.purchases ?? 0;
                                    return (
                                      <tr key={`${a.channel}|${a.campaign}|${a.ad_name}`}>
                                        <td>{a.ad_name}</td>
                                        <td className="num">{fmtMoney(a.spend)}</td>
                                        <td className="num">{leads || '—'}</td>
                                        <td className="num">{a.completed ?? '—'}</td>
                                        <td className="num">{leads > 0 ? fmtPct(bookings / leads) : '—'}</td>
                                        <td className="num">{leads > 0 ? fmtMoney(a.spend / leads) : '—'}</td>
                                        <td className="num">{bookings > 0 ? fmtMoney(a.spend / bookings) : '—'}</td>
                                      </tr>
                                    );
                                  })}
                                </tbody>
                              </table>
                            </div>
                          </div>
                        );
                      })}
                      <div className="row" style={{ justifyContent: 'space-between', fontWeight: 700 }}>
                        <span>Totals</span>
                        <span className="num">
                          {fmtMoney(channelTotals.spend)} · {fmtNum(channelTotals.leads)} leads ·{' '}
                          {fmtNum(channelTotals.shows)} shows
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}
