'use client';

// Performance tab: a static view of the master date range (a single
// month, or several summed together), instead of every month stacked in
// a collapsible list. Topline KPIs with direction aware deltas, the in
// range block and cohort strip, the first versus latest touch toggle,
// spend by platform with lazy campaign rows, the data quality line,
// source check icons, and the admin only leads drawer.

import { useMemo, useState } from 'react';
import { api } from '@/lib/api';
import { DemoCampaignEditor } from '../DemoCampaignEditor';
import { getActiveDemoClient } from '@/lib/demoData';
import { isDemoMode } from '@/lib/demoMode';
import { channelColor, fmtMoney, fmtNum, fmtPct, monthLabel } from '@/lib/format';
import { mergeMonthData } from '@/lib/mergeMonthData';
import { monthsInRange, oldestAndNewest, shiftYear } from '@/lib/monthRange';
import type { AdLineItem, Comparison, FunnelLabels, LeadRow, MonthData, RepMetricsRow, SourceInfo, TenantSettings } from '@/lib/types';
import { useMonthRangeData } from '@/lib/useMonthRangeData';
import { SourceCheck } from '../SourceCheck';

const CREATIVE_TYPE_OPTIONS = ['Video', 'Carousel', 'Static', 'UGC', 'Other'];

// Campaign objectives differ per platform, so the tag picker offers the
// right vocabulary for each channel.
const CAMPAIGN_TYPE_OPTIONS: Record<string, string[]> = {
  meta: ['Lead Generation', 'Conversions / Sales', 'Traffic', 'Awareness', 'Engagement', 'Retargeting', 'Other'],
  google: ['Search', 'Performance Max', 'Display', 'Video / YouTube', 'Shopping', 'Demand Gen', 'Other'],
};

function campaignTypeOptions(channel: string): string[] {
  return (
    CAMPAIGN_TYPE_OPTIONS[channel.toLowerCase()] ?? [
      'Lead Generation',
      'Conversions / Sales',
      'Traffic',
      'Awareness',
      'Retargeting',
      'Other',
    ]
  );
}

// Glyph for the creative tile next to each ad title. There are no actual
// creative assets in CSV exports (thumbnails need the ad platform APIs),
// so the tile identifies the format at a glance instead.
function creativeGlyph(t: string | null): string {
  const k = (t ?? '').toLowerCase();
  if (k.includes('video')) return '▶';
  if (k.includes('carousel')) return '⧉';
  if (k.includes('ugc')) return '☺';
  if (k.includes('text') || k.includes('search') || k.includes('rsa')) return 'Aa';
  if (k.includes('static') || k.includes('image')) return '▣';
  return '◇';
}

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
  // The master date range, owned by AppShell and shared with every tab.
  rangeStart: string;
  rangeEnd: string;
  sources: SourceInfo[];
  // Narrows every number on this tab to one ad platform. null shows
  // everything; nothing currently sets this to a non-null value.
  channelFilter?: 'meta' | 'google' | null;
  // Comparison basis, owned by AppShell's sticky header and shared here.
  comparison: Comparison;
  refreshSources: () => void;
}

// Channel names arrive capitalized from the rollup ('Meta', 'Google') so
// the match is case-insensitive.
function filterMonthData(d: MonthData | null, ch: 'meta' | 'google' | null): MonthData | null {
  if (!d || !ch) return d;
  const match = (c: string) => c.toLowerCase() === ch;
  return {
    ...d,
    channels: d.channels.filter((r) => match(r.channel)),
    campaigns: d.campaigns.filter((r) => match(r.channel)),
    adLineItems: d.adLineItems.filter((r) => match(r.channel)),
    cohort: d.cohort.filter((r) => match(r.channel)),
  };
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

export function PerformanceTab({ settings, labels, months, rangeStart, rangeEnd, sources, channelFilter, comparison, refreshSources }: Props) {
  const canAdmin = settings.role !== 'viewer';

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

  const selectedMonths = monthsInRange(months, rangeStart, rangeEnd);

  // "Previous" shifts the whole window back by its own length; "year"
  // shifts every selected month back a year, range width unchanged.
  const compareMonths =
    comparison === 'previous'
      ? (() => {
          const oldestIdx = months.indexOf(selectedMonths[selectedMonths.length - 1]!);
          return months.slice(oldestIdx + 1, oldestIdx + 1 + selectedMonths.length);
        })()
      : comparison === 'year'
        ? selectedMonths.map((m) => shiftYear(m, -1))
        : [];

  return (
    <MonthSection
      key={selectedMonths.join(',')}
      selectedMonths={selectedMonths}
      compareMonths={compareMonths}
      comparison={comparison}
      settings={settings}
      labels={labels}
      sources={sources}
      canAdmin={canAdmin}
      channelFilter={channelFilter ?? null}
      refreshSources={refreshSources}
    />
  );
}

function MonthSection({
  selectedMonths,
  compareMonths,
  comparison,
  settings,
  labels,
  sources,
  canAdmin,
  channelFilter,
  refreshSources,
}: {
  selectedMonths: string[];
  compareMonths: string[];
  comparison: Comparison;
  settings: TenantSettings;
  labels: FunnelLabels;
  sources: SourceInfo[];
  canAdmin: boolean;
  channelFilter: 'meta' | 'google' | null;
  refreshSources: () => void;
}) {
  const [basis, setBasis] = useState<'first' | 'latest'>('first');
  const { raw, setRaw, error } = useMonthRangeData(selectedMonths, basis);
  const { raw: compareRaw } = useMonthRangeData(
    comparison !== 'none' && comparison !== 'target' ? compareMonths : [],
    basis
  );
  const [showLeads, setShowLeads] = useState(false);
  const [leads, setLeads] = useState<LeadRow[] | null>(null);
  const [openChannels, setOpenChannels] = useState<Set<string>>(new Set());
  // Which individual campaigns are expanded to their full stat strip +
  // ad-level table. Keyed `${channel}|${campaign}` so opening one
  // campaign in a channel does not open every other campaign in it too.
  const [openCampaignRows, setOpenCampaignRows] = useState<Set<string>>(new Set());
  const [creativeFilter, setCreativeFilter] = useState<string | null>(null);
  const [editingAd, setEditingAd] = useState<string | null>(null);
  const [editingCampaign, setEditingCampaign] = useState<string | null>(null);
  const [managingCampaigns, setManagingCampaigns] = useState(false);
  const timezone = settings.tenant.timezone;

  const data = useMemo(() => mergeMonthData(raw), [raw]);
  const compare = useMemo(() => mergeMonthData(compareRaw), [compareRaw]);

  // Demo-only: campaign edits made through DemoCampaignEditor land in
  // localStorage, not the API, so refetching each selected month is what
  // picks them up (same fetch useMonthRangeData does on mount).
  const reloadMonths = async () => {
    const results = await Promise.all(
      selectedMonths.map((m) => api<MonthData>(`/api/tenant/months/${m}?basis=${basis}`))
    );
    setRaw(results);
  };

  const updateCampaignType = async (channel: string, campaign: string, campaignType: string) => {
    setEditingCampaign(null);
    try {
      await api('/api/tenant/campaigns/type', {
        method: 'PATCH',
        json: { channel, campaign, campaignType },
      });
      // Campaign type is a global (channel, campaign) attribute, not
      // per-month, so the edit applies across every month in the range.
      setRaw((prev) =>
        prev.map((d) => ({
          ...d,
          campaigns: d.campaigns.map((r) =>
            r.channel === channel && r.campaign === campaign ? { ...r, campaign_type: campaignType } : r
          ),
        }))
      );
    } catch {
      // Leave the tag as it was; the user can retry.
    }
  };

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
      // Creative type is per month, so only the month the merged row's
      // period_month points at (the newest month that ad appears in) gets
      // updated.
      setRaw((prev) =>
        prev.map((d) =>
          d.month === item.period_month
            ? {
                ...d,
                adLineItems: d.adLineItems.map((r) =>
                  r.channel === item.channel && r.campaign === item.campaign && r.ad_name === item.ad_name
                    ? { ...r, creative_type: creativeType, creative_type_source: 'manual' }
                    : r
                ),
              }
            : d
        )
      );
    } catch {
      // Leave the tag as it was; the user can retry.
    }
  };

  const targets = useMemo(() => {
    const map = new Map<string, number>();
    for (const t of data?.targets ?? []) map.set(t.metric, t.value);
    return map;
  }, [data]);

  // What actually renders: the fetched month narrowed to one platform when
  // the profile's Meta/Google flip is set. `data` stays unfiltered so the
  // creative-type edit handler above keeps operating on the full payload.
  const view = useMemo(() => filterMonthData(data, channelFilter), [data, channelFilter]);
  const compareView = useMemo(() => filterMonthData(compare, channelFilter), [compare, channelFilter]);

  const prevFor = (field: 'leads' | 'scheduled' | 'completed' | 'revenue' | 'spend'): number | null => {
    // Targets are whole-account numbers; comparing a single platform's
    // slice against them would read as a miss, so skip the delta.
    if (comparison === 'target') return channelFilter ? null : targets.get(field) ?? null;
    if (!compareView) return null;
    return sumChannels(compareView, field === 'revenue' ? 'revenue' : field);
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
        const results = await Promise.all(
          selectedMonths.map((m) => api<{ leads: LeadRow[] }>(`/api/tenant/months/${m}/leads`))
        );
        setLeads(results.flatMap((r) => r.leads));
      } catch {
        setLeads([]);
      }
    }
  };

  const quality = data?.quality;
  const hasQualityIssue =
    quality && (quality.ambiguous_match_count > 0 || quality.unmatched_lead_count > 0 || quality.partial_only_count > 0);

  const [oldestMonth, newestMonth] = oldestAndNewest(selectedMonths);
  const rangeLabel =
    selectedMonths.length === 1 ? monthLabel(oldestMonth, timezone) : `${monthLabel(oldestMonth, timezone)} – ${monthLabel(newestMonth, timezone)}`;

  return (
    <section className="card stack">
      <h2>{rangeLabel}</h2>

      {error && <p className="delta-down">{error}</p>}
      {!data && !error && (
        <div className="kpi-grid">
          {[0, 1, 2, 3, 4].map((i) => (
            <div key={i} className="kpi">
              <div className="skeleton" style={{ width: '60%' }} />
              <div className="skeleton" style={{ width: '80%', marginTop: 10, minHeight: 28 }} />
            </div>
          ))}
        </div>
      )}

      {view && (
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
              const value = sumChannels(view, kpi.key);
              return (
                <div className={`kpi kpi-${kpi.key}`} key={kpi.key}>
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
            <h3>Channels (in period)</h3>
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
                {view.channels.map((ch) => (
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
                    <td className="num">{ch.spend > 0 && ch.revenue > 0 ? (ch.revenue / ch.spend).toFixed(1) + 'x' : '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <h3>Lead cohort</h3>
          <CohortStrip data={view} month={newestMonth} />

          {(view.reps?.length ?? 0) > 0 && (
            <TeamLeaderboard reps={view.reps!} labels={labels} />
          )}

          <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
            <h3 style={{ margin: 0 }}>Campaigns and ads</h3>
            {isDemoMode() && (
              <button className="small" onClick={() => setManagingCampaigns((v) => !v)}>
                {managingCampaigns ? 'Close editor' : 'Manage campaigns'}
              </button>
            )}
          </div>

          {managingCampaigns && (
            <DemoCampaignEditor
              clientId={getActiveDemoClient().id}
              month={newestMonth}
              onChange={reloadMonths}
              onClose={() => setManagingCampaigns(false)}
            />
          )}

          {view.adLineItems.length > 0 && (
            <div className="type-filters">
              <button className={creativeFilter === null ? 'active' : ''} onClick={() => setCreativeFilter(null)}>
                All ads
              </button>
              {[...new Set(view.adLineItems.map((a) => a.creative_type).filter((t): t is string => !!t))].map(
                (t) => (
                  <button key={t} className={creativeFilter === t ? 'active' : ''} onClick={() => setCreativeFilter(t)}>
                    {t}
                  </button>
                )
              )}
            </div>
          )}
          <div className="stack">
            {[...new Set(view.campaigns.map((c) => c.channel))].map((channel) => {
              const rows = view.campaigns.filter((c) => c.channel === channel);
              const total = rows.reduce((a, r) => a + r.spend, 0);
              const isOpen = openChannels.has(channel);
              return (
                <div key={channel} className="stack" style={{ gap: 8 }}>
                  <button
                    className="row small"
                    style={{ justifyContent: 'space-between', width: '100%' }}
                    onClick={() =>
                      setOpenChannels((prev) => {
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
                      <span className="muted" style={{ marginLeft: 8, fontWeight: 400 }}>
                        {rows.length} campaign{rows.length === 1 ? '' : 's'}
                      </span>
                    </span>
                    <span className="num">{fmtMoney(total)}</span>
                  </button>
                  {isOpen && (
                    <div className="stack" style={{ gap: 12 }}>
                      {rows.map((r) => {
                        const ads = view.adLineItems
                          .filter((a) => a.channel === channel && a.campaign === r.campaign)
                          .filter((a) => !creativeFilter || a.creative_type === creativeFilter);
                        const bookings = ads.reduce((a, x) => a + (x.purchases ?? 0), 0);
                        const campaignKey = `${channel}|${r.campaign}`;
                        const isCampaignOpen = openCampaignRows.has(campaignKey);
                        return (
                          <div key={r.campaign} className={`campaign-block chan-${channel.toLowerCase()} stack`} style={{ gap: 10 }}>
                            <div className="row" style={{ gap: 10, flexWrap: 'wrap', justifyContent: 'space-between' }}>
                              <div className="row" style={{ gap: 10, width: 'auto', flexWrap: 'wrap' }}>
                                <span style={{ fontWeight: 700, fontSize: 15 }}>{r.campaign}</span>
                                {editingCampaign === campaignKey ? (
                                  <select
                                    autoFocus
                                    defaultValue={r.campaign_type ?? ''}
                                    onBlur={() => setEditingCampaign(null)}
                                    onChange={(e) => updateCampaignType(channel, r.campaign, e.target.value)}
                                    style={{ width: 'auto', minHeight: 30 }}
                                  >
                                    <option value="" disabled>
                                      Pick a campaign type
                                    </option>
                                    {campaignTypeOptions(channel).map((t) => (
                                      <option key={t} value={t}>
                                        {t}
                                      </option>
                                    ))}
                                  </select>
                                ) : (
                                  <span
                                    className={`creative-tag ${r.campaign_type ? 'manual' : ''}`}
                                    onClick={() => canAdmin && setEditingCampaign(campaignKey)}
                                    role="button"
                                    tabIndex={0}
                                  >
                                    {r.campaign_type ?? 'Set campaign type'} <span className="edit">&#9998;</span>
                                  </span>
                                )}
                              </div>
                              <button
                                className="row small"
                                style={{ width: 'auto', gap: 16 }}
                                onClick={() =>
                                  setOpenCampaignRows((prev) => {
                                    const next = new Set(prev);
                                    if (next.has(campaignKey)) next.delete(campaignKey);
                                    else next.add(campaignKey);
                                    return next;
                                  })
                                }
                              >
                                <span>
                                  <span className="muted">Spend</span> <span className="num">{fmtMoney(r.spend)}</span>
                                </span>
                                <span>
                                  <span className="muted">{labels.lead}</span> <span className="num">{fmtNum(r.leads)}</span>
                                </span>
                                <span>
                                  <span className="muted">Cost / {labels.lead.toLowerCase().replace(/s$/, '')}</span>{' '}
                                  <span className="num">{r.leads > 0 ? fmtMoney(r.spend / r.leads) : '-'}</span>
                                </span>
                                <span aria-hidden="true">{isCampaignOpen ? '▲' : '▼'}</span>
                              </button>
                            </div>

                            {isCampaignOpen && (
                              <div className="stack" style={{ gap: 10 }}>
                                <div className="campaign-stats">
                                  <span>
                                    <span className="muted">Spend</span>
                                    <span className="num">{fmtMoney(r.spend)}</span>
                                  </span>
                                  <span>
                                    <span className="muted">{labels.lead}</span>
                                    <span className="num">{fmtNum(r.leads)}</span>
                                  </span>
                                  <span>
                                    <span className="muted">{labels.completed}</span>
                                    <span className="num">{fmtNum(r.completed)}</span>
                                  </span>
                                  <span>
                                    <span className="muted">Cost / {labels.lead.toLowerCase().replace(/s$/, '')}</span>
                                    <span className="num">{r.leads > 0 ? fmtMoney(r.spend / r.leads) : '-'}</span>
                                  </span>
                                  {bookings > 0 && (
                                    <>
                                      <span>
                                        <span className="muted">Conversion rate</span>
                                        <span className="num">{r.leads > 0 ? fmtPct(bookings / r.leads) : '-'}</span>
                                      </span>
                                      <span>
                                        <span className="muted">Cost / booking</span>
                                        <span className="num">{fmtMoney(r.spend / bookings)}</span>
                                      </span>
                                    </>
                                  )}
                                </div>

                                {ads.length > 0 && (
                                <div style={{ overflowX: 'auto' }}>
                                  <table className="data">
                                    <thead>
                                      <tr>
                                        <th>Ad / creative</th>
                                        <th>Spend</th>
                                        <th>% of campaign</th>
                                        <th>Leads</th>
                                        <th>Shows</th>
                                        <th>Conversion rate</th>
                                        <th>Cost / lead</th>
                                        <th>Cost / booking</th>
                                        <th>Status</th>
                                      </tr>
                                    </thead>
                                    <tbody>
                                      {ads.map((a) => {
                                        const adKey = `${a.channel}|${a.campaign}|${a.ad_name}`;
                                        return (
                                          <tr key={adKey}>
                                            <td>
                                              <span className="row" style={{ gap: 10, flexWrap: 'nowrap' }}>
                                                <span className="creative-tile" aria-hidden="true">
                                                  {creativeGlyph(a.creative_type)}
                                                </span>
                                                <span style={{ minWidth: 0 }}>
                                                  <span style={{ fontWeight: 600, display: 'block' }}>{a.ad_name}</span>
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
                                                </span>
                                              </span>
                                            </td>
                                            <td className="num">{fmtMoney(a.spend)}</td>
                                            <td className="num">
                                              {r.spend > 0 ? ((a.spend / r.spend) * 100).toFixed(0) + '%' : '—'}
                                            </td>
                                            <td className="num">{a.leads_reported ?? '—'}</td>
                                            <td className="num">{a.completed ?? '—'}</td>
                                            <td className="num">
                                              {a.leads_reported && a.purchases !== null
                                                ? fmtPct(a.purchases / a.leads_reported)
                                                : '—'}
                                            </td>
                                            <td className="num">
                                              {a.cost_per_lead !== null ? fmtMoney(a.cost_per_lead) : '—'}
                                            </td>
                                            <td className="num">
                                              {a.purchases ? fmtMoney(a.spend / a.purchases) : '—'}
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
                                {ads.length === 0 && (
                                  <p className="muted" style={{ fontSize: 12 }}>
                                    No ad level rows for this campaign yet. Upload the by-ad CSV export from Data and
                                    Team to break it down per ad.
                                  </p>
                                )}
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
            {view.campaigns.length === 0 && <p className="muted">No spend imported for this period.</p>}
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

// Door-to-door team leaderboard: setters ranked by door work, closers by
// appointments run and deals closed. Only renders for tenants whose
// imports produce rep metrics; one rep can appear in both tables.
function TeamLeaderboard({ reps, labels }: { reps: RepMetricsRow[]; labels: FunnelLabels }) {
  const setters = reps
    .filter((r) => r.knocks + r.pitches + r.appointments_set + r.sits_set > 0)
    .sort((a, b) => b.knocks - a.knocks || b.appointments_set - a.appointments_set);
  const closers = reps
    .filter((r) => r.sits_run + r.closes + r.installs > 0)
    .sort((a, b) => b.closes - a.closes || b.sits_run - a.sits_run);

  const pct = (num: number, den: number) => (den > 0 ? ((num / den) * 100).toFixed(0) + '%' : '—');

  return (
    <>
      <h3>Team leaderboard</h3>
      <div className="leaderboard-grid">
        {setters.length > 0 && (
          <div className="stack" style={{ gap: 8 }}>
            <h4 className="leaderboard-title">Setters</h4>
            <div style={{ overflowX: 'auto' }}>
              <table className="data">
                <thead>
                  <tr>
                    <th>Rep</th>
                    <th>{labels.lead}</th>
                    <th>Pitches</th>
                    <th>{labels.scheduled} set</th>
                    <th>{labels.completed} set</th>
                    <th>{labels.lead.replace(/s$/, '')} &rarr; {labels.scheduled.toLowerCase()}</th>
                  </tr>
                </thead>
                <tbody>
                  {setters.map((r) => (
                    <tr key={r.rep}>
                      <td>{r.rep}</td>
                      <td className="num">{fmtNum(r.knocks)}</td>
                      <td className="num">{fmtNum(r.pitches)}</td>
                      <td className="num">{fmtNum(r.appointments_set)}</td>
                      <td className="num">{fmtNum(r.sits_set)}</td>
                      <td className="num">{pct(r.appointments_set, r.knocks)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
        {closers.length > 0 && (
          <div className="stack" style={{ gap: 8 }}>
            <h4 className="leaderboard-title">Closers</h4>
            <div style={{ overflowX: 'auto' }}>
              <table className="data">
                <thead>
                  <tr>
                    <th>Rep</th>
                    <th>{labels.completed} run</th>
                    <th>{labels.purchase}</th>
                    <th>Installs</th>
                    <th>Close rate</th>
                  </tr>
                </thead>
                <tbody>
                  {closers.map((r) => (
                    <tr key={r.rep}>
                      <td>{r.rep}</td>
                      <td className="num">{fmtNum(r.sits_run)}</td>
                      <td className="num">{fmtNum(r.closes)}</td>
                      <td className="num">{fmtNum(r.installs)}</td>
                      <td className="num">{pct(r.closes, r.sits_run)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </>
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
