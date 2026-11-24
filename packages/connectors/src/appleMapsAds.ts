// Apple Maps Ads, read through the Apple Ads Platform API's business brand
// reports. Reporting only: see appleAdsClient.ts for why nothing here can
// change a campaign.
//
// What makes a campaign an Apple Maps campaign, per Apple's documentation:
//   - the ad account carries the BUSINESS_BRAND_MANUAL product feature
//     (an App Store account carries APPSTORE_APP_MANUAL and cannot run Maps)
//   - the campaign's promotedObjectType is BUSINESS_BRAND, promotedObjectId
//     being the brand id
//   - delivery is on the MAPS supply source, in the MAPS_SEARCH_RESULTS and
//     MAPS_SEARCH_HOME placements
// Only the /v1/reports/business-brands/* endpoints are read, never the
// /v1/reports/apps/* ones, so App Store advertising cannot leak in. Apple
// Business organic listing insights are a different product with no API
// here, and nothing in this file reads them.
//
// One client tenant maps to one Apple ad account, chosen by an administrator
// from the accounts the API user can actually see. Nothing is matched by
// business name. An optional brand id narrows it further when one ad account
// carries brands for more than one client.

import { AppleAdsClient, AppleAdsError, type AppleAdsAuth, type AppleAdsClientOptions } from './appleAdsClient';
import {
  AD_PLATFORMS,
  type AdAccountSummary,
  type AdPlatformSnapshot,
  type NormalizedCampaign,
  type NormalizedDailyMetric,
  type NormalizedLocation,
  type DailyBreakdown,
} from './adPlatform';
import { writeAdPlatformSnapshot } from './adPlatformWriter';
import type { AdLineItemRow, AdSpendRow } from './parsers';
import type { AdSyncStats, Connector, ConnectorContext, ConnectorDb, TestConnectionResult } from './types';
import { syntheticId } from './types';

export const APPLE_MAPS = AD_PLATFORMS.apple_maps;
export const APPLE_MAPS_PRODUCT_FEATURE = 'BUSINESS_BRAND_MANUAL';
export const APPLE_MAPS_PROMOTED_OBJECT_TYPE = 'BUSINESS_BRAND';
export const APPLE_MAPS_SUPPLY_SOURCE = 'MAPS';
export const APPLE_MAPS_PLACEMENTS = ['MAPS_SEARCH_RESULTS', 'MAPS_SEARCH_HOME'] as const;
export const APPLE_MAPS_DEFAULT_BACKFILL_DAYS = 90;

export const BRAND_REPORTS = {
  campaigns: '/reports/business-brands/campaigns/query',
  adGroups: '/reports/business-brands/adgroups/query',
  ads: '/reports/business-brands/ads/query',
  keywords: '/reports/business-brands/keywords/query',
  searchTerms: '/reports/business-brands/searchterms/query',
} as const;

// Apple's tap attributed action counts, under Apple's own names.
const ACTION_FIELDS = ['firstActions', 'getDirections', 'call', 'tapURL', 'share', 'getTheApp', 'galleryEngagement'] as const;

/* ------------------------------------------------------------------ */
/* Apple's shapes, as much of them as is read                          */
/* ------------------------------------------------------------------ */

interface Money {
  amount?: string;
  currency?: string;
}
interface TapCount {
  tap?: number;
}
type BrandsMetrics = {
  date?: string;
  localSpend?: Money;
  impressions?: number;
  taps?: number;
  actions?: TapCount;
} & Partial<Record<(typeof ACTION_FIELDS)[number], TapCount>>;

interface BrandsCampaignMeta {
  id?: number | string;
  name?: string;
  status?: string;
  displayStatus?: string;
  deleted?: boolean;
  promotedObjectType?: string;
  promotedObjectId?: string;
  dailyBudget?: { value?: Money };
  lifetimeBudget?: { value?: Money };
  startTime?: string;
  endTime?: string;
  locationId?: string | null;
  supplyPlacement?: string | null;
}
export interface BrandsCampaignRow {
  metadata?: BrandsCampaignMeta;
  totalMetrics?: BrandsMetrics;
  granularMetrics?: BrandsMetrics[];
}
export interface BrandsAdRow {
  metadata?: {
    id?: number | string;
    name?: string;
    campaignId?: number | string;
    deleted?: boolean;
    creative?: { creativeType?: string };
  };
  totalMetrics?: BrandsMetrics;
}
interface AppleAdAccount {
  id?: number | string;
  name?: string;
  timezone?: string;
  currency?: string;
  systemStatus?: string;
  productFeatures?: string[];
  delegations?: Array<{ resourceId?: string; resourceType?: string; resourceName?: string }>;
}
interface AppleAcl {
  adAccount?: { id?: number | string; name?: string; orgId?: number | string };
  roles?: string[];
}
interface AppleLocation {
  id?: string;
  brandId?: string;
  name?: string;
  status?: string;
  address?: { locality?: string; adminArea?: string; countryOrRegion?: string };
}

/* ------------------------------------------------------------------ */
/* settings                                                            */
/* ------------------------------------------------------------------ */

export interface AppleMapsSettings extends AppleAdsAuth {
  // '' until an administrator picks one from the accounts the test lists.
  adAccountId: string;
  brandId: string | null;
  backfillDays: number;
}

export function readAppleMapsSettings(creds: Record<string, string>): { ok: true; value: AppleMapsSettings } | { ok: false; message: string } {
  const get = (k: string) => (creds[k] ?? '').trim();
  const missing = ['clientId', 'teamId', 'keyId', 'privateKey'].filter((k) => !get(k));
  if (missing.length) return { ok: false, message: `Missing ${missing.join(', ')}. All four come from Apple Ads Account Settings > API.` };
  const adAccountId = get('adAccountId');
  if (adAccountId && !/^\d{1,20}$/.test(adAccountId)) return { ok: false, message: 'The ad account ID is numbers only.' };
  const brandId = get('brandId');
  if (brandId && !/^[A-Za-z0-9-]{1,40}$/.test(brandId)) return { ok: false, message: 'The brand ID is letters and numbers only.' };
  const rawBackfill = get('backfillDays');
  const backfill = rawBackfill ? Number(rawBackfill) : APPLE_MAPS_DEFAULT_BACKFILL_DAYS;
  if (!Number.isInteger(backfill) || backfill < 1 || backfill > 365) return { ok: false, message: 'Backfill days must be a whole number from 1 to 365.' };
  return {
    ok: true,
    value: {
      clientId: get('clientId'),
      teamId: get('teamId'),
      keyId: get('keyId'),
      privateKey: creds.privateKey ?? '',
      adAccountId,
      brandId: brandId || null,
      backfillDays: backfill,
    },
  };
}

/* ------------------------------------------------------------------ */
/* dates                                                               */
/* ------------------------------------------------------------------ */

const DAY = /^\d{4}-\d{2}-\d{2}$/;

// Today's date where the ad account reports. Reports are requested in ORTZ,
// the account's own timezone, so "today" must be cut the same way or a
// request can ask for a day that has not started there yet.
export function todayIn(timezone: string | undefined, nowMs: number): string {
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone: timezone || 'UTC', year: 'numeric', month: '2-digit', day: '2-digit' }).format(
      new Date(nowMs)
    );
  } catch {
    return new Date(nowMs).toISOString().slice(0, 10);
  }
}

// The days of a month that have happened, or null for a month that has not
// started. Apple's DAILY granularity allows 90 days, so a month always fits.
export function monthWindow(month: string, today: string): { from: string; to: string } | null {
  const [y, m] = month.split('-').map(Number);
  const from = `${month}-01`;
  const lastDay = new Date(Date.UTC(y!, m!, 0)).getUTCDate();
  const end = `${month}-${String(lastDay).padStart(2, '0')}`;
  if (from > today) return null;
  return { from, to: end < today ? end : today };
}

/* ------------------------------------------------------------------ */
/* normalisation                                                       */
/* ------------------------------------------------------------------ */

const round2 = (n: number) => Math.round(n * 100) / 100;

function money(m: Money | undefined): number | null {
  if (!m || m.amount === undefined || m.amount === null) return null;
  const n = Number(m.amount);
  return Number.isFinite(n) ? round2(n) : null;
}

function tapCount(t: TapCount | undefined): number | null {
  return t && typeof t.tap === 'number' && Number.isFinite(t.tap) ? t.tap : null;
}

export function isMapsCampaign(meta: BrandsCampaignMeta | undefined, brandId: string | null): boolean {
  if (!meta || meta.id === undefined || meta.id === null) return false;
  // The business brands endpoints only serve Maps campaigns; if Apple says
  // otherwise on a row, believe the row.
  if (meta.promotedObjectType && meta.promotedObjectType !== APPLE_MAPS_PROMOTED_OBJECT_TYPE) return false;
  if (brandId && String(meta.promotedObjectId ?? '') !== brandId) return false;
  return true;
}

function campaignFromMeta(meta: BrandsCampaignMeta, currency: string | null): NormalizedCampaign {
  return {
    campaignId: String(meta.id),
    name: (meta.name ?? '').trim() || `Campaign ${meta.id}`,
    status: meta.status ?? null,
    displayStatus: meta.displayStatus ?? null,
    promotedObjectId: meta.promotedObjectId ? String(meta.promotedObjectId) : null,
    currency: meta.dailyBudget?.value?.currency ?? currency,
    dailyBudget: money(meta.dailyBudget?.value),
    lifetimeBudget: money(meta.lifetimeBudget?.value),
    startTime: meta.startTime ?? null,
    endTime: meta.endTime ?? null,
    deleted: meta.deleted === true,
  };
}

function dailyFromMetrics(
  m: BrandsMetrics,
  date: string,
  campaignId: string,
  breakdown: DailyBreakdown,
  dimension: string,
  currency: string | null
): NormalizedDailyMetric {
  const detail: Record<string, number | null> = {};
  for (const field of ACTION_FIELDS) detail[field] = tapCount(m[field]);
  return {
    date,
    campaignId,
    breakdown,
    dimension,
    currency: m.localSpend?.currency ?? currency,
    spend: money(m.localSpend) ?? 0,
    impressions: typeof m.impressions === 'number' ? m.impressions : 0,
    clicks: typeof m.taps === 'number' ? m.taps : 0,
    // Apple's total of tap attributed actions. Null, not zero, when absent.
    conversions: tapCount(m.actions),
    conversionDetail: detail,
  };
}

// One report's rows as daily rows of one cut. A row with granularMetrics
// gives one daily row per day. A single day request has no granularMetrics
// (Apple returns totalMetrics only), so its total is that day.
export function rowsToDaily(
  rows: BrandsCampaignRow[],
  breakdown: DailyBreakdown,
  range: { from: string; to: string },
  currency: string | null,
  brandId: string | null
): { daily: NormalizedDailyMetric[]; campaigns: Map<string, NormalizedCampaign>; skipped: number } {
  const daily: NormalizedDailyMetric[] = [];
  const campaigns = new Map<string, NormalizedCampaign>();
  let skipped = 0;
  for (const row of rows) {
    const meta = row.metadata;
    if (!isMapsCampaign(meta, brandId)) {
      skipped += 1;
      continue;
    }
    const campaign = campaignFromMeta(meta!, currency);
    campaigns.set(campaign.campaignId, campaign);
    const raw = breakdown === 'location' ? meta!.locationId : breakdown === 'placement' ? meta!.supplyPlacement : '';
    const dimension = breakdown === 'campaign' ? '' : raw ? String(raw) : 'unattributed';
    if (row.granularMetrics && row.granularMetrics.length) {
      for (const g of row.granularMetrics) {
        if (!g.date || !DAY.test(g.date)) continue;
        daily.push(dailyFromMetrics(g, g.date, campaign.campaignId, breakdown, dimension, currency));
      }
    } else if (range.from === range.to && row.totalMetrics) {
      daily.push(dailyFromMetrics(row.totalMetrics, range.from, campaign.campaignId, breakdown, dimension, currency));
    }
  }
  return { daily, campaigns, skipped };
}

/* ------------------------------------------------------------------ */
/* reading Apple                                                       */
/* ------------------------------------------------------------------ */

function clientOptions(ctx: ConnectorContext | undefined): AppleAdsClientOptions {
  return { fetchImpl: ctx?.fetchImpl, sleep: ctx?.sleep, now: ctx?.now };
}

function brandsOf(account: AppleAdAccount): Array<{ id: string; name: string }> {
  return (account.delegations ?? [])
    .filter((d) => d.resourceType === APPLE_MAPS_PROMOTED_OBJECT_TYPE && d.resourceId)
    .map((d) => ({ id: String(d.resourceId), name: d.resourceName ?? '' }));
}

async function readAccount(client: AppleAdsClient, accountId: string): Promise<AppleAdAccount> {
  const res = await client.get<{ result?: AppleAdAccount }>(`/ad-accounts/${accountId}`, accountId);
  return res.result ?? {};
}

function assertMapsAccount(account: AppleAdAccount, accountId: string): void {
  const features = account.productFeatures ?? [];
  if (!features.includes(APPLE_MAPS_PRODUCT_FEATURE)) {
    throw new AppleAdsError(
      'permission',
      `Ad account ${accountId} is not an Apple Maps account (its product features are ${features.join(', ') || 'none'}). An App Store ads account cannot run Maps campaigns. Choose the client's Apple Maps ad account.`
    );
  }
}

export async function listAppleAdAccounts(client: AppleAdsClient): Promise<AdAccountSummary[]> {
  const res = await client.get<{ result?: { acls?: AppleAcl[] } }>('/acls', null);
  const out: AdAccountSummary[] = [];
  for (const acl of res.result?.acls ?? []) {
    const id = acl.adAccount?.id;
    if (id === undefined || id === null) continue;
    out.push({ id: String(id), name: acl.adAccount?.name ?? '', roles: acl.roles ?? [], eligible: false });
  }
  // Whether each one can run Maps is on the account itself. Bounded, so an
  // org with hundreds of accounts does not turn a test into hundreds of calls.
  for (const summary of out.slice(0, 25)) {
    try {
      const account = await readAccount(client, summary.id);
      summary.eligible = (account.productFeatures ?? []).includes(APPLE_MAPS_PRODUCT_FEATURE);
    } catch {
      summary.eligible = false;
    }
  }
  return out;
}

const report = (range: { from: string; to: string }, groupBy?: string[]) => ({
  timeRange: { start: range.from, end: range.to, timeZone: 'ORTZ', ...(range.from === range.to ? {} : { granularity: 'DAILY' }) },
  ...(groupBy ? { groupBy } : {}),
});

export interface AppleMapsFetchResult {
  snapshot: AdPlatformSnapshot;
  ads: BrandsAdRow[];
  account: AppleAdAccount;
  warnings: string[];
}

export async function fetchAppleMapsSnapshot(
  client: AppleAdsClient,
  settings: AppleMapsSettings,
  account: AppleAdAccount,
  range: { from: string; to: string },
  runId: string
): Promise<AppleMapsFetchResult> {
  const currency = account.currency ?? null;
  const warnings: string[] = [];
  // Three cuts of the same campaigns. Each sums to the same total, and each
  // is stored apart so no screen ever adds them together.
  // One after another rather than at once: four requests a run is nothing
  // against Apple's quota, and in sequence the rate limit pacing sees them.
  const byCampaign = await client.reportRows<BrandsCampaignRow>(BRAND_REPORTS.campaigns, report(range));
  const byLocation = await client.reportRows<BrandsCampaignRow>(BRAND_REPORTS.campaigns, report(range, ['locationId']));
  const byPlacement = await client.reportRows<BrandsCampaignRow>(BRAND_REPORTS.campaigns, report(range, ['supplyPlacement']));
  // Ad totals for the window, no day breakdown: they feed the existing per
  // ad table, which is monthly.
  const ads = await client.reportRows<BrandsAdRow>(BRAND_REPORTS.ads, { timeRange: { start: range.from, end: range.to, timeZone: 'ORTZ' } });

  const c = rowsToDaily(byCampaign, 'campaign', range, currency, settings.brandId);
  const l = rowsToDaily(byLocation, 'location', range, currency, settings.brandId);
  const p = rowsToDaily(byPlacement, 'placement', range, currency, settings.brandId);
  const campaigns = new Map([...p.campaigns, ...l.campaigns, ...c.campaigns]);
  if (c.skipped) warnings.push(`${c.skipped} campaign rows were not Apple Maps campaigns for this brand and were left out.`);

  // Names for the location breakdown. Only the brands actually advertised,
  // and only the locations that appear in the report.
  const wanted = new Set(l.daily.map((d) => d.dimension).filter((d) => d !== 'unattributed'));
  const locations: NormalizedLocation[] = [];
  if (wanted.size) {
    const brandIds = new Set<string>();
    for (const campaign of campaigns.values()) if (campaign.promotedObjectId) brandIds.add(campaign.promotedObjectId);
    for (const brandId of brandIds) {
      try {
        const found = await client.queryAll<AppleLocation>('/locations/query', {
          filters: [{ field: 'brandId', operator: 'EQUALS', value: brandId }],
        });
        for (const loc of found) {
          if (!loc.id || !wanted.has(String(loc.id))) continue;
          locations.push({
            locationId: String(loc.id),
            brandId: loc.brandId ?? brandId,
            name: loc.name ?? null,
            locality: loc.address?.locality ?? null,
            adminArea: loc.address?.adminArea ?? null,
            country: loc.address?.countryOrRegion ?? null,
            status: loc.status ?? null,
          });
        }
      } catch (err) {
        // Names are a nicety: the figures are already in hand, so a role that
        // cannot list locations shows ids instead of failing the sync.
        if (err instanceof AppleAdsError && ['permission', 'not_found', 'bad_request'].includes(err.failure)) {
          warnings.push(`Location names could not be read for brand ${brandId}: ${err.message}`);
        } else {
          throw err;
        }
      }
    }
  }

  return {
    snapshot: {
      platform: 'apple_maps',
      accountId: settings.adAccountId,
      runId,
      range,
      campaigns: [...campaigns.values()],
      daily: [...c.daily, ...l.daily, ...p.daily],
      locations,
    },
    ads,
    account,
    warnings,
  };
}

/* ------------------------------------------------------------------ */
/* sync history                                                        */
/* ------------------------------------------------------------------ */

async function startRun(db: ConnectorDb, id: string, key: string, accountId: string, scope: string, range: { from: string; to: string }) {
  await db.batch([
    // Ninety days of history is plenty to read a failure pattern from.
    {
      sql: `DELETE FROM ad_platform_sync_runs WHERE integration_key = ? AND started_at < strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-90 days')`,
      params: [key],
    },
    {
      sql: `INSERT INTO ad_platform_sync_runs (id, integration_key, platform, account_id, scope, status, range_from, range_to) VALUES (?, ?, 'apple_maps', ?, ?, 'running', ?, ?)`,
      params: [id, key, accountId, scope, range.from, range.to],
    },
  ]);
}

// What the last successful sync reported on, or null if nothing has synced.
async function previousScope(db: ConnectorDb): Promise<string | null> {
  const rows = await db.query<{ scope: string | null }>(
    `SELECT scope FROM ad_platform_sync_runs WHERE platform = 'apple_maps' AND status IN ('succeeded', 'no_campaigns') AND scope IS NOT NULL ORDER BY started_at DESC LIMIT 1`
  );
  return rows[0]?.scope ?? null;
}

// The ad account or brand changed: everything synced so far is about some
// other account, possibly another client's. It all goes, from the detail
// tables and from the monthly spend, so no report mixes the two. Returns the
// months whose rollup must be rerun.
async function purgeAppleMaps(db: ConnectorDb): Promise<string[]> {
  const months = await db.query<{ period_month: string }>(
    `SELECT period_month FROM raw_ad_spend WHERE channel = ? UNION SELECT period_month FROM ad_line_items WHERE channel = ?`,
    [APPLE_MAPS.channel, APPLE_MAPS.channel]
  );
  await db.batch([
    { sql: `DELETE FROM ad_platform_daily WHERE platform = 'apple_maps'`, params: [] },
    { sql: `DELETE FROM ad_platform_campaigns WHERE platform = 'apple_maps'`, params: [] },
    { sql: `DELETE FROM ad_platform_locations WHERE platform = 'apple_maps'`, params: [] },
    { sql: `DELETE FROM raw_ad_spend WHERE channel = ?`, params: [APPLE_MAPS.channel] },
    { sql: `DELETE FROM ad_line_items WHERE channel = ?`, params: [APPLE_MAPS.channel] },
  ]);
  return months.map((m) => m.period_month).sort();
}

// Spend and ad rows for the month: upserted first, then whatever this sync
// did not write is pruned. A sync that dies halfway leaves last time's
// figures, never a month with spend missing.
async function writeMonthlyRows(db: ConnectorDb, month: string, spend: AdSpendRow[], lines: AdLineItemRow[]): Promise<void> {
  const channel = APPLE_MAPS.channel;
  await db.batch([
    ...spend.map((r) => ({
      sql: `INSERT INTO raw_ad_spend (period_month, channel, campaign, spend, leads_reported) VALUES (?, ?, ?, ?, NULL)
            ON CONFLICT (period_month, channel, campaign) DO UPDATE SET spend = excluded.spend, leads_reported = NULL`,
      params: [month, channel, r.campaign, r.spend],
    })),
    ...lines.map((r) => ({
      // A creative type staff corrected by hand is kept.
      sql: `INSERT INTO ad_line_items (period_month, channel, campaign, ad_name, ad_id, creative_type, creative_type_source, spend, leads_reported)
            VALUES (?, ?, ?, ?, ?, ?, 'auto', ?, NULL)
            ON CONFLICT (period_month, channel, campaign, ad_name) DO UPDATE SET
              ad_id = excluded.ad_id, spend = excluded.spend, leads_reported = NULL,
              creative_type = CASE WHEN ad_line_items.creative_type_source = 'manual' THEN ad_line_items.creative_type ELSE excluded.creative_type END`,
      params: [month, channel, r.campaign, r.adName, r.adId, r.creativeType, r.spend],
    })),
    {
      sql: `DELETE FROM raw_ad_spend WHERE period_month = ? AND channel = ? AND campaign NOT IN (SELECT value FROM json_each(?))`,
      params: [month, channel, JSON.stringify(spend.map((r) => r.campaign))],
    },
    {
      sql: `DELETE FROM ad_line_items WHERE period_month = ? AND channel = ? AND (campaign || char(31) || ad_name) NOT IN (SELECT value FROM json_each(?))`,
      params: [month, channel, JSON.stringify(lines.map((r) => `${r.campaign}\u001f${r.adName}`))],
    },
  ]);
}

async function finishRun(
  db: ConnectorDb,
  id: string,
  status: 'succeeded' | 'no_campaigns',
  range: { from: string; to: string },
  campaigns: number,
  rows: number
) {
  await db.batch([
    {
      sql: `UPDATE ad_platform_sync_runs SET status = ?, finished_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), range_from = ?, range_to = ?, campaigns = ?, rows_written = ? WHERE id = ?`,
      params: [status, range.from, range.to, campaigns, rows, id],
    },
  ]);
}

async function failRun(db: ConnectorDb, id: string, err: unknown) {
  const failure = err instanceof AppleAdsError ? err.failure : 'error';
  const message = err instanceof Error ? err.message.slice(0, 300) : 'sync failed';
  await db.batch([
    {
      sql: `UPDATE ad_platform_sync_runs SET status = 'failed', finished_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), failure = ?, error = ? WHERE id = ?`,
      params: [failure, message, id],
    },
  ]);
}

/* ------------------------------------------------------------------ */
/* the connector                                                       */
/* ------------------------------------------------------------------ */

export interface AppleMapsSyncStats extends AdSyncStats {
  // Null when the month has not started in the account's timezone: nothing
  // was asked of Apple, which is not "no campaigns".
  campaigns: number | null;
  dailyRows: number;
  locations: number;
  range: { from: string; to: string } | null;
  currency: string | null;
  // False when spend could not join the USD monthly rollup.
  unifiedSpend: boolean;
  warnings: string[];
}

function monthlySpendRows(month: string, snapshot: AdPlatformSnapshot): AdSpendRow[] {
  const names = new Map(snapshot.campaigns.map((c) => [c.campaignId, c.name]));
  const byName = new Map<string, number>();
  for (const d of snapshot.daily) {
    if (d.breakdown !== 'campaign') continue;
    const name = names.get(d.campaignId) ?? `Campaign ${d.campaignId}`;
    byName.set(name, round2((byName.get(name) ?? 0) + d.spend));
  }
  // leadsReported stays null: Apple Maps actions are not leads, and folding
  // them into the lead count would mix attribution models.
  return [...byName].map(([campaign, spend]) => ({ periodMonth: month, channel: APPLE_MAPS.channel, campaign, spend, leadsReported: null }));
}

function adLineItemRows(month: string, ads: BrandsAdRow[], snapshot: AdPlatformSnapshot): AdLineItemRow[] {
  const names = new Map(snapshot.campaigns.map((c) => [c.campaignId, c.name]));
  const keyed = new Map<string, AdLineItemRow>();
  for (const row of ads) {
    const meta = row.metadata;
    const campaignId = meta?.campaignId === undefined ? '' : String(meta.campaignId);
    // An ad belongs here only if its campaign survived the Maps and brand
    // filter above.
    if (!meta?.name || !names.has(campaignId)) continue;
    const campaign = names.get(campaignId)!;
    const spend = money(row.totalMetrics?.localSpend) ?? 0;
    const key = `${campaign}|${meta.name}`;
    const prev = keyed.get(key);
    keyed.set(key, {
      periodMonth: month,
      channel: APPLE_MAPS.channel,
      campaign,
      adName: meta.name,
      adId: meta.id === undefined ? null : String(meta.id),
      creativeType: meta.creative?.creativeType ?? null,
      spend: round2((prev?.spend ?? 0) + spend),
      leadsReported: null,
    });
  }
  return [...keyed.values()];
}

export const appleMapsAdsConnector: Connector = {
  provider: 'apple-maps-ads',

  backfillDays(creds) {
    const parsed = readAppleMapsSettings(creds);
    return parsed.ok ? parsed.value.backfillDays : APPLE_MAPS_DEFAULT_BACKFILL_DAYS;
  },

  getRequirements() {
    return {
      provider: 'apple-maps-ads',
      displayName: 'Apple Maps Ads',
      authKind: 'oauth2' as const,
      credentialFields: [
        { key: 'clientId', label: 'Client ID (SEARCHADS.…)', secret: false },
        { key: 'teamId', label: 'Team ID (SEARCHADS.…)', secret: false },
        { key: 'keyId', label: 'Key ID', secret: false },
        { key: 'privateKey', label: 'Private key (paste the whole private-key.pem)', secret: true },
        { key: 'adAccountId', label: 'Ad account ID (leave blank and Test to list the accounts this user can see)', secret: false },
        { key: 'brandId', label: 'Brand ID (optional, only when the ad account carries more than one client’s brand)', secret: false },
        { key: 'backfillDays', label: 'Days of history on first sync (optional, default 90)', secret: false },
      ],
      planRequirement:
        'Needs an Apple Ads API user on the organization that owns the client’s Apple Maps ad account, with a role on that account. API Account Read Only is enough and is the one to ask for. The ad account must be an Apple Maps account (BUSINESS_BRAND_MANUAL) with the client’s brand delegated to it.',
      planLink: 'https://ads.apple.com',
      tokenGuide: [
        'An Apple Ads account administrator invites a user with the API Account Read Only role (Account Settings > User Management > Invite Users).',
        'Signed in as that API user, generate a key: openssl ecparam -genkey -name prime256v1 -noout -out private-key.pem, then openssl ec -in private-key.pem -pubout -out public-key.pem.',
        'In Account Settings > API, paste public-key.pem and save. Copy the clientId, teamId and keyId Apple shows above it.',
        'Paste those three and the whole private-key.pem here, leave the ad account blank, and Test. The test lists the ad accounts this user can see. Save the client’s Apple Maps account ID and Test again.',
      ],
      defaultStageMap: [],
    };
  },

  async testConnection(creds, ctx): Promise<TestConnectionResult> {
    const now = ctx?.now ?? (() => Date.now());
    const checkedAt = new Date(now()).toISOString();
    const parsed = readAppleMapsSettings(creds);
    if (!parsed.ok) {
      return { ok: false, failure: 'bad_credentials', message: parsed.message, planCheck: { failureKind: 'config', checkedAt } };
    }
    const settings = parsed.value;
    const client = new AppleAdsClient(settings, null, clientOptions(ctx));
    try {
      const accounts = await listAppleAdAccounts(client);
      // One API user usually reaches every client's ad account. The list is
      // shown once, in the reply, and only to LetLois staff (ctx.discover):
      // it is never stored, because the stored test result is readable by
      // the client's own users.
      if (!settings.adAccountId) {
        const maps = accounts.filter((a) => a.eligible);
        return {
          ok: false,
          failure: 'error',
          message: !maps.length
            ? 'The credentials work, but this API user cannot see any Apple Maps ad account. Ask an Apple Ads administrator to give it a role on the client’s Apple Maps account.'
            : ctx?.discover
              ? `The credentials work. Choose this client’s Apple Maps ad account and save its ID: ${maps.map((a) => `${a.name} (${a.id})`).join(', ')}.`
              : 'The credentials work. Ask LetLois to choose which Apple Maps ad account is yours.',
          planCheck: { failureKind: maps.length ? 'select_account' : 'permission', checkedAt },
        };
      }
      const acl = accounts.find((a) => a.id === settings.adAccountId);
      if (!acl) {
        return {
          ok: false,
          failure: 'insufficient_plan',
          message: `This API user has no access to ad account ${settings.adAccountId}. Ask an Apple Ads administrator to give it the API Account Read Only role on that account.`,
          planCheck: { failureKind: 'permission', checkedAt },
        };
      }
      const account = await readAccount(client, settings.adAccountId);
      assertMapsAccount(account, settings.adAccountId);
      const brands = brandsOf(account);
      if (settings.brandId && !brands.some((b) => b.id === settings.brandId)) {
        return {
          ok: false,
          failure: 'insufficient_plan',
          message: `Brand ${settings.brandId} is not delegated to ad account ${settings.adAccountId}. Delegated brands: ${brands.map((b) => `${b.name} (${b.id})`).join(', ') || 'none'}.`,
          planCheck: { failureKind: 'permission', brands, checkedAt },
        };
      }
      const readOnly = acl.roles.length > 0 && acl.roles.every((r) => /read only/i.test(r));
      const notes: string[] = [];
      if (!readOnly) notes.push(`This API user holds ${acl.roles.join(', ') || 'no listed role'}. Reporting only needs API Account Read Only.`);
      if (!brands.length) notes.push('No brand is delegated to this ad account yet, so it has no Maps campaigns to report.');
      return {
        ok: true,
        connectedAs: `${account.name ?? acl.name} (${settings.adAccountId})`,
        planCheck: {
          adAccount: {
            id: settings.adAccountId,
            name: account.name ?? acl.name,
            currency: account.currency ?? null,
            timezone: account.timezone ?? null,
            systemStatus: account.systemStatus ?? null,
          },
          brands,
          roles: acl.roles,
          leastPrivilege: readOnly,
          notes,
          checkedAt,
        },
      };
    } catch (err) {
      const failure = err instanceof AppleAdsError ? err.failure : 'error';
      return {
        ok: false,
        failure: failure === 'auth' || failure === 'config' ? 'bad_credentials' : failure === 'permission' ? 'insufficient_plan' : 'error',
        message: err instanceof Error ? err.message : 'Connection test failed',
        planCheck: { failureKind: failure === 'auth' || failure === 'permission' || failure === 'config' ? failure : 'error', checkedAt },
      };
    }
  },

  async syncMonth(creds, month, db, sourceKey, ctx): Promise<AppleMapsSyncStats> {
    const parsed = readAppleMapsSettings(creds);
    if (!parsed.ok) throw new AppleAdsError('config', parsed.message);
    const settings = parsed.value;
    if (!settings.adAccountId) throw new AppleAdsError('config', 'Choose the client’s Apple Maps ad account first: Test lists the ones this API user can see.');
    const now = ctx?.now ?? (() => Date.now());
    const client = new AppleAdsClient(settings, settings.adAccountId, clientOptions(ctx));
    const runId = syntheticId('adsync');
    const monthEnd = monthWindow(month, '9999-12-31')!;
    const scope = `${settings.adAccountId}|${settings.brandId ?? ''}`;
    await startRun(db, runId, sourceKey, settings.adAccountId, scope, monthEnd);

    try {
      const account = await readAccount(client, settings.adAccountId);
      assertMapsAccount(account, settings.adAccountId);

      // A different account or brand than last time: drop everything synced
      // for the old one before writing anything for the new one, and ask the
      // caller to roll those months up again and backfill afresh. Done only
      // once the new account is known to be readable, so a typo cannot wipe
      // a client's history.
      const before = await previousScope(db);
      const purged = before !== null && before !== scope ? await purgeAppleMaps(db) : [];
      const changed = { alsoChanged: purged.filter((m) => m !== month), restartBackfill: purged.length > 0 || (before !== null && before !== scope) };

      const range = monthWindow(month, todayIn(account.timezone, now()));
      const currency = account.currency ?? null;
      if (!range) {
        await finishRun(db, runId, 'succeeded', monthEnd, 0, 0);
        return {
          adSpendRows: 0,
          adLineItemRows: 0,
          campaigns: null,
          dailyRows: 0,
          locations: 0,
          range: null,
          currency,
          unifiedSpend: false,
          warnings: ['That month has not started in the ad account’s timezone.'],
          ...changed,
        };
      }

      const fetched = await fetchAppleMapsSnapshot(client, settings, account, range, runId);
      const { snapshot, warnings } = fetched;
      const dailyRows = await writeAdPlatformSnapshot(db, snapshot);

      // Spend joins the monthly rollup, and through it every cross platform
      // report, only in US dollars: that is the currency every BI total is
      // in, and adding another currency to it would be wrong silently.
      let adSpendRows = 0;
      let adLineItems = 0;
      const unifiedSpend = currency === 'USD';
      if (unifiedSpend) {
        const spend = monthlySpendRows(month, snapshot);
        const lines = adLineItemRows(month, fetched.ads, snapshot);
        await writeMonthlyRows(db, month, spend, lines);
        adSpendRows = spend.length;
        adLineItems = lines.length;
      } else {
        warnings.push(
          `The ad account reports in ${currency ?? 'an unknown currency'}, not USD, so Apple Maps spend is kept in the Apple Maps report and left out of the combined USD totals.`
        );
      }

      const status = snapshot.campaigns.length === 0 ? 'no_campaigns' : 'succeeded';
      await finishRun(db, runId, status, range, snapshot.campaigns.length, dailyRows);
      return {
        adSpendRows,
        adLineItemRows: adLineItems,
        campaigns: snapshot.campaigns.length,
        dailyRows,
        locations: snapshot.locations.length,
        range,
        currency,
        unifiedSpend,
        warnings,
        ...changed,
      };
    } catch (err) {
      await failRun(db, runId, err).catch(() => undefined);
      throw err;
    }
  },
};
