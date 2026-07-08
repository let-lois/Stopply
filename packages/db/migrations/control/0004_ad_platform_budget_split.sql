-- Per platform breakdown of the committed monthly ad spend budget, e.g.
-- {"meta": 19000, "google": 9500}. monthly_ad_spend_budget (0003) stays the
-- authoritative total; this is optional detail on top of it, keyed by the
-- same platform codes as ad_platforms_json. Not required to sum exactly to
-- the total, the roster shows both and lets a mismatch be visible rather
-- than silently rejecting one.
ALTER TABLE tenants ADD COLUMN ad_platform_budget_json TEXT;
