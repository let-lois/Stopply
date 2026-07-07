-- Retainer level ad spend budget and platform mix per client, captured at
-- provisioning time and editable afterward from the roster. This is the
-- agency's committed monthly number, distinct from the actual spend rolled
-- up from each tenant's own imported CSVs (agency_rollup.spend) -- the
-- roster compares the two side by side.
ALTER TABLE tenants ADD COLUMN monthly_ad_spend_budget REAL;
ALTER TABLE tenants ADD COLUMN ad_platforms_json TEXT;
