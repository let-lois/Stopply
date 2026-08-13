-- Door to door field tracking. Purpose built for reps logging activity at
-- the door from a phone, and for reporting on that activity.
--
-- Separate from the marketing attribution tables above on purpose. Those
-- describe a contact's journey through paid channels; these describe a
-- physical visit to a physical address by a named rep at a known time.
-- The two only meet in reporting.
--
-- Every tenant database gets these tables and the default disposition
-- catalog. They stay inert for a tenant with no reps and no visits, so
-- there is no separate enable step to forget.

-- Field reps authenticate against this table, not the dashboard users
-- table. A rep is not a dashboard user: they never see client reporting,
-- and their sessions are refused by every /api/tenant route. Keeping the
-- two populations apart means a leaked rep credential cannot reach the
-- dashboard at all, rather than relying on a role check to hold.
CREATE TABLE IF NOT EXISTS field_reps (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  phone TEXT,
  -- 'manager' additionally sees the whole team's numbers in the field app.
  role TEXT NOT NULL DEFAULT 'rep' CHECK (role IN ('rep', 'manager')),
  team TEXT,
  password_hash TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  last_login_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX IF NOT EXISTS idx_field_reps_active ON field_reps (active, name);

-- The outcome vocabulary, per tenant and editable. Reporting reads the
-- flags rather than hard coding disposition keys, so a tenant can rename
-- or add outcomes without the dashboard losing its funnel.
CREATE TABLE IF NOT EXISTS field_dispositions (
  key TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  -- Someone answered the door. Distinguishes a worked door from a knock
  -- that reached nobody, which is the difference between contact rate and
  -- knock count.
  is_contact INTEGER NOT NULL DEFAULT 0,
  is_lead INTEGER NOT NULL DEFAULT 0,
  is_appointment INTEGER NOT NULL DEFAULT 0,
  is_sale INTEGER NOT NULL DEFAULT 0,
  -- Marks the address do-not-knock for everyone on the team from then on.
  marks_do_not_knock INTEGER NOT NULL DEFAULT 0,
  color TEXT,
  active INTEGER NOT NULL DEFAULT 1
);

-- One row per physical address, however many times it is visited. Gives
-- reporting "doors touched" as distinct from "visits logged", and carries
-- the do-not-knock flag that has to outlive any single visit.
CREATE TABLE IF NOT EXISTS field_addresses (
  id TEXT PRIMARY KEY,
  -- Normalized street + unit + postal. Two reps typing the same house
  -- differently still land on one row. See normalizeAddress in
  -- packages/field.
  address_key TEXT NOT NULL UNIQUE,
  street TEXT NOT NULL,
  unit TEXT,
  city TEXT,
  state TEXT,
  postal_code TEXT,
  lat REAL,
  lng REAL,
  first_visited_at TEXT,
  last_visited_at TEXT,
  last_disposition TEXT,
  visit_count INTEGER NOT NULL DEFAULT 0,
  do_not_knock INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX IF NOT EXISTS idx_field_addresses_last ON field_addresses (last_visited_at);
CREATE INDEX IF NOT EXISTS idx_field_addresses_dnk ON field_addresses (do_not_knock);

-- The log itself: one row per door interaction.
--
-- client_uuid is minted on the rep's phone before the visit is ever sent.
-- Field work loses signal constantly, so the app queues visits locally and
-- retries; the unique index is what makes that retry safe to repeat
-- forever without duplicating a knock.
--
-- occurred_at is the phone's clock at the door, recorded_at is the
-- server's clock on arrival. They differ by however long the rep was
-- offline, and reporting deliberately uses occurred_at: a day's numbers
-- should not move because a phone found signal after midnight.
CREATE TABLE IF NOT EXISTS field_visits (
  id TEXT PRIMARY KEY,
  client_uuid TEXT NOT NULL UNIQUE,
  address_id TEXT NOT NULL,
  rep_id TEXT NOT NULL,
  disposition TEXT NOT NULL,
  notes TEXT,
  contact_name TEXT,
  contact_phone TEXT,
  contact_email TEXT,
  occurred_at TEXT NOT NULL,
  recorded_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  -- Where the phone actually was when the visit was logged, and how good
  -- that fix was. Kept alongside the address so a visit logged from three
  -- miles away is visible as such instead of silently trusted.
  device_lat REAL,
  device_lng REAL,
  accuracy_m REAL,
  follow_up_at TEXT,
  edited_at TEXT,
  source TEXT NOT NULL DEFAULT 'field-app' CHECK (source IN ('field-app', 'import'))
);
CREATE INDEX IF NOT EXISTS idx_field_visits_occurred ON field_visits (occurred_at);
CREATE INDEX IF NOT EXISTS idx_field_visits_rep ON field_visits (rep_id, occurred_at);
CREATE INDEX IF NOT EXISTS idx_field_visits_address ON field_visits (address_id, occurred_at);
CREATE INDEX IF NOT EXISTS idx_field_visits_disposition ON field_visits (disposition, occurred_at);
CREATE INDEX IF NOT EXISTS idx_field_visits_followup ON field_visits (follow_up_at);

-- Default outcome vocabulary. INSERT OR IGNORE so re-running the tenant
-- migrations never overwrites a tenant that has edited its own labels.
INSERT OR IGNORE INTO field_dispositions (key, label, sort_order, is_contact, is_lead, is_appointment, is_sale, marks_do_not_knock, color) VALUES ('no_answer', 'No answer', 10, 0, 0, 0, 0, 0, '#8b97a8');
INSERT OR IGNORE INTO field_dispositions (key, label, sort_order, is_contact, is_lead, is_appointment, is_sale, marks_do_not_knock, color) VALUES ('come_back', 'Come back later', 20, 0, 0, 0, 0, 0, '#c7902f');
INSERT OR IGNORE INTO field_dispositions (key, label, sort_order, is_contact, is_lead, is_appointment, is_sale, marks_do_not_knock, color) VALUES ('not_interested', 'Not interested', 30, 1, 0, 0, 0, 0, '#c7502f');
INSERT OR IGNORE INTO field_dispositions (key, label, sort_order, is_contact, is_lead, is_appointment, is_sale, marks_do_not_knock, color) VALUES ('not_qualified', 'Not qualified', 40, 1, 0, 0, 0, 0, '#8b97a8');
INSERT OR IGNORE INTO field_dispositions (key, label, sort_order, is_contact, is_lead, is_appointment, is_sale, marks_do_not_knock, color) VALUES ('renter', 'Renter, not the decision maker', 50, 1, 0, 0, 0, 0, '#8b97a8');
INSERT OR IGNORE INTO field_dispositions (key, label, sort_order, is_contact, is_lead, is_appointment, is_sale, marks_do_not_knock, color) VALUES ('callback', 'Callback scheduled', 60, 1, 1, 0, 0, 0, '#1f7ae0');
INSERT OR IGNORE INTO field_dispositions (key, label, sort_order, is_contact, is_lead, is_appointment, is_sale, marks_do_not_knock, color) VALUES ('appointment', 'Appointment set', 70, 1, 1, 1, 0, 0, '#6f5ad6');
INSERT OR IGNORE INTO field_dispositions (key, label, sort_order, is_contact, is_lead, is_appointment, is_sale, marks_do_not_knock, color) VALUES ('sale', 'Sale closed', 80, 1, 1, 1, 1, 0, '#1f9d6b');
INSERT OR IGNORE INTO field_dispositions (key, label, sort_order, is_contact, is_lead, is_appointment, is_sale, marks_do_not_knock, color) VALUES ('do_not_knock', 'Do not knock', 90, 1, 0, 0, 0, 1, '#211d16');
