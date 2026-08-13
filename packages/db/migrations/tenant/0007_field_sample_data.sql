-- Marks a row as sample data.
--
-- A client needs to see the reporting working before their crew has knocked
-- anything, both to sign off on it and to learn to read it. That means
-- loading believable activity, which then has to be removable without
-- taking any real work with it.
--
-- A flag rather than a naming convention or a date cutoff: those are
-- guesses, and getting the guess wrong deletes a rep's actual day. Sample
-- rows say so about themselves, and the delete only ever matches on this.
ALTER TABLE field_reps ADD COLUMN is_sample INTEGER NOT NULL DEFAULT 0;
ALTER TABLE field_addresses ADD COLUMN is_sample INTEGER NOT NULL DEFAULT 0;
ALTER TABLE field_visits ADD COLUMN is_sample INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_field_visits_sample ON field_visits (is_sample);
CREATE INDEX IF NOT EXISTS idx_field_addresses_sample ON field_addresses (is_sample);
CREATE INDEX IF NOT EXISTS idx_field_reps_sample ON field_reps (is_sample);
