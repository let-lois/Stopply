-- Stopply platform, initial schema.
--
-- Two rules run through all of it.
--
-- Every tenant-scoped table carries client_id with an index, because the
-- server derives that value from the session and filters on it in every
-- query. A table without the column cannot be scoped, so there is no such
-- table.
--
-- Invariants that matter are CHECK constraints and triggers, not comments.
-- A convention holds until someone writes the next query; a constraint holds
-- regardless of who writes it or how tired they were.

PRAGMA foreign_keys = ON;

-- ---------------------------------------------------------------------------
-- Tenants
-- ---------------------------------------------------------------------------

CREATE TABLE clients (
  id           TEXT PRIMARY KEY,
  code         TEXT NOT NULL UNIQUE,
  name         TEXT NOT NULL,
  industry     TEXT NOT NULL,
  status       TEXT NOT NULL CHECK (status IN ('active', 'paused', 'onboarding')),
  plan         TEXT NOT NULL CHECK (plan IN ('Enterprise', 'Pro', 'Growth')),
  data_mode    TEXT NOT NULL DEFAULT 'demo' CHECK (data_mode IN ('demo', 'live')),
  contact_name  TEXT NOT NULL,
  contact_email TEXT NOT NULL,
  created_at   TEXT NOT NULL,
  last_active  TEXT NOT NULL
);

-- ---------------------------------------------------------------------------
-- People and sessions
-- ---------------------------------------------------------------------------

CREATE TABLE users (
  id            TEXT PRIMARY KEY,
  -- Stored lowercased. The UNIQUE index is the only thing standing between
  -- two accounts differing by capitalisation.
  email         TEXT NOT NULL UNIQUE,
  name          TEXT NOT NULL,
  role          TEXT NOT NULL CHECK (role IN ('super_admin', 'client_admin', 'manager', 'representative')),
  client_id     TEXT REFERENCES clients(id) ON DELETE CASCADE,
  status        TEXT NOT NULL CHECK (status IN ('active', 'invited', 'inactive')),
  -- Null until an invited user sets one. Login refuses a null hash rather
  -- than treating it as an empty password.
  password_hash TEXT,
  created_at    TEXT NOT NULL,

  -- A client-scoped role without a client is a user object no real backend
  -- could issue. The prototype's role switcher produced one on every use, so
  -- the database refuses to hold it.
  CHECK (
    (role = 'super_admin' AND client_id IS NULL) OR
    (role <> 'super_admin' AND client_id IS NOT NULL)
  )
);

CREATE INDEX idx_users_client ON users(client_id);

CREATE TABLE sessions (
  -- The SHA-256 of the cookie token. The token itself is never written down,
  -- so a copy of this table is not a set of working credentials.
  id           TEXT PRIMARY KEY,
  user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at   TEXT NOT NULL,
  expires_at   TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  ip_address   TEXT,
  user_agent   TEXT
);

CREATE INDEX idx_sessions_user ON sessions(user_id);
CREATE INDEX idx_sessions_expires ON sessions(expires_at);

-- ---------------------------------------------------------------------------
-- Entitlement
-- ---------------------------------------------------------------------------

-- Entitlement is the existence of a row, not a boolean column, so "disabled"
-- and "missing" cannot drift apart and disagree about what a client bought.
CREATE TABLE client_modules (
  client_id  TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  module_id  TEXT NOT NULL CHECK (
    module_id IN ('advertising', 'field_sales', 'ecommerce', 'logistics', 'crm', 'analytics')
  ),
  enabled_at TEXT NOT NULL,
  PRIMARY KEY (client_id, module_id)
);

CREATE INDEX idx_client_modules_client ON client_modules(client_id);

CREATE TABLE integrations (
  id             TEXT PRIMARY KEY,
  client_id      TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  name           TEXT NOT NULL,
  provider       TEXT NOT NULL CHECK (
    provider IN ('meta', 'google_ads', 'shopify', 'stripe', 'field_maps', 'carrier_api')
  ),
  connected      INTEGER NOT NULL DEFAULT 0 CHECK (connected IN (0, 1)),
  data_mode      TEXT NOT NULL DEFAULT 'demo' CHECK (data_mode IN ('demo', 'live')),
  account_name   TEXT,
  last_synced_at TEXT
);

CREATE INDEX idx_integrations_client ON integrations(client_id);

-- ---------------------------------------------------------------------------
-- Credentials
-- ---------------------------------------------------------------------------

CREATE TABLE credential_refs (
  id         TEXT PRIMARY KEY,
  client_id  TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  provider   TEXT NOT NULL,
  key_name   TEXT NOT NULL,
  -- The only part of the value that ever leaves this table.
  last4      TEXT NOT NULL,
  -- AES-GCM ciphertext under a key held in a Worker binding. No HTTP route
  -- selects this column and no handler decrypts it. When an integration needs
  -- the value it reads it in the same request that spends it, server to
  -- server, and still never returns it downstream.
  sealed     BLOB NOT NULL,
  status     TEXT NOT NULL CHECK (status IN ('active', 'revoked', 'expired')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  created_by TEXT REFERENCES users(id),
  -- Rotation is delete and recreate. This is what makes that the only option.
  UNIQUE (client_id, provider, key_name)
);

CREATE INDEX idx_credential_refs_client ON credential_refs(client_id);

-- ---------------------------------------------------------------------------
-- Audit
-- ---------------------------------------------------------------------------

CREATE TABLE audit_log (
  id          TEXT PRIMARY KEY,
  -- The server's clock. A client-supplied timestamp in an audit trail is a
  -- field the audited party controls.
  occurred_at TEXT NOT NULL,
  user_id     TEXT NOT NULL REFERENCES users(id),
  -- Denormalised on purpose: the trail has to still read correctly after a
  -- rename, a role change, or a departure.
  user_name   TEXT NOT NULL,
  client_id   TEXT REFERENCES clients(id) ON DELETE SET NULL,
  client_name TEXT,
  module_id   TEXT,
  action      TEXT NOT NULL,
  details     TEXT NOT NULL,
  ip_address  TEXT
);

CREATE INDEX idx_audit_client ON audit_log(client_id);
CREATE INDEX idx_audit_occurred ON audit_log(occurred_at);

-- Append only, enforced. Without these an audit trail is a table that anyone
-- with a query console can edit, which is worth roughly nothing.
CREATE TRIGGER audit_log_no_update BEFORE UPDATE ON audit_log
BEGIN
  SELECT RAISE(ABORT, 'audit_log is append only');
END;

CREATE TRIGGER audit_log_no_delete BEFORE DELETE ON audit_log
BEGIN
  SELECT RAISE(ABORT, 'audit_log is append only');
END;

-- ---------------------------------------------------------------------------
-- Field sales
-- ---------------------------------------------------------------------------

CREATE TABLE territories (
  id              TEXT PRIMARY KEY,
  client_id       TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  north           REAL NOT NULL,
  south           REAL NOT NULL,
  east            REAL NOT NULL,
  west            REAL NOT NULL,
  assigned_rep_id TEXT,
  CHECK (north > south AND east > west)
);

CREATE INDEX idx_territories_client ON territories(client_id);

CREATE TABLE reps (
  id           TEXT PRIMARY KEY,
  client_id    TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  name         TEXT NOT NULL,
  territory_id TEXT REFERENCES territories(id) ON DELETE SET NULL,
  -- A rep may or may not also be a login. Null means they do not sign in.
  user_id      TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at   TEXT NOT NULL
);

CREATE INDEX idx_reps_client ON reps(client_id);

CREATE TABLE properties (
  id           TEXT PRIMARY KEY,
  client_id    TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  address      TEXT NOT NULL,
  city         TEXT NOT NULL,
  state        TEXT NOT NULL,
  postal_code  TEXT NOT NULL,
  lat          REAL NOT NULL,
  lng          REAL NOT NULL,
  territory_id TEXT NOT NULL REFERENCES territories(id) ON DELETE CASCADE,
  disposition  TEXT NOT NULL CHECK (
    disposition IN (
      'not_visited', 'no_answer', 'come_back', 'not_interested',
      'interested', 'appointment_set', 'closed_sale', 'do_not_knock'
    )
  ),
  owner_name   TEXT,
  owner_phone  TEXT,
  notes        TEXT,
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL
);

CREATE INDEX idx_properties_client ON properties(client_id);
CREATE INDEX idx_properties_territory ON properties(territory_id);

CREATE TABLE visits (
  id             TEXT PRIMARY KEY,
  -- Minted on the phone, before the knock is ever uploaded, and UNIQUE here.
  -- That index is the whole offline story: a rep out of signal keeps knocking,
  -- the outbox retries whenever it can, and a resend of a knock already
  -- recorded is answered as a success rather than as an error. Naming it
  -- device_visit_id rather than client_uuid keeps it clearly distinct from
  -- client_id, which means the tenant.
  device_visit_id TEXT NOT NULL UNIQUE,
  client_id      TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  property_id    TEXT NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  rep_id         TEXT NOT NULL REFERENCES reps(id) ON DELETE CASCADE,
  disposition    TEXT NOT NULL CHECK (
    disposition IN (
      'not_visited', 'no_answer', 'come_back', 'not_interested',
      'interested', 'appointment_set', 'closed_sale', 'do_not_knock'
    )
  ),
  notes          TEXT,
  -- The phone's clock at the door. Reporting reads this, so a knock uploaded
  -- hours later still lands on the day it happened.
  occurred_at    TEXT NOT NULL,
  -- The server's clock on arrival. Kept because the gap between the two is
  -- the only way to tell a backdated entry from a late upload.
  recorded_at    TEXT NOT NULL
);

CREATE INDEX idx_visits_client ON visits(client_id);
CREATE INDEX idx_visits_property ON visits(property_id);
CREATE INDEX idx_visits_client_occurred ON visits(client_id, occurred_at);
