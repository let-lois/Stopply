-- Agency wide configuration the admin can manage from the console instead
-- of editing code or running wrangler. Secret values are stored AES-GCM
-- encrypted under CRED_MASTER_KEY, exactly like the tenant credential vault,
-- and are never returned to the client in plaintext.

CREATE TABLE IF NOT EXISTS agency_settings (
  key TEXT PRIMARY KEY,
  is_secret INTEGER NOT NULL DEFAULT 1,
  value_ciphertext TEXT,
  value_iv TEXT,
  value_plain TEXT,
  updated_by TEXT,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- Per member permission flags for agency staff, kept in a side table so the
-- migration stays idempotent (CREATE IF NOT EXISTS) when re-applied. Admins
-- implicitly have every permission; a row here only widens what a non admin
-- staff member may do.
CREATE TABLE IF NOT EXISTS agency_user_permissions (
  user_id TEXT PRIMARY KEY,
  permissions_json TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
