-- Apple Maps Ads, and the provider neutral tables future ad platforms
-- (TikTok, Microsoft Advertising) will share.
--
-- 1. integrations: widen the provider check to allow apple-maps-ads and add
--    an enabled flag, so reporting can be switched off without throwing the
--    credentials away. SQLite cannot alter a CHECK in place, so this rebuilds
--    the table exactly as 0005 did. Nothing references integrations.
--
-- 2. ad_platform_*: what a reporting API returns that raw_ad_spend cannot
--    hold. raw_ad_spend stays the one place spend reaches the monthly rollup
--    (campaign level, USD), so every existing report keeps working. These
--    tables add the daily, per location and per placement detail behind it.
--
-- Every row is keyed by (platform, account_id, ...) so a re sync replaces
-- rather than duplicates. No personal data is stored: campaigns, business
-- locations (name and city only) and aggregate counts.
--
-- Safe to run again after a partial failure: the scratch table is dropped
-- first, the copy reads only columns both shapes have, and every new table
-- and index is IF NOT EXISTS.

CREATE TABLE IF NOT EXISTS integrations (
  key TEXT PRIMARY KEY,
  provider TEXT NOT NULL CHECK (provider IN ('boulevard', 'housecallpro', 'jobber', 'meta-ads')),
  status TEXT NOT NULL DEFAULT 'disconnected' CHECK (status IN ('disconnected', 'connected', 'error')),
  credentials_ciphertext TEXT,
  credentials_iv TEXT,
  connected_as TEXT,
  connected_by TEXT,
  connected_at TEXT,
  last_sync_at TEXT,
  last_sync_result TEXT,
  plan_check_json TEXT
);
DROP TABLE IF EXISTS integrations_new;
CREATE TABLE integrations_new (
  key TEXT PRIMARY KEY,
  provider TEXT NOT NULL CHECK (provider IN ('boulevard', 'housecallpro', 'jobber', 'meta-ads', 'apple-maps-ads')),
  status TEXT NOT NULL DEFAULT 'disconnected' CHECK (status IN ('disconnected', 'connected', 'error')),
  credentials_ciphertext TEXT,
  credentials_iv TEXT,
  connected_as TEXT,
  connected_by TEXT,
  connected_at TEXT,
  last_sync_at TEXT,
  last_sync_result TEXT,
  plan_check_json TEXT,
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1))
);
INSERT INTO integrations_new (key, provider, status, credentials_ciphertext, credentials_iv, connected_as, connected_by, connected_at, last_sync_at, last_sync_result, plan_check_json)
  SELECT key, provider, status, credentials_ciphertext, credentials_iv, connected_as, connected_by, connected_at, last_sync_at, last_sync_result, plan_check_json FROM integrations;
DROP TABLE integrations;
ALTER TABLE integrations_new RENAME TO integrations;

-- One row per campaign, refreshed on every sync from the report metadata.
-- promoted_object_id is the Apple Maps brand id for apple_maps.
CREATE TABLE IF NOT EXISTS ad_platform_campaigns (
  platform TEXT NOT NULL,
  account_id TEXT NOT NULL,
  campaign_id TEXT NOT NULL,
  name TEXT NOT NULL,
  status TEXT,
  display_status TEXT,
  promoted_object_id TEXT,
  currency TEXT,
  daily_budget REAL,
  lifetime_budget REAL,
  start_time TEXT,
  end_time TEXT,
  deleted INTEGER NOT NULL DEFAULT 0,
  synced_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (platform, account_id, campaign_id)
);

-- Business locations an ad account's brand advertises, for naming the
-- location breakdown. Name and city only.
CREATE TABLE IF NOT EXISTS ad_platform_locations (
  platform TEXT NOT NULL,
  account_id TEXT NOT NULL,
  location_id TEXT NOT NULL,
  brand_id TEXT,
  name TEXT,
  locality TEXT,
  admin_area TEXT,
  country TEXT,
  status TEXT,
  synced_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (platform, account_id, location_id)
);

-- Daily metrics. breakdown says which cut a row belongs to:
--   campaign   one row per campaign per day, dimension ''. Totals come
--              from these rows only.
--   location   the same campaign split by business location.
--   placement  the same campaign split by placement.
-- The three cuts each sum to the same total, so a report reads one cut at a
-- time and never adds them together. clicks is the platform's own unit
-- (taps for Apple Maps). conversions is NULL when the platform reports none,
-- which is not the same as zero. conversions_json keeps the platform's own
-- action breakdown under its own names.
CREATE TABLE IF NOT EXISTS ad_platform_daily (
  platform TEXT NOT NULL,
  account_id TEXT NOT NULL,
  metric_date TEXT NOT NULL,
  campaign_id TEXT NOT NULL,
  breakdown TEXT NOT NULL CHECK (breakdown IN ('campaign', 'location', 'placement')),
  dimension TEXT NOT NULL DEFAULT '',
  currency TEXT,
  spend REAL NOT NULL DEFAULT 0,
  impressions INTEGER NOT NULL DEFAULT 0,
  clicks INTEGER NOT NULL DEFAULT 0,
  conversions INTEGER,
  conversions_json TEXT,
  synced_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (platform, account_id, metric_date, campaign_id, breakdown, dimension),
  FOREIGN KEY (platform, account_id, campaign_id) REFERENCES ad_platform_campaigns (platform, account_id, campaign_id)
);
CREATE INDEX IF NOT EXISTS idx_ad_platform_daily_date ON ad_platform_daily (platform, breakdown, metric_date);

-- One row per sync attempt. status running while it works, then one of
-- succeeded, no_campaigns or failed. error is a short, already sanitized
-- message: never a token, a key or a raw API response.
CREATE TABLE IF NOT EXISTS ad_platform_sync_runs (
  id TEXT PRIMARY KEY,
  integration_key TEXT NOT NULL,
  platform TEXT NOT NULL,
  account_id TEXT,
  status TEXT NOT NULL CHECK (status IN ('running', 'succeeded', 'no_campaigns', 'failed')),
  range_from TEXT NOT NULL,
  range_to TEXT NOT NULL,
  started_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  finished_at TEXT,
  campaigns INTEGER,
  rows_written INTEGER,
  failure TEXT,
  error TEXT
);
CREATE INDEX IF NOT EXISTS idx_ad_platform_sync_runs_key ON ad_platform_sync_runs (integration_key, started_at);
