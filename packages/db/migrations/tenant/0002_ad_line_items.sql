-- Ad line item detail: individual Meta/Google ads within a campaign,
-- imported from ad level CSV exports. Extends raw_ad_spend's campaign
-- granularity down to the ad. Creative type is read from the export where
-- the platform reports it and can be corrected by staff afterward; the
-- source column tells the UI which one happened.
CREATE TABLE IF NOT EXISTS ad_line_items (
  period_month TEXT NOT NULL,
  channel TEXT NOT NULL,
  campaign TEXT NOT NULL,
  ad_name TEXT NOT NULL,
  ad_id TEXT,
  creative_type TEXT,
  creative_type_source TEXT NOT NULL DEFAULT 'auto' CHECK (creative_type_source IN ('auto', 'manual')),
  spend REAL NOT NULL DEFAULT 0,
  leads_reported INTEGER,
  imported_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (period_month, channel, campaign, ad_name)
);
