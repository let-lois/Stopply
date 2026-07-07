'use client';

// Performance tab: months stacked newest first, collapsible. Topline KPIs
// with direction aware deltas, the in month block and cohort strip, the
// first versus latest touch toggle, spend by platform with lazy campaign
// rows, the data quality line, source check icons, and the admin only
// leads drawer.

import { useEffect, useMemo, useState } from 'react';
import { api } from '@/lib/api';
import { channelColor, fmtMoney, fmtNum, monthLabel } from '@/lib/format';
import type { AdLineItem, Comparison, FunnelLabels, LeadRow, MonthData, SourceInfo, TenantSettings } from '@/lib/types';
import { SourceCheck } from '../SourceCheck';

const CREATIVE_TYPE_OPTIONS = ['Video', 'Carousel', 'Static', 'UGC', 'Other'];

function statusLabel(status: AdLineItem['status']): string {
  if (status === 'top') return 'Top performer';
  if (status === 'under') return 'Underperforming';
  if (status === 'watch') return 'Watch';
  return '';
}

interface Props {
  settings: TenantSettings;
  labels: FunnelLabels;
  months: string[];
  sources: SourceInfo[];
  comparison: Comparison;
  refreshSources: () => void;
}

function kpiDelta(current: number, prev: number | null, lowerIsBetter: boolean): React.ReactNode {
  if (prev === null || prev === 0) return null;
  const change = (current - prev) / Math.abs(prev);
  const rising = change > 0;
  // Direction aware: spend rising shows the negative color.
  const good = lowerIsBetter ? !rising : rising;
  return (
    <span className={good ? 'delta-up' : 'delta-down'}>
      {rising ? '▲' : '▼'} {(Math.abs(change) * 100).toFixed(0)}%
    </span>
  );
}

function sumChannels(data: MonthData | undefined, field: 'leads' | 'scheduled' | 'completed' | 'purchases' | 'revenue' | 'spend'): number {
  if (!data) return 0;
  return data.channels.reduce((acc, ch) => acc + Number(ch[field] ?? 0), 0);
}

export function PerformanceTab({ settings, labels, months, sources, comparison, refreshSources }: Props) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set(months.slice(0, 1)));
  const canAdmin = settings.role !== 'viewer';

  const toggle = (m: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(m)) next.delete(m);
      else next.add(m);
      return next;
    });

  if (months.length === 0) {
    return (
      <div className="card stack">
        <h3>No data yet</h3>
        <p className="muted">
          Connect a source or upload a CSV from Data and Team to light up this dashboard.
        </p>
      </div>
    );
  }

  return (
    <div className="stack" style={{ gap: 20 }}>
      {months.map((month, idx) => (
        <MonthSection
          key={month}
          month={month}
          compareMonth={
            comparison === 'previous'
              ? months[idx + 1] ?? null
              : comparison === 'year'
                ? `${Number(month.slice(0, 4)) - 1}${month.slice(4)}`
                : null
          }
          comparison={comparison}
          open={expanded.has(month)}
          onToggle={() => toggle(month)}
          settings={settings}
          labels={labels}
          sources={sources}
          canAdmin={canAdmin}
          refreshSources={refreshSources}
        />
      ))}
    </div>
  );
}

function MonthSection({
  month,
  compareMonth,
  comparison,
  open,
  onToggle,
  settings,
  labels,
  sources,
  canAdmin,
  refreshSources,
}: {
  month: string;
  compareMonth: string | null;
  comparison: Comparison;
  open: boolean;
  onToggle: () => void;
  settings: TenantSettings;
  labels: FunnelLabels;
  sources: SourceInfo[];
  canAdmin: boolean;
  refreshSources: () => void;
}) {
  const [basis, setBasis] = useState<'first' | 'latest'>('first');
  const [data, setData] = useState<MonthData | null>(null);
  const [compare, setCompare] = useState<MonthData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showLeads, setShowLeads] = useState(false);
  const [leads, setLeads] = useState<LeadRow[] | null>(null);
  const [openCampaigns, setOpenCampaigns] = useState<Set<string>>(new Set());
  const [creativeFilter, setCreativeFilter] = useState<string | null>(null);
  const [editingAd, setEditingAd] = useState<string | null>(null);
  const timezone = settings.tenant.timezone;

  const updateCreativeType = async (item: AdLineItem, creativeType: string) => {
    setEditingAd(null);
    try {
      await api('/api/tenant/ad-line-items/creative-type', {
        method: 'PATCH',
        json: {
          periodMonth: item.period_month,
          channel: item.channel,
          campaign: item.campaign,
          adName: item.ad_name,
          creativeType,
        },
      });
      setData((prev) =>
        prev
          ? {
              ...prev,
              adLineItems: prev.adLineItems.map((r) =>
                r.channel === item.channel && r.campaign === item.campaign && r.ad_name === item.ad_name
                  ? { ...r, creative_type: creativeType, creative_type_source: 'manual' }
                  : r
              ),
            }
          : prev
      );
    } catch {
      // Leave the tag as it was; the user can retry.
    }
  };

  useEffect(() => {
    if (!open) return;
    let alive = true;
    setError(null);
    api<MonthData>(`/api/tenant/months/${month}?basis=${basis}`)
      .then((d) => alive && setData(d))
      .catch((e) => alive && setError(e instanceof Error ? e.message : 'load failed'));
    if (compareMonth && comparison !== 'none' && comparison !== 'target') {
      api<MonthData>(`/api/tenant/months/${compareMonth}?basis=${basis}`)
        .then((d) => alive && setCompare(d))
        .catch(() => alive && setCompare(null));
    } else {
      setCompare(null);
    }
    return () => {
      alive = false;
    };
  }, [open, month, basis, compareMonth, comparison]);

  const targets = useMemo(() => {
    const map = new Map<string, number>();
    for (const t of data?.targets ?? []) map.set(t.metric, t.value);
    return map;
  }, [data]);

  const prevFor = (field: 'leads' | 'scheduled' | 'completed' | 'revenue' | 'spend'): number | null => {
    if (comparison === 'target') return targets.get(field) ?? null;
    if (!compare) return null;
    return sumChannels(compare, field === 'revenue' ? 'revenue' : field);
  };

  const pixelSource = sources.find((s) => s.kind === 'pixel');
  const sourceFor = (channel: string): SourceInfo | undefined => {
    if (channel === 'Meta') return sources.find((s) => s.key === 'meta-csv');
    if (channel === 'Google') return sources.find((s) => s.key === 'google-csv');
    if (channel === 'Website') return pixelSource;
    return sources.find((s) => s.kind === 'webhook');
  };

  const loadLeads = async () => {
    setShowLeads(true);
    if (!leads) {
      try {
        const res = await api<{ leads: LeadRow[] }>(`/api/tenant/months/${month}/leads`);
        setLeads(res.leads);
      } catch {
        setLeads([]);
      }
    }
  };

  const quality = data?.quality;
  const hasQualityIssue =
    quality && (quality.ambiguous_match_count > 0 || quality.unmatched_lead_count > 0 || quality.partial_only_count > 0);

  return (
    <section className="card stack">
      <button
        onClick={onToggle}
        style={{ border: 'none', background: 'transparent', textAlign: 'left', padding: 0 }}
        aria-expanded={open}
      >
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <h2>{monthLabel(month, timezone)}</h2>
          <span className="muted">{open ? '−' : '+'}</span>
        </div>
      </button>

      {open && error && <p className="delta-down">{error}</p>}
      {open && !data && !error && (
        <div className="kpi-grid">
          {[0, 1, 2, 3, 4].map((i) => (
            <div key={i} className="kpi">
              <div className="skeleton" style={{ width: '60%' }} />
              <div className="skeleton" style={{ width: '80%', marginTop: 10, minHeight: 28 }} />
            </div>
          ))}
        </div>
      )}

      {open && data && (
        <>
          <div className="kpi-grid">
            {(
              [
                { key: 'spend', label: 'Spend', money: true, lowerBetter: true },
                { key: 'leads', label: labels.lead, money: false, lowerBetter: false },
                { key: 'scheduled', label: labels.scheduled, money: false, lowerBetter: false },
                { key: 'completed', label: labels.completed, money: false, lowerBetter: false },
                { key: 'revenue', label: 'Revenue', money: true, lowerBetter: false },
              ] as const
            ).map((kpi) => {
              const value = sumChannels(data, kpi.key);
              return (
                <div className="kpi" key={kpi.key}>
                  <div className="label">
                    {kpi.label}
                    {sourceFor(kpi.key === 'spend' ? 'Meta' : 'GHL') && (
                      <SourceCheck
                        source={sourceFor(kpi.key === 'spend' ? 'Meta' : 'GHL')!}
                        timezone={timezone}
                        canVerify={canAdmin}
                        onVerified={refreshSources}
                      />
                    )}
                  </div>
                  <div className="value num">{kpi.money ? fmtMoney(value) : fmtNum(value)}</div>
                  {kpiDelta(value, prevFor(kpi.key), kpi.lowerBetter)}
                </div>
              );
            })}
          </div>

          {hasQualityIssue && (
            <p className="muted" style={{ fontSize: 13 }}>
              Data quality: {quality!.ambiguous_match_count} ambiguous matches, {quality!.unmatched_lead_count}{' '}
              unmatched records, {quality!.partial_only_count} visitors with partial forms only.
            </p>
          )}

          <div className="row" style={{ justifyContent: 'space-between' }}>
            <h3>Channels (in month)</h3>
            <div className="row" style={{ gap: 4 }}>
              <button className={`small ${basis === 'first' ? 'primary' : ''}`} onClick={() => setBasis('first')}>
                First touch
              </button>
              <button className={`small ${basis === 'latest' ? 'primary' : ''}`} onClick={() => setBasis('latest')}>
                Latest touch
              </button>
            </div>
          </div>
          <div style={{ overflowX: 'auto' }}>
            <table className="data">
              <thead>
                <tr>
                  <th>Channel</th>
                  <th>{labels.lead}</th>
                  <th>{labels.scheduled}</th>
                  <th>{labels.completed}</th>
                  <th>{labels.purchase}</th>
                  <th>Revenue</th>
                  <th>Spend</th>
                  <th>ROAS</th>
                </tr>
              </thead>
              <tbody>
                {data.channels.map((ch) => (
                  <tr key={ch.channel}>
                    <td>
                      <span style={{ color: channelColor(ch.channel), marginRight: 6 }}>{'●'}</span>
                      {ch.channel}
                      {sourceFor(ch.channel) && (
                        <SourceCheck
                          source={sourceFor(ch.channel)!}
                          timezone={timezone}
                          canVerify={canAdmin}
                          onVerified={refreshSources}
                        />
                      )}
                    </td>
                    <td className="num">{fmtNum(ch.leads)}</td>
                    <td className="num">{fmtNum(ch.scheduled)}</td>
                    <td className="num">{fmtNum(ch.completed)}</td>
                    <td className="num">{fmtNum(ch.purchases)}</td>
                    <td className="num">{fmtMoney(ch.revenue)}</td>
                    <td className="num">{fmtMoney(ch.spend)}</td>
                    <td className="num">{ch.spend > 0 ? (ch.revenue / ch.spend).toFixed(1) + 'x' : '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <h3>Lead cohort</h3>
          <CohortStrip data={data} month={month} />

          <h3>Spend by platform</h3>
          {data.adLineItems.length > 0 && (
            <div className="type-filters">
              <button className={creativeFilter === null ? 'active' : ''} onClick={() => setCreativeFilter(null)}>
                All ads
              </button>
              {[...new Set(data.adLineItems.map((a) => a.creative_type).filter((t): t is string => !!t))].map(
                (t) => (
                  <button key={t} className={creativeFilter === t ? 'active' : ''} onClick={() => setCreativeFilter(t)}>
                    {t}
                  </button>
                )
              )}
            </div>
          )}
          <div className="stack">
            {[...new Set(data.campaigns.map((c) => c.channel))].map((channel) => {
              const rows = data.campaigns.filter((c) => c.channel === channel);
              const total = rows.reduce((a, r) => a + r.spend, 0);
              const isOpen = openCampaigns.has(channel);
              return (
                <div key={channel} className="stack" style={{ gap: 6 }}>
                  <button
                    className="row small"
                    style={{ justifyContent: 'space-between', width: '100%' }}
                    onClick={() =>
                      setOpenCampaigns((prev) => {
                        const next = new Set(prev);
                        if (next.has(channel)) next.delete(channel);
                        else next.add(channel);
                        return next;
                      })
                    }
                  >
                    <span>
                      <span style={{ color: channelColor(channel), marginRight: 6 }}>{'●'}</span>
                      {channel}
                    </span>
                    <span className="num">{fmtMoney(total)}</span>
                  </button>
                  {isOpen && (
                    <div className="stack" style={{ gap: 14 }}>
                      {rows.map((r) => {
                        const ads = data.adLineItems
                          .filter((a) => a.channel === channel && a.campaign === r.campaign)
                          .filter((a) => !creativeFilter || a.creative_type === creativeFilter);
                        return (
                          <div key={r.campaign} className="stack" style={{ gap: 6 }}>
                            <div className="row" style={{ justifyContent: 'space-between', fontSize: 13 }}>
                              <span style={{ fontWeight: 600 }}>{r.campaign}</span>
                              <span className="num muted">
                                {fmtMoney(r.spend)} &middot; {fmtNum(r.leads)} {labels.lead.toLowerCase()}
                              </span>
                            </div>
                            {ads.length > 0 && (
                              <div style={{ overflowX: 'auto' }}>
                                <table className="data">
                                  <thead>
                                    <tr>
                                      <th>Ad</th>
                                      <th>Creative</th>
                                      <th>Spend</th>
                                      <th>Leads</th>
                                      <th>Cost / lead</th>
                                      <th>Status</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {ads.map((a) => {
                                      const adKey = `${a.channel}|${a.campaign}|${a.ad_name}`;
                                      return (
                                        <tr key={adKey}>
                                          <td>{a.ad_name}</td>
                                          <td>
                                            {editingAd === adKey ? (
                                              <select
                                                autoFocus
                                                defaultValue={a.creative_type ?? ''}
                                                onBlur={() => setEditingAd(null)}
                                                onChange={(e) => updateCreativeType(a, e.target.value)}
                                                style={{ width: 'auto', minHeight: 30 }}
                                              >
                                                <option value="" disabled>
                                                  Pick a type
                                                </option>
                                                {CREATIVE_TYPE_OPTIONS.map((t) => (
                                                  <option key={t} value={t}>
                                                    {t}
                                                  </option>
                                                ))}
                                              </select>
                                            ) : (
                                              <span
                                                className={`creative-tag ${a.creative_type_source === 'manual' ? 'manual' : ''}`}
                                                onClick={() => setEditingAd(adKey)}
                                                role="button"
                                                tabIndex={0}
                                              >
                                                {a.creative_type ?? 'Untagged'} <span className="edit">&#9998;</span>
                                              </span>
                                            )}
                                          </td>
                                          <td className="num">{fmtMoney(a.spend)}</td>
                                          <td className="num">{a.leads_reported ?? '—'}</td>
                                          <td className="num">
                                            {a.cost_per_lead !== null ? fmtMoney(a.cost_per_lead) : '—'}
                                          </td>
                                          <td>
                                            {a.status && (
                                              <span className={`status-pill ${a.status}`}>
                                                <span className="dot" />
                                                {statusLabel(a.status)}
                                              </span>
                                            )}
                                          </td>
                                        </tr>
                                      );
                                    })}
                                  </tbody>
                                </table>
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
            {data.campaigns.length === 0 && <p className="muted">No spend imported for this month.</p>}
          </div>

          {canAdmin && (
            <div className="stack">
              <button className="small" onClick={() => (showLeads ? setShowLeads(false) : loadLeads())}>
                {showLeads ? 'Hide leads' : 'See leads'}
              </button>
              {showLeads && (
                <div style={{ overflowX: 'auto' }}>
                  {!leads && <div className="skeleton" style={{ minHeight: 80 }} />}
                  {leads && (
                    <table className="data">
                      <thead>
                        <tr>
                          <th>Created</th>
                          <th>Channel</th>
                          <th>Campaign</th>
                          <th>Match</th>
                          <th>{labels.scheduled}</th>
                          <th>{labels.completed}</th>
                          <th>Days</th>
                          <th>Revenue</th>
                        </tr>
                      </thead>
                      <tbody>
                        {leads.map((l) => (
                          <tr key={l.contact_id}>
                            <td className="num">{l.created_at.slice(0, 10)}</td>
                            <td>{l.channel_first ?? 'Unknown'}</td>
                            <td>{l.campaign ?? ''}</td>
                            <td>
                              {l.match_method ?? ''}
                              {l.match_ambiguous ? ' (ambiguous)' : ''}
                            </td>
                            <td className="num">{l.first_stage_scheduled_at?.slice(0, 10) ?? ''}</td>
                            <td className="num">{l.first_stage_completed_at?.slice(0, 10) ?? ''}</td>
                            <td className="num">{l.days_to_complete ?? ''}</td>
                            <td className="num">{l.revenue_in_month ? fmtMoney(l.revenue_in_month) : ''}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              )}
            </div>
          )}
        </>
      )}
    </section>
  );
}

function CohortStrip({ data, month }: { data: MonthData; month: string }) {
  const buckets: Array<{ key: '0' | '30' | '60' | '90' | 'total'; label: string; days: number }> = [
    { key: '0', label: 'Same month', days: 0 },
    { key: '30', label: '+30', days: 30 },
    { key: '60', label: '+60', days: 60 },
    { key: '90', label: '+90', days: 90 },
    { key: 'total', label: 'Total', days: 0 },
  ];
  const monthEnd = new Date(`${month}-28T00:00:00Z`).getTime();
  const now = Date.now();
  const sum = (bucket: string, field: 'completed' | 'revenue') =>
    data.cohort.filter((r) => r.bucket === bucket).reduce((a, r) => a + Number(r[field]), 0);
  return (
    <div className="row">
      {buckets.map((b) => {
        // A window shows dashed styling while it is still maturing.
        const maturing = b.key !== 'total' && b.key !== '0' && now < monthEnd + b.days * 86400000;
        return (
          <div key={b.key} className={`cohort-cell ${maturing ? 'maturing' : ''}`}>
            <div className="muted" style={{ fontSize: 11 }}>
              {b.label}
            </div>
            <div className="num" style={{ fontWeight: 600 }}>
              {fmtNum(sum(b.key, 'completed'))}
            </div>
            <div className="num muted" style={{ fontSize: 12 }}>
              {fmtMoney(sum(b.key, 'revenue'))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
