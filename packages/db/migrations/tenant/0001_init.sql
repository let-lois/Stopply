-- Tenant schema template. Applied to every tenant database at provision time
-- and kept current by migrate:tenants. One physical D1 database per tenant.

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('account_admin', 'viewer')),
  password_hash TEXT NOT NULL,
  view_config_json TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS sources (
  key TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('webhook', 'pixel', 'csv', 'integration')),
  connector_type TEXT,
  cadence INTEGER NOT NULL DEFAULT 7,
  platform_link TEXT,
  how_to TEXT,
  signing_secret_hash TEXT,
  field_map_json TEXT,
  verified_by TEXT,
  verified_at TEXT,
  records_through TEXT,
  last_import_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS csv_imports (
  id TEXT PRIMARY KEY,
  source_key TEXT NOT NULL,
  period_month TEXT NOT NULL,
  r2_key TEXT NOT NULL,
  row_count INTEGER NOT NULL DEFAULT 0,
  records_from TEXT,
  records_through TEXT,
  uploaded_by TEXT,
  uploaded_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX IF NOT EXISTS idx_imports_source ON csv_imports (source_key, period_month);

-- Immutable event log. Everything entering the system lands here first.
-- Rows are never updated or deleted. Derived tables recompute from here.
CREATE TABLE IF NOT EXISTS events (
  id TEXT PRIMARY KEY,
  occurred_at TEXT NOT NULL,
  received_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  source_key TEXT NOT NULL,
  event_type TEXT NOT NULL CHECK (event_type IN ('page_view', 'form_partial', 'form_submit', 'webhook_lead', 'integration_event')),
  visitor_id TEXT,
  contact_id TEXT,
  payload_json TEXT,
  utm_source TEXT,
  utm_medium TEXT,
  utm_campaign TEXT,
  utm_term TEXT,
  utm_content TEXT,
  gclid TEXT,
  fbclid TEXT,
  wbraid TEXT,
  msclkid TEXT,
  referrer TEXT,
  landing_page TEXT,
  ip_hash TEXT,
  user_agent TEXT
);
CREATE INDEX IF NOT EXISTS idx_events_occurred ON events (occurred_at);
CREATE INDEX IF NOT EXISTS idx_events_visitor ON events (visitor_id, occurred_at);
CREATE INDEX IF NOT EXISTS idx_events_contact ON events (contact_id, occurred_at);
CREATE INDEX IF NOT EXISTS idx_events_type ON events (event_type, occurred_at);

CREATE TABLE IF NOT EXISTS visitors (
  id TEXT PRIMARY KEY,
  first_seen_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  first_landing_page TEXT,
  first_referrer TEXT,
  first_utm_json TEXT,
  first_click_ids_json TEXT
);

CREATE TABLE IF NOT EXISTS contacts (
  id TEXT PRIMARY KEY,
  email_norm TEXT,
  phone_last10 TEXT,
  name_norm TEXT,
  first_name TEXT,
  last_name TEXT,
  created_at TEXT NOT NULL,
  visitor_id TEXT,
  first_touch_at TEXT,
  first_touch_channel TEXT,
  first_touch_source TEXT,
  first_touch_campaign TEXT,
  first_touch_json TEXT,
  latest_touch_at TEXT,
  latest_touch_channel TEXT,
  latest_touch_source TEXT,
  latest_touch_campaign TEXT,
  latest_touch_json TEXT,
  match_method TEXT,
  match_ambiguous INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_contacts_email ON contacts (email_norm);
CREATE INDEX IF NOT EXISTS idx_contacts_phone ON contacts (phone_last10);
CREATE INDEX IF NOT EXISTS idx_contacts_name ON contacts (name_norm);
CREATE INDEX IF NOT EXISTS idx_contacts_created ON contacts (created_at);

CREATE TABLE IF NOT EXISTS touchpoints (
  id TEXT PRIMARY KEY,
  contact_id TEXT NOT NULL,
  occurred_at TEXT NOT NULL,
  channel TEXT,
  source_key TEXT,
  campaign TEXT,
  event_id TEXT,
  position_cached INTEGER
);
CREATE INDEX IF NOT EXISTS idx_touch_contact ON touchpoints (contact_id, occurred_at);

CREATE TABLE IF NOT EXISTS stage_events (
  id TEXT PRIMARY KEY,
  contact_id TEXT,
  external_ref TEXT,
  stage TEXT NOT NULL CHECK (stage IN ('lead', 'scheduled', 'completed', 'purchase')),
  occurred_at TEXT NOT NULL,
  amount REAL,
  source_key TEXT,
  raw_json TEXT
);
CREATE INDEX IF NOT EXISTS idx_stage_contact ON stage_events (contact_id, stage, occurred_at);
CREATE INDEX IF NOT EXISTS idx_stage_occurred ON stage_events (occurred_at);
CREATE UNIQUE INDEX IF NOT EXISTS idx_stage_dedupe ON stage_events (stage, external_ref) WHERE external_ref IS NOT NULL;

CREATE TABLE IF NOT EXISTS integrations (
  key TEXT PRIMARY KEY,
  provider TEXT NOT NULL CHECK (provider IN ('boulevard', 'housecallpro', 'jobber')),
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

CREATE TABLE IF NOT EXISTS raw_ad_spend (
  period_month TEXT NOT NULL,
  channel TEXT NOT NULL,
  campaign TEXT NOT NULL,
  spend REAL NOT NULL DEFAULT 0,
  leads_reported INTEGER,
  imported_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (period_month, channel, campaign)
);

CREATE TABLE IF NOT EXISTS monthly_metrics (
  period_month TEXT NOT NULL,
  channel TEXT NOT NULL,
  attribution_basis TEXT NOT NULL DEFAULT 'first' CHECK (attribution_basis IN ('first', 'latest')),
  leads INTEGER NOT NULL DEFAULT 0,
  scheduled INTEGER NOT NULL DEFAULT 0,
  completed INTEGER NOT NULL DEFAULT 0,
  purchases INTEGER NOT NULL DEFAULT 0,
  revenue REAL NOT NULL DEFAULT 0,
  spend REAL NOT NULL DEFAULT 0,
  PRIMARY KEY (period_month, channel, attribution_basis)
);

CREATE TABLE IF NOT EXISTS campaign_metrics (
  period_month TEXT NOT NULL,
  channel TEXT NOT NULL,
  campaign TEXT NOT NULL,
  spend REAL NOT NULL DEFAULT 0,
  leads INTEGER NOT NULL DEFAULT 0,
  completed INTEGER NOT NULL DEFAULT 0,
  revenue REAL NOT NULL DEFAULT 0,
  PRIMARY KEY (period_month, channel, campaign)
);

CREATE TABLE IF NOT EXISTS lead_cohort (
  period_month TEXT NOT NULL,
  channel TEXT NOT NULL,
  bucket TEXT NOT NULL CHECK (bucket IN ('0', '30', '60', '90', 'total')),
  completed INTEGER NOT NULL DEFAULT 0,
  revenue REAL NOT NULL DEFAULT 0,
  PRIMARY KEY (period_month, channel, bucket)
);

CREATE TABLE IF NOT EXISTS month_quality (
  period_month TEXT PRIMARY KEY,
  ambiguous_match_count INTEGER NOT NULL DEFAULT 0,
  unmatched_lead_count INTEGER NOT NULL DEFAULT 0,
  partial_only_count INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS lead_attribution (
  contact_id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  channel_first TEXT,
  channel_latest TEXT,
  source_raw TEXT,
  campaign TEXT,
  followup_stage TEXT,
  treatment TEXT,
  match_method TEXT,
  match_ambiguous INTEGER NOT NULL DEFAULT 0,
  first_stage_scheduled_at TEXT,
  first_stage_completed_at TEXT,
  days_to_complete INTEGER,
  revenue_in_month REAL NOT NULL DEFAULT 0,
  revenue_90d REAL NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_lead_attr_created ON lead_attribution (created_at);

CREATE TABLE IF NOT EXISTS targets (
  period_month TEXT NOT NULL,
  metric TEXT NOT NULL,
  value REAL NOT NULL,
  PRIMARY KEY (period_month, metric)
);

CREATE TABLE IF NOT EXISTS funnel_stage_map (
  integration_key TEXT NOT NULL,
  external_event TEXT NOT NULL,
  stage TEXT NOT NULL CHECK (stage IN ('lead', 'scheduled', 'completed', 'purchase')),
  PRIMARY KEY (integration_key, external_event)
);

-- Tenant local settings, key value. Holds tracking selectors and similar knobs.
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value_json TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
