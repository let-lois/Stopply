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
  // Jumps to the Data and Team section. Only used by the empty state, so
  // optional: callers that never render a data-less tenant can omit it.
  onOpenDataTeam?: () => void;
  // True while the months request is still in flight. Without it an empty
  // months array reads as "this client has no data" and the empty state
  // flashes up before the real dashboard replaces it.
  loading?: boolean;
  // Narrows every number on this tab to one ad platform. null/undefined
  // shows everything (the Main Dashboard recap); the Meta and Google
  // tabs each set this to their own channel.
  channelFilter?: 'meta' | 'google' | null;
  // Hides the Campaigns and ads section (and its Manage campaigns
  // editor). Set on the Main Dashboard recap, where campaign-level
  // detail belongs on the Meta/Google tabs instead, not mixed in here.
  hideCampaigns?: boolean;
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

export function PerformanceTab({ settings, labels, months, rangeStart, rangeEnd, sources, onOpenDataTeam, loading, channelFilter, hideCampaigns, comparison, refreshSources }: Props) {
  const canAdmin = settings.role !== 'viewer';

  // Order matters: still loading is not the same as genuinely empty, and
  // showing the empty state first made every client look unconfigured for a
  // beat before its numbers appeared.
  if (loading) return <DashboardSkeleton />;
  if (months.length === 0) {
    return <EmptyDashboard labels={labels} channelFilter={channelFilter ?? null} onOpenDataTeam={onOpenDataTeam} />;
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
      hideCampaigns={hideCampaigns}
      refreshSources={refreshSources}
    />
  );
}

// Placeholder in the dashboard's own shape while the months request is in
// flight. Same tile grid and table block as the loaded view, so nothing
// jumps when the real numbers arrive.
function DashboardSkeleton() {
  return (
    <div className="stack" style={{ gap: 16 }}>
      <div className="kpi-grid">
        {[0, 1, 2, 3, 4].map((i) => (
          <div key={i} className="kpi">
            <div className="skeleton" style={{ width: '55%' }} />
            <div className="skeleton" style={{ width: '75%', marginTop: 10, minHeight: 28 }} />
          </div>
        ))}
      </div>
      <div className="skeleton" style={{ minHeight: 180, borderRadius: 12 }} />
    </div>
  );
}

// A client with nothing imported yet still shows the dashboard's shape,
// with its own funnel labels on the tiles, rather than a bare "no data"
// card. A new account should read as the product it is about to be, not as
// a setup wizard that happens to live at the same URL.
//
// Every figure is "-", never 0. A zero here would assert a measurement
// nobody took, which is the same reason the fabricated numbers were pulled
// out of this dashboard earlier. "-" is already how the live table renders
// a ratio it cannot compute, so it reads consistently.
function EmptyDashboard({
  labels,
  channelFilter,
  onOpenDataTeam,
}: {
  labels: FunnelLabels;
  channelFilter: 'meta' | 'google' | null;
  onOpenDataTeam?: () => void;
}) {
  const tiles = [
    { key: 'spend', label: 'Spend' },
    { key: 'leads', label: labels.lead },
    { key: 'scheduled', label: labels.scheduled },
    { key: 'completed', label: labels.completed },
    { key: 'revenue', label: 'Revenue' },
  ];
  return (
    <div className="stack" style={{ gap: 16 }}>
      <div className="kpi-grid">
        {tiles.map((t) => (
          <div className={`kpi kpi-${t.key} kpi-awaiting`} key={t.key}>
            <div className="label">{t.label}</div>
            <div className="value num">-</div>
          </div>
        ))}
      </div>

      {/* The Meta and Google sections sit on the same page as the recap, so
          only the recap carries the full explanation. Repeating it three
          times read as three separate problems rather than one empty
          client. */}
      {channelFilter ? (
        <p className="muted" style={{ margin: 0, fontSize: 13 }}>
          No {channelFilter === 'meta' ? 'Meta' : 'Google Ads'} data imported yet.
        </p>
      ) : (
        <div className="stack" style={{ gap: 8 }}>
          <h3>Channels (in period)</h3>
          <div className="card stack empty-panel" style={{ gap: 10 }}>
            <strong>Nothing imported yet</strong>
            <p className="muted" style={{ margin: 0, fontSize: 13 }}>
              Upload a CSV from Data and Team and these tiles fill in for the months it covers. Channels,
              campaigns and the lead cohort appear here as soon as there is data behind them.
            </p>
            {onOpenDataTeam && (
              <button className="small primary" style={{ alignSelf: 'flex-start' }} onClick={onOpenDataTeam}>
                Open Data and Team
              </button>
            )}
          </div>
        </div>
      )}
    </div>
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
  hideCampaigns,
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
  hideCampaigns?: boolean;
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
  // Which individual campaigns are expanded to their ad-level table.
  // Keyed by campaign name (this view is already narrowed to one
  // channel, so campaign name alone is unique within it).
  const [openCampaignRows, setOpenCampaignRows] = useState<Set<string>>(new Set());
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
            <h3>{channelFilter ? 'Attribution' : 'Channels (in period)'}</h3>
            <div className="row" style={{ gap: 4 }}>
              <button className={`small ${basis === 'first' ? 'primary' : ''}`} onClick={() => setBasis('first')}>
                First touch
              </button>
              <button className={`small ${basis === 'latest' ? 'primary' : ''}`} onClick={() => setBasis('latest')}>
                Latest touch
              </button>
            </div>
          </div>

          {!channelFilter && (
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
          )}

          <h3>Lead cohort</h3>
          <CohortStrip data={view} month={newestMonth} />

          {(view.reps?.length ?? 0) > 0 && (
            <TeamLeaderboard reps={view.reps!} labels={labels} />
          )}

          {!hideCampaigns && (
          <div className="stack">
          <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
            <h3 style={{ margin: 0 }}>Campaigns and ads</h3>
            {isDemoMode() && (
              <button className="small" onClick={() => setManagingCampaigns((v) => !v)}>
                {managingCampaigns ? 'Close editor' : 'Manage campaigns'}
              </button>
            )}
          </div>

          {managingCampaigns && channelFilter && (
            <DemoCampaignEditor
              clientId={getActiveDemoClient().id}
              month={newestMonth}
              channel={channelFilter}
              onChange={reloadMonths}
              onClose={() => setManagingCampaigns(false)}
            />
          )}

          <div className="stack" style={{ gap: 16 }}>
            {view.campaigns.map((r) => {
              const ads = view.adLineItems.filter((a) => a.campaign === r.campaign);
              const bookings = ads.reduce((a, x) => a + (x.purchases ?? 0), 0);
              // A campaign's own status is the most concerning status among
              // its ads (never invented from scratch - just rolled up from
              // the same per-ad status already computed for the ad-level
              // table below).
              const adStatuses = ads.map((a) => a.status).filter((s): s is NonNullable<AdLineItem['status']> => !!s);
              const campaignStatus = adStatuses.includes('under')
                ? 'under'
                : adStatuses.includes('watch')
                  ? 'watch'
                  : adStatuses.includes('top')
                    ? 'top'
                    : null;
              const campaignKey = r.campaign;
              const isCampaignOpen = openCampaignRows.has(campaignKey);
              return (
                <div
                  key={r.campaign}
                  className={`campaign-block${campaignStatus ? ` status-${campaignStatus}` : ''} stack`}
                  style={{ gap: 12 }}
                >
                  <div className="row" style={{ gap: 12, flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                    <div className="stack" style={{ gap: 3, width: 'auto' }}>
                      <span className="campaign-name">{r.campaign}</span>
                      <span className="muted" style={{ fontSize: 12.5 }}>
                        {editingCampaign === campaignKey ? (
                          <select
                            autoFocus
                            defaultValue={r.campaign_type ?? ''}
                            onBlur={() => setEditingCampaign(null)}
                            onChange={(e) => updateCampaignType(r.channel, r.campaign, e.target.value)}
                            style={{ width: 'auto', minHeight: 26, fontSize: 12.5 }}
                          >
                            <option value="" disabled>
                              Pick a campaign type
                            </option>
                            {campaignTypeOptions(r.channel).map((t) => (
                              <option key={t} value={t}>
                                {t}
                              </option>
                            ))}
                          </select>
                        ) : (
                          <span
                            onClick={() => canAdmin && setEditingCampaign(campaignKey)}
                            role={canAdmin ? 'button' : undefined}
                            tabIndex={canAdmin ? 0 : undefined}
                            style={canAdmin ? { cursor: 'pointer', textDecoration: 'underline dotted' } : undefined}
                          >
                            {r.campaign_type ?? 'Set campaign type'}
                          </span>
                        )}
                        {campaignStatus && (
                          <>
                            {' '}
                            &middot; <span className={`status-word status-word-${campaignStatus}`}>{statusLabel(campaignStatus)}</span>
                          </>
                        )}
                      </span>
                    </div>
                    <button
                      className="campaign-toggle"
                      onClick={() =>
                        setOpenCampaignRows((prev) => {
                          const next = new Set(prev);
                          if (next.has(campaignKey)) next.delete(campaignKey);
                          else next.add(campaignKey);
                          return next;
                        })
                      }
                    >
                      {isCampaignOpen ? 'Hide ads' : `${ads.length} ad${ads.length === 1 ? '' : 's'}`}
                      <span aria-hidden="true">{isCampaignOpen ? '▾' : '▸'}</span>
                    </button>
                  </div>

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
                      <span className="muted">Bookings</span>
                      <span className="num">{fmtNum(bookings)}</span>
                    </span>
                    <span>
                      <span className="muted">{labels.completed}</span>
                      <span className="num">{fmtNum(r.completed)}</span>
                    </span>
                    <span>
                      <span className="muted">Cost / {labels.lead.toLowerCase().replace(/s$/, '')}</span>
                      <span className="num">{r.leads > 0 ? fmtMoney(r.spend / r.leads) : '-'}</span>
                    </span>
                    <span>
                      <span className="muted">Conversion rate</span>
                      <span className="num">{r.leads > 0 ? fmtPct(bookings / r.leads) : '-'}</span>
                    </span>
                    <span>
                      <span className="muted">Cost / booking</span>
                      <span className="num">{bookings > 0 ? fmtMoney(r.spend / bookings) : '-'}</span>
                    </span>
                  </div>

                  {isCampaignOpen && (
                    <div className="stack" style={{ gap: 10 }}>
                      {ads.length > 0 && (
                        <div style={{ overflowX: 'auto' }}>
                          <table className="data">
                            <thead>
                              <tr>
                                <th>Ad</th>
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
                                    <td style={{ fontWeight: 600 }}>{a.ad_name}</td>
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
                          No ad level rows for this campaign yet. Upload the by-ad CSV export from Data and Team to
                          break it down per ad.
                        </p>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
            {view.campaigns.length === 0 && <p className="muted">No spend imported for this period.</p>}
          </div>
          </div>
          )}

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
