-- The funnel a door actually moves through, and what a rep sees at the kerb.
--
-- Three changes.
--
-- 1. There was no way to record that a booked appointment was kept. Booked and
--    sold were the only two stages after contact, so the gap between them was
--    invisible, and in this business that gap is the leak: an appointment
--    nobody turned up to looks identical to one that has not happened yet.
--    appointment_kept and appointment_missed close it.
--
-- 2. vehicle_present. A car on the drive is the single best signal that
--    somebody is home, and it is what a rep uses to decide which no-answers
--    are worth a second pass. Nullable on purpose: absent means the rep did
--    not say, which is different from saying there was no car.
--
-- 3. clients.timezone. Reporting days have to be cut in the client's zone, not
--    the reader's. A manager in Arizona looking at a California crew would
--    otherwise see the day boundary move by an hour, and "knocked today" would
--    disagree with the crew's own count. Defaulting to Los Angeles because
--    that is the market.
--
-- SQLite cannot alter a CHECK constraint, so the two tables carrying the
-- disposition list are rebuilt. Dropping the constraints instead would have
-- been one line and would have left the column able to hold anything.
--
-- READ THIS BEFORE REBUILDING A TABLE ON D1.
--
-- The first version of this migration opened with `PRAGMA foreign_keys = OFF`
-- and rebuilt properties before visits. D1 manages the connection and ignores
-- that pragma: `PRAGMA foreign_keys` still reported 1. So `DROP TABLE
-- properties` cascaded through visits.property_id ON DELETE CASCADE and
-- deleted every knock in the database before the copy could read them. The
-- copy then dutifully inserted nothing, and the migration reported success.
--
-- Reordering does not save it either, because visits references properties
-- whichever way round they are rebuilt. The fix is to stage the child rows in
-- a table that has no foreign key at all: CREATE TABLE AS SELECT produces one
-- with no constraints, so the cascade cannot reach it.

ALTER TABLE clients ADD COLUMN timezone TEXT NOT NULL DEFAULT 'America/Los_Angeles';

-- Out of reach of the cascade. No constraints, no foreign keys, nothing for
-- DROP TABLE properties to follow.
CREATE TABLE visits_backup AS SELECT * FROM visits;

-- Properties.
CREATE TABLE properties_new (
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
      'interested', 'appointment_set', 'appointment_kept', 'appointment_missed',
      'closed_sale', 'do_not_knock'
    )
  ),
  owner_name   TEXT,
  owner_phone  TEXT,
  notes        TEXT,
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL
);

INSERT INTO properties_new SELECT * FROM properties;
DROP TABLE properties;
ALTER TABLE properties_new RENAME TO properties;

CREATE INDEX idx_properties_client ON properties(client_id);
CREATE INDEX idx_properties_territory ON properties(territory_id);
CREATE INDEX idx_properties_client_territory ON properties(client_id, territory_id);

-- Visits.
CREATE TABLE visits_new (
  id              TEXT PRIMARY KEY,
  device_visit_id TEXT NOT NULL UNIQUE,
  client_id       TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  property_id     TEXT NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  rep_id          TEXT NOT NULL REFERENCES reps(id) ON DELETE CASCADE,
  disposition     TEXT NOT NULL CHECK (
    disposition IN (
      'not_visited', 'no_answer', 'come_back', 'not_interested',
      'interested', 'appointment_set', 'appointment_kept', 'appointment_missed',
      'closed_sale', 'do_not_knock'
    )
  ),
  notes           TEXT,
  -- Null means the rep did not say. Deliberately three-valued: "no car" is a
  -- useful observation and "did not look" is not the same thing.
  vehicle_present INTEGER CHECK (vehicle_present IN (0, 1)),
  occurred_at     TEXT NOT NULL,
  recorded_at     TEXT NOT NULL
);

INSERT INTO visits_new (
  id, device_visit_id, client_id, property_id, rep_id, disposition, notes,
  vehicle_present, occurred_at, recorded_at
)
SELECT id, device_visit_id, client_id, property_id, rep_id, disposition, notes,
       NULL, occurred_at, recorded_at
  FROM visits_backup;

DROP TABLE visits;
ALTER TABLE visits_new RENAME TO visits;
DROP TABLE visits_backup;

CREATE INDEX idx_visits_client ON visits(client_id);
CREATE INDEX idx_visits_property ON visits(property_id);
CREATE INDEX idx_visits_client_occurred ON visits(client_id, occurred_at);
-- Per-rep reporting is about to be run over a much larger crew.
CREATE INDEX idx_visits_client_rep_occurred ON visits(client_id, rep_id, occurred_at);
