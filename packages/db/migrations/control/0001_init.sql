-- Control plane schema. One database, bound to the API Worker as CONTROL_DB.
-- Holds the tenant registry and everything agency wide. Tenant data never lives here.

CREATE TABLE IF NOT EXISTS tenants (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended')),
  plan TEXT NOT NULL DEFAULT 'starter' CHECK (plan IN ('starter', 'pro', 'whitelabel')),
  timezone TEXT NOT NULL DEFAULT 'America/Phoenix',
  d1_database_id TEXT,
  d1_database_name TEXT,
  schema_version INTEGER NOT NULL DEFAULT 0,
  theme_json TEXT,
  layout_json TEXT,
  custom_hostname TEXT,
  hostname_status TEXT,
  footer_credit INTEGER NOT NULL DEFAULT 1,
  funnel_labels_json TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS agency_users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('agency_admin', 'agency_staff')),
  password_hash TEXT NOT NULL,
  assigned_tenants_json TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- Directory of tenant user emails so the agency host login can redirect
-- a tenant user to their own domain. Stores no password material.
CREATE TABLE IF NOT EXISTS tenant_directory (
  email TEXT NOT NULL,
  tenant_id TEXT NOT NULL,
  PRIMARY KEY (email, tenant_id)
);

CREATE TABLE IF NOT EXISTS audit_log (
  id TEXT PRIMARY KEY,
  actor_type TEXT NOT NULL CHECK (actor_type IN ('agency', 'tenant', 'system', 'chat')),
  actor_id TEXT,
  actor_name TEXT,
  tenant_id TEXT,
  action TEXT NOT NULL,
  target TEXT,
  before_json TEXT,
  after_json TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX IF NOT EXISTS idx_audit_tenant ON audit_log (tenant_id, created_at);
CREATE INDEX IF NOT EXISTS idx_audit_action ON audit_log (action, created_at);

CREATE TABLE IF NOT EXISTS help_articles (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  body_md TEXT NOT NULL,
  tags TEXT,
  published INTEGER NOT NULL DEFAULT 0,
  updated_by TEXT,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS agency_rollup (
  tenant_id TEXT NOT NULL,
  period_month TEXT NOT NULL,
  leads INTEGER NOT NULL DEFAULT 0,
  scheduled INTEGER NOT NULL DEFAULT 0,
  completed INTEGER NOT NULL DEFAULT 0,
  purchases INTEGER NOT NULL DEFAULT 0,
  revenue REAL NOT NULL DEFAULT 0,
  spend REAL NOT NULL DEFAULT 0,
  pulled_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id, period_month)
);

CREATE TABLE IF NOT EXISTS chat_tool_log (
  id TEXT PRIMARY KEY,
  tenant_id TEXT,
  user_id TEXT NOT NULL,
  role TEXT NOT NULL,
  tool_name TEXT NOT NULL,
  input_json TEXT,
  result TEXT,
  reverted INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- Custom hostname records mirror Cloudflare for SaaS state per tenant hostname.
CREATE TABLE IF NOT EXISTS custom_hostnames (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  hostname TEXT NOT NULL UNIQUE,
  cf_hostname_id TEXT,
  status TEXT NOT NULL DEFAULT 'pending_validation',
  cname_target TEXT,
  txt_name TEXT,
  txt_value TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT
);
