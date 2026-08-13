-- Login throttling.
--
-- Verifying a password costs roughly 270ms of CPU by design. Turnstile keeps
-- most automated traffic off that endpoint, but a challenge solved once can be
-- replayed against many passwords, so the cost needs a second bound that does
-- not depend on the caller cooperating.
--
-- Keyed on the address rather than the email. Keying on the email alone lets
-- anyone lock a known account out of its own login by failing on purpose,
-- which converts a protection into a denial of service against the customer.

CREATE TABLE login_attempts (
  id          TEXT PRIMARY KEY,
  ip_address  TEXT NOT NULL,
  -- Recorded for the operator reading the trail, never used as the key.
  email       TEXT NOT NULL,
  attempted_at TEXT NOT NULL,
  succeeded   INTEGER NOT NULL CHECK (succeeded IN (0, 1))
);

CREATE INDEX idx_login_attempts_ip_time ON login_attempts(ip_address, attempted_at);
