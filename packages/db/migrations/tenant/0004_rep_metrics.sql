-- Per-rep monthly counters for door-to-door tenants: setters knock doors
-- and set appointments, closers sit them and close. One row per rep per
-- month per source; a rep active on both sides carries both sets of
-- counters. Replaced wholesale per (month, source) on each import, same
-- replay semantics as raw_ad_spend.
CREATE TABLE IF NOT EXISTS rep_metrics (
  period_month TEXT NOT NULL,
  source_key TEXT NOT NULL,
  rep TEXT NOT NULL,
  knocks INTEGER NOT NULL DEFAULT 0,
  pitches INTEGER NOT NULL DEFAULT 0,
  appointments_set INTEGER NOT NULL DEFAULT 0,
  sits_set INTEGER NOT NULL DEFAULT 0,
  sits_run INTEGER NOT NULL DEFAULT 0,
  closes INTEGER NOT NULL DEFAULT 0,
  installs INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (period_month, source_key, rep)
);
