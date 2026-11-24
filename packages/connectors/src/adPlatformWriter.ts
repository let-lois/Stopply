// Writes an AdPlatformSnapshot into the ad_platform_* tables.
//
// Idempotent: campaigns and locations upsert on their keys, and the daily
// rows for the snapshot's date window are replaced, so syncing the same
// window twice leaves exactly one row per (day, campaign, cut, dimension).
// A campaign that stopped appearing in the window loses its rows there.
//
// Writes come first and the prune comes last. Calls over the D1 HTTP API are
// not one transaction, so a sync that dies halfway must leave the previous
// figures standing, never a window with days missing.
//
// Tenant databases are reached over the D1 HTTP API, one statement per
// call and at most 100 bound parameters per statement. So rows travel as
// one JSON parameter per chunk and are unpacked with json_each: a month of
// daily rows for a busy account is a handful of calls, not thousands.

import type { ConnectorDb } from './types';
import type { AdPlatformSnapshot } from './adPlatform';

const CHUNK = 200;

function chunks<T>(items: T[]): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += CHUNK) out.push(items.slice(i, i + CHUNK));
  return out;
}

// SQLite needs a WHERE clause between INSERT ... SELECT and ON CONFLICT, or
// it reads the ON as a join constraint. `WHERE true` is that clause.
const CAMPAIGN_UPSERT = `INSERT INTO ad_platform_campaigns
  (platform, account_id, campaign_id, name, status, display_status, promoted_object_id, currency, daily_budget, lifetime_budget, start_time, end_time, deleted, synced_at)
  SELECT ?, ?, json_extract(value, '$.campaignId'), json_extract(value, '$.name'), json_extract(value, '$.status'),
    json_extract(value, '$.displayStatus'), json_extract(value, '$.promotedObjectId'), json_extract(value, '$.currency'),
    json_extract(value, '$.dailyBudget'), json_extract(value, '$.lifetimeBudget'), json_extract(value, '$.startTime'),
    json_extract(value, '$.endTime'), json_extract(value, '$.deleted'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  FROM json_each(?) WHERE true
  ON CONFLICT (platform, account_id, campaign_id) DO UPDATE SET
    name = excluded.name, status = excluded.status, display_status = excluded.display_status,
    promoted_object_id = excluded.promoted_object_id, currency = excluded.currency,
    daily_budget = excluded.daily_budget, lifetime_budget = excluded.lifetime_budget,
    start_time = excluded.start_time, end_time = excluded.end_time, deleted = excluded.deleted,
    synced_at = excluded.synced_at`;

const DAILY_INSERT = `INSERT INTO ad_platform_daily
  (platform, account_id, sync_run, metric_date, campaign_id, breakdown, dimension, currency, spend, impressions, clicks, conversions, conversions_json, synced_at)
  SELECT ?, ?, ?, json_extract(value, '$.date'), json_extract(value, '$.campaignId'), json_extract(value, '$.breakdown'),
    json_extract(value, '$.dimension'), json_extract(value, '$.currency'), json_extract(value, '$.spend'),
    json_extract(value, '$.impressions'), json_extract(value, '$.clicks'), json_extract(value, '$.conversions'),
    json_extract(value, '$.conversionsJson'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  FROM json_each(?) WHERE true
  ON CONFLICT (platform, account_id, metric_date, campaign_id, breakdown, dimension) DO UPDATE SET
    currency = excluded.currency, spend = excluded.spend, impressions = excluded.impressions,
    clicks = excluded.clicks, conversions = excluded.conversions, conversions_json = excluded.conversions_json,
    sync_run = excluded.sync_run, synced_at = excluded.synced_at`;

const LOCATION_UPSERT = `INSERT INTO ad_platform_locations
  (platform, account_id, location_id, brand_id, name, locality, admin_area, country, status, synced_at)
  SELECT ?, ?, json_extract(value, '$.locationId'), json_extract(value, '$.brandId'), json_extract(value, '$.name'),
    json_extract(value, '$.locality'), json_extract(value, '$.adminArea'), json_extract(value, '$.country'),
    json_extract(value, '$.status'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  FROM json_each(?) WHERE true
  ON CONFLICT (platform, account_id, location_id) DO UPDATE SET
    brand_id = excluded.brand_id, name = excluded.name, locality = excluded.locality,
    admin_area = excluded.admin_area, country = excluded.country, status = excluded.status,
    synced_at = excluded.synced_at`;

export function adPlatformStatements(snapshot: AdPlatformSnapshot): {
  statements: Array<{ sql: string; params: unknown[] }>;
  dailyRows: number;
} {
  const { platform, accountId, range } = snapshot;
  const statements: Array<{ sql: string; params: unknown[] }> = [];

  // Campaigns first: every daily row references one.
  for (const part of chunks(snapshot.campaigns)) {
    statements.push({
      sql: CAMPAIGN_UPSERT,
      params: [platform, accountId, JSON.stringify(part.map((c) => ({ ...c, deleted: c.deleted ? 1 : 0 })))],
    });
  }

  // Last write wins on a repeated key, so a row Apple repeats across pages
  // is stored once rather than counted twice.
  const unique = new Map<string, AdPlatformSnapshot['daily'][number]>();
  for (const row of snapshot.daily) {
    if (row.date < range.from || row.date > range.to) continue;
    unique.set(`${row.date}|${row.campaignId}|${row.breakdown}|${row.dimension}`, row);
  }
  for (const part of chunks([...unique.values()])) {
    statements.push({
      sql: DAILY_INSERT,
      params: [
        platform,
        accountId,
        snapshot.runId,
        JSON.stringify(
          part.map((r) => ({
            date: r.date,
            campaignId: r.campaignId,
            breakdown: r.breakdown,
            dimension: r.dimension,
            currency: r.currency,
            spend: r.spend,
            impressions: r.impressions,
            clicks: r.clicks,
            conversions: r.conversions,
            conversionsJson: r.conversionDetail ? JSON.stringify(r.conversionDetail) : null,
          }))
        ),
      ],
    });
  }

  for (const part of chunks(snapshot.locations)) {
    statements.push({ sql: LOCATION_UPSERT, params: [platform, accountId, JSON.stringify(part)] });
  }

  // Last: whatever this run did not write in its window is gone from the
  // platform, a campaign that stopped or a day restated to nothing.
  statements.push({
    sql: `DELETE FROM ad_platform_daily WHERE platform = ? AND account_id = ? AND metric_date >= ? AND metric_date <= ? AND sync_run IS NOT ?`,
    params: [platform, accountId, range.from, range.to, snapshot.runId],
  });
  return { statements, dailyRows: unique.size };
}

// Returns how many daily rows the window now holds.
export async function writeAdPlatformSnapshot(db: ConnectorDb, snapshot: AdPlatformSnapshot): Promise<number> {
  const { statements, dailyRows } = adPlatformStatements(snapshot);
  await db.batch(statements);
  return dailyRows;
}
