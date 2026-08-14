-- Rep sign-in.
--
-- Two populations, two tables, two cookies. Reps authenticate against `reps`
-- and never appear in `users`, and their sessions live here rather than in
-- `sessions`.
--
-- That separation is the point, and it is structural rather than a matter of
-- checking carefully. A field token hashes to a row in field_sessions, which
-- joins to reps, which has no role column and no path to a client's reporting.
-- There is no query that can turn a rep's cookie into a dashboard session,
-- because the two never meet a shared table.
--
-- It matters because one person holds both at once. A manager who also knocks
-- carries a dashboard session and a field session on the same hostname, and if
-- a rep's phone is lost or their credential leaks, the blast radius has to stop
-- at their own doors.

ALTER TABLE reps ADD COLUMN email TEXT;
ALTER TABLE reps ADD COLUMN password_hash TEXT;
-- Reps stop working for a company. Deactivating has to be possible without
-- deleting the rep, because their knocks are the client's history.
ALTER TABLE reps ADD COLUMN status TEXT NOT NULL DEFAULT 'active';

-- Login is by email alone, so the address has to identify one rep across the
-- whole platform. Partial, because a rep who does not sign in has no email and
-- several such rows must not collide on NULL.
CREATE UNIQUE INDEX idx_reps_email ON reps(email) WHERE email IS NOT NULL;

CREATE TABLE field_sessions (
  -- SHA-256 of the cookie token, same as the dashboard's. A copy of this table
  -- is not a set of working logins.
  id           TEXT PRIMARY KEY,
  rep_id       TEXT NOT NULL REFERENCES reps(id) ON DELETE CASCADE,
  -- Denormalised from the rep so scoping never has to join to find it. A
  -- field request is scoped by this column and nothing the caller sends.
  client_id    TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  created_at   TEXT NOT NULL,
  -- Deliberately long. A rep signing in again at a door, in the sun, with
  -- gloves on, is a tax on every knock that follows it.
  expires_at   TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  ip_address   TEXT,
  user_agent   TEXT
);

CREATE INDEX idx_field_sessions_rep ON field_sessions(rep_id);
CREATE INDEX idx_field_sessions_expires ON field_sessions(expires_at);
