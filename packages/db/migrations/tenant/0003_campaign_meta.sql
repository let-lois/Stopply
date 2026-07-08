-- Per-campaign metadata that must survive rollups and re-imports.
-- campaign_metrics and ad_line_items are recomputed or replaced wholesale
-- (delete then insert) every time a rollup runs or a CSV re-uploads, so a
-- manually assigned campaign type cannot live on those rows. This side
-- table is keyed the same way ((channel, campaign), the join key used
-- everywhere else) and is only ever written by explicit user action.
CREATE TABLE IF NOT EXISTS campaign_meta (
  channel TEXT NOT NULL,
  campaign TEXT NOT NULL,
  campaign_type TEXT,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (channel, campaign)
);
