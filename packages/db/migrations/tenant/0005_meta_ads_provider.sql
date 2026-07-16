-- Widen the integrations table's provider check to allow meta-ads, an
-- ad-spend connector (not CRM-shaped like the original three). SQLite
-- can't alter a CHECK constraint in place, so this rebuilds the table:
-- a copy with the wider constraint, move the rows over, swap names.
CREATE TABLE integrations_new (
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
INSERT INTO integrations_new SELECT * FROM integrations;
DROP TABLE integrations;
ALTER TABLE integrations_new RENAME TO integrations;
