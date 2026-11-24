// One ad platform's report for one client and a window of days: totals, a
// same length comparison window, the campaign table, the location and
// placement cuts, the daily trend and recent sync history.
//
// Read from the client's own database only, so one client's figures can
// never appear in another's report. Every ratio is computed here from sums,
// never averaged from stored ratios, and is null (shown as N/A) when its
// denominator is zero or unreported. Totals always come from the campaign
// cut; the location and placement cuts are shown beside it, never added to
// it, which is what keeps a campaign that ran in three places from being
// counted three times.

import { adPlatformById, costPer, describeIntegrationState, rate, sumKnown, type AdPlatformDescriptor } from '@letlois/connectors';
import type { Env } from './env';
import { tenantD1Client } from './provisioning';

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const MAX_SPAN_DAYS = 366;

export interface ReportRange {
  from: string;
  to: string;
}

function dayInZone(timezone: string, ms: number): string {
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(ms));
  } catch {
    return new Date(ms).toISOString().slice(0, 10);
  }
}

function addDays(day: string, n: number): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function spanDays(range: ReportRange): number {
  return Math.round((Date.parse(`${range.to}T00:00:00Z`) - Date.parse(`${range.from}T00:00:00Z`)) / 86_400_000) + 1;
}

// Defaults to the last 30 days, ending today in the client's timezone.
export function parseReportRange(
  from: string | undefined,
  to: string | undefined,
  timezone: string,
  nowMs = Date.now()
): { ok: true; value: ReportRange } | { ok: false; error: string } {
  const end = to ?? dayInZone(timezone, nowMs);
  const start = from ?? addDays(end, -29);
  if (!DAY.test(start) || !DAY.test(end) || Number.isNaN(Date.parse(start)) || Number.isNaN(Date.parse(end))) {
    return { ok: false, error: 'from and to are dates, YYYY-MM-DD' };
  }
  if (start > end) return { ok: false, error: 'from is after to' };
  const value = { from: start, to: end };
  if (spanDays(value) > MAX_SPAN_DAYS) return { ok: false, error: `at most ${MAX_SPAN_DAYS} days at a time` };
  return { ok: true, value };
}

export interface ReportTotals {
  spend: number;
  impressions: number;
  clicks: number;
  ctr: number | null;
  cpc: number | null;
  conversions: number | null;
  costPerConversion: number | null;
}

function totalsOf(spend: number, impressions: number, clicks: number, conversions: number | null): ReportTotals {
  const s = Math.round(spend * 100) / 100;
  return {
    spend: s,
    impressions,
    clicks,
    ctr: rate(clicks, impressions),
    cpc: costPer(s, clicks),
    conversions,
    costPerConversion: costPer(s, conversions),
  };
}

interface DailyRow {
  metric_date: string;
  account_id: string;
  campaign_id: string;
  currency: string | null;
  spend: number;
  impressions: number;
  clicks: number;
  conversions: number | null;
  conversions_json: string | null;
  synced_at: string;
}

interface CutRow {
  account_id: string;
  campaign_id: string;
  dimension: string;
  spend: number;
  impressions: number;
  clicks: number;
  conversions: number | null;
}

interface CampaignRow {
  account_id: string;
  campaign_id: string;
  name: string;
  status: string | null;
  display_status: string | null;
  promoted_object_id: string | null;
  currency: string | null;
  daily_budget: number | null;
  lifetime_budget: number | null;
  deleted: number;
  synced_at: string;
}

function isMissingTable(err: unknown): boolean {
  return /no such (table|column)/i.test(err instanceof Error ? err.message : String(err));
}

const PLACEMENT_LABELS: Record<string, string> = {
  MAPS_SEARCH_RESULTS: 'Search results',
  MAPS_SEARCH_HOME: 'Search home',
  unattributed: 'Not attributed to a placement',
};

export async function adPlatformReport(
  env: Env,
  databaseId: string,
  platformId: string,
  range: ReportRange
): Promise<{ ok: true; report: Record<string, unknown> } | { ok: false; status: 404; error: string }> {
  const platform: AdPlatformDescriptor | null = adPlatformById(platformId);
  if (!platform) return { ok: false, status: 404, error: 'unknown platform' };
  const d1 = tenantD1Client(env);
  const span = spanDays(range);
  const previous = { from: addDays(range.from, -span), to: addDays(range.from, -1) };

  try {
    const q = async <T>(sql: string, params: unknown[]) => (await d1.query<T>(databaseId, sql, params)).results;
    const [integrations, campaigns, daily, prior, byLocation, byPlacement, locations, runs] = await Promise.all([
      q<{
        key: string;
        status: string;
        enabled?: number | null;
        credentials_ciphertext: string | null;
        last_sync_at: string | null;
        last_sync_result: string | null;
        plan_check_json: string | null;
        connected_as: string | null;
      }>(`SELECT * FROM integrations WHERE provider = ? ORDER BY key`, [platform.provider]),
      q<CampaignRow>(`SELECT * FROM ad_platform_campaigns WHERE platform = ?`, [platform.id]),
      q<DailyRow>(
        `SELECT metric_date, account_id, campaign_id, currency, spend, impressions, clicks, conversions, conversions_json, synced_at
         FROM ad_platform_daily WHERE platform = ? AND breakdown = 'campaign' AND metric_date >= ? AND metric_date <= ?`,
        [platform.id, range.from, range.to]
      ),
      q<{ spend: number | null; impressions: number | null; clicks: number | null; conversions: number | null }>(
        `SELECT SUM(spend) AS spend, SUM(impressions) AS impressions, SUM(clicks) AS clicks, SUM(conversions) AS conversions
         FROM ad_platform_daily WHERE platform = ? AND breakdown = 'campaign' AND metric_date >= ? AND metric_date <= ?`,
        [platform.id, previous.from, previous.to]
      ),
      q<CutRow>(
        `SELECT account_id, campaign_id, dimension, SUM(spend) AS spend, SUM(impressions) AS impressions, SUM(clicks) AS clicks, SUM(conversions) AS conversions
         FROM ad_platform_daily WHERE platform = ? AND breakdown = 'location' AND metric_date >= ? AND metric_date <= ?
         GROUP BY account_id, campaign_id, dimension`,
        [platform.id, range.from, range.to]
      ),
      q<CutRow>(
        `SELECT account_id, campaign_id, dimension, SUM(spend) AS spend, SUM(impressions) AS impressions, SUM(clicks) AS clicks, SUM(conversions) AS conversions
         FROM ad_platform_daily WHERE platform = ? AND breakdown = 'placement' AND metric_date >= ? AND metric_date <= ?
         GROUP BY account_id, campaign_id, dimension`,
        [platform.id, range.from, range.to]
      ),
      q<{ account_id: string; location_id: string; name: string | null; locality: string | null; admin_area: string | null }>(
        `SELECT account_id, location_id, name, locality, admin_area FROM ad_platform_locations WHERE platform = ?`,
        [platform.id]
      ),
      q<{
        integration_key: string;
        status: string;
        range_from: string;
        range_to: string;
        started_at: string;
        finished_at: string | null;
        campaigns: number | null;
        rows_written: number | null;
        failure: string | null;
        error: string | null;
      }>(
        `SELECT integration_key, status, range_from, range_to, started_at, finished_at, campaigns, rows_written, failure, error
         FROM ad_platform_sync_runs WHERE platform = ? ORDER BY started_at DESC LIMIT 10`,
        [platform.id]
      ),
    ]);

    const campaignKey = (account: string, id: string) => `${account}|${id}`;
    const campaignMeta = new Map(campaigns.map((c) => [campaignKey(c.account_id, c.campaign_id), c]));
    const locationMeta = new Map(locations.map((l) => [`${l.account_id}|${l.location_id}`, l]));
    const currencies = new Set(daily.map((d) => d.currency).filter((c): c is string => Boolean(c)));

    // The campaign table and the totals, from the campaign cut.
    type Acc = { spend: number; impressions: number; clicks: number; conversions: Array<number | null>; lastSyncedAt: string };
    const perCampaign = new Map<string, Acc>();
    const perDay = new Map<string, { spend: number; impressions: number; clicks: number; conversions: Array<number | null> }>();
    const actionTotals = new Map<string, Array<number | null>>();
    for (const row of daily) {
      const k = campaignKey(row.account_id, row.campaign_id);
      const acc = perCampaign.get(k) ?? { spend: 0, impressions: 0, clicks: 0, conversions: [], lastSyncedAt: '' };
      acc.spend += row.spend;
      acc.impressions += row.impressions;
      acc.clicks += row.clicks;
      acc.conversions.push(row.conversions);
      if (row.synced_at > acc.lastSyncedAt) acc.lastSyncedAt = row.synced_at;
      perCampaign.set(k, acc);

      const day = perDay.get(row.metric_date) ?? { spend: 0, impressions: 0, clicks: 0, conversions: [] };
      day.spend += row.spend;
      day.impressions += row.impressions;
      day.clicks += row.clicks;
      day.conversions.push(row.conversions);
      perDay.set(row.metric_date, day);

      if (row.conversions_json) {
        try {
          const detail = JSON.parse(row.conversions_json) as Record<string, number | null>;
          for (const [name, value] of Object.entries(detail)) {
            const list = actionTotals.get(name) ?? [];
            list.push(typeof value === 'number' ? value : null);
            actionTotals.set(name, list);
          }
        } catch {
          // a row with unreadable detail contributes no detail
        }
      }
    }

    const campaignRows = [...perCampaign].map(([k, acc]) => {
      const meta = campaignMeta.get(k);
      const [accountId, campaignId] = k.split('|') as [string, string];
      return {
        campaignId,
        accountId,
        name: meta?.name ?? `Campaign ${campaignId}`,
        status: meta?.status ?? null,
        displayStatus: meta?.display_status ?? null,
        deleted: meta?.deleted === 1,
        brandId: meta?.promoted_object_id ?? null,
        currency: meta?.currency ?? null,
        dailyBudget: meta?.daily_budget ?? null,
        lifetimeBudget: meta?.lifetime_budget ?? null,
        ...totalsOf(acc.spend, acc.impressions, acc.clicks, sumKnown(acc.conversions)),
        lastSyncedAt: acc.lastSyncedAt || meta?.synced_at || null,
      };
    });
    campaignRows.sort((a, b) => b.spend - a.spend || a.name.localeCompare(b.name));

    const all = [...perCampaign.values()];
    const totals = totalsOf(
      all.reduce((n, a) => n + a.spend, 0),
      all.reduce((n, a) => n + a.impressions, 0),
      all.reduce((n, a) => n + a.clicks, 0),
      sumKnown(all.flatMap((a) => a.conversions))
    );
    const p = prior[0];
    const previousTotals = totalsOf(p?.spend ?? 0, p?.impressions ?? 0, p?.clicks ?? 0, p?.conversions ?? null);

    const cut = (rows: CutRow[], label: (r: CutRow) => string) =>
      rows
        .map((r) => ({
          campaignId: r.campaign_id,
          accountId: r.account_id,
          campaignName: campaignMeta.get(campaignKey(r.account_id, r.campaign_id))?.name ?? `Campaign ${r.campaign_id}`,
          dimension: r.dimension,
          label: label(r),
          ...totalsOf(r.spend ?? 0, r.impressions ?? 0, r.clicks ?? 0, r.conversions ?? null),
        }))
        .sort((a, b) => b.spend - a.spend);

    const integration = integrations[0] ?? null;
    const connection = integration
      ? {
          key: integration.key,
          connectedAs: integration.connected_as,
          lastSyncAt: integration.last_sync_at,
          enabled: integration.enabled !== 0,
          ...describeIntegrationState({
            hasCredentials: Boolean(integration.credentials_ciphertext),
            status: integration.status,
            enabled: integration.enabled,
            lastSyncAt: integration.last_sync_at,
            lastSyncResult: integration.last_sync_result,
            planCheck: integration.plan_check_json,
            running: runs.some(
              (r) => r.integration_key === integration.key && r.status === 'running' && Date.parse(r.started_at) > Date.now() - 15 * 60_000
            ),
          }),
        }
      : null;

    const notes: string[] = [
      'Dates are the ad account’s own reporting days (Apple’s ORTZ timezone), which can differ from the client’s timezone by a day at the edges.',
    ];
    if (currencies.size > 1) notes.push(`More than one currency in this window (${[...currencies].join(', ')}). Totals add them as reported and should not be read as one currency.`);
    if (currencies.size === 1 && !currencies.has('USD')) notes.push(`Figures are in ${[...currencies][0]}. They are not included in the combined USD spend totals.`);

    return {
      ok: true,
      report: {
        ready: true,
        platform: platform.id,
        displayName: platform.displayName,
        labels: platform.labels,
        definitions: platform.definitions,
        range,
        previousRange: previous,
        connection,
        currency: currencies.size === 1 ? [...currencies][0] : null,
        totals,
        previous: previousTotals,
        actions: Object.fromEntries([...actionTotals].map(([name, values]) => [name, sumKnown(values)])),
        campaigns: campaignRows,
        locations: cut(byLocation, (r) => {
          if (r.dimension === 'unattributed') return 'Not attributed to a location';
          const l = locationMeta.get(`${r.account_id}|${r.dimension}`);
          const place = [l?.locality, l?.admin_area].filter(Boolean).join(', ');
          return l?.name ? (place ? `${l.name}, ${place}` : l.name) : `Location ${r.dimension}`;
        }),
        placements: cut(byPlacement, (r) => PLACEMENT_LABELS[r.dimension] ?? r.dimension),
        daily: [...perDay]
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([date, d]) => ({ date, ...totalsOf(d.spend, d.impressions, d.clicks, sumKnown(d.conversions)) })),
        syncHistory: runs.map((r) => ({
          status: r.status,
          range: { from: r.range_from, to: r.range_to },
          startedAt: r.started_at,
          finishedAt: r.finished_at,
          campaigns: r.campaigns,
          rows: r.rows_written,
          failure: r.failure,
          error: r.error,
        })),
        notes,
      },
    };
  } catch (err) {
    // Like door to door: a database without the tables yet is a client that
    // is not set up, not an error. The agency's migrate action fixes it.
    if (isMissingTable(err)) return { ok: true, report: { ready: false, platform: platform.id, range } };
    throw err;
  }
}
