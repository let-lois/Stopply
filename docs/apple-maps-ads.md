# Apple Maps Ads

Apple Maps Ads is a reporting integration in BI, beside Meta Ads. It reads a client's Apple Maps campaigns through the official Apple Ads Platform API. It stores them in the client's own database, adds their spend to the monthly rollup, and serves a per-platform report to the client dashboard and to Operations Center.

**Status: built and tested against mock Apple responses only.** No live Apple Ads account has been connected yet, so none of this has run against Apple. It is not operational until the checklist under "Live verification" passes against an authorised account.

It is read only. The client only ever sends GET requests and POSTs to Apple's `/query` endpoints. `AppleAdsClient.query` refuses any other POST, and a test asserts that every recorded Apple request is one of those two. Nothing here can create, change, pause or delete a campaign.

## What Apple's documentation says (checked 24 November 2026)

Sources: [Apple Ads Platform API](https://developer.apple.com/documentation/apple-ads-platform-api), [Advertising Your Business on Apple Maps](https://developer.apple.com/documentation/apple-ads-platform-api/journey-apple-maps-brand-ads), [Implementing OAuth](https://developer.apple.com/documentation/apple-ads-platform-api/implementing-oauth-for-the-apple-ads-platform-api), [Calling the API](https://developer.apple.com/documentation/apple-ads-platform-api/calling-apple-ads-platform-api), [Rate limits](https://developer.apple.com/documentation/apple-ads-platform-api/rate-limits), [Managing Reports](https://developer.apple.com/documentation/apple-ads-platform-api/reports), [Changelog](https://developer.apple.com/documentation/apple-ads-platform-api/changelog-apple-ads-platform-api).

- **Version.** API 1.0 was released in August 2026 at `https://api.ads.apple.com/v1`. It replaces the Campaign Management API v5, which Apple sunsets on 26 January 2027, so nothing here uses v5.
- **Auth.** OAuth2 client credentials.
  - Sign a client secret: an ES256 JWT with `kid` = keyId, `sub` = clientId, `iss` = teamId and `aud` = `https://appleid.apple.com`, expiring within 180 days.
  - Exchange it at `https://appleid.apple.com/auth/oauth2/token` (scope `searchadsorg`) for a one-hour access token.
  - Send the token as `Authorization: Bearer`, plus `X-AP-Context: adAccountId=<id>` on account-scoped calls.
- **Maps, not App Store.**
  - An Apple Maps ad account carries the product feature `BUSINESS_BRAND_MANUAL` and a `BUSINESS_BRAND` delegation (the brand id). An App Store account carries `APPSTORE_APP_MANUAL` and cannot run Maps campaigns.
  - Maps campaigns have `promotedObjectType` `BUSINESS_BRAND`, supply source `MAPS`, and placements `MAPS_SEARCH_RESULTS` and `MAPS_SEARCH_HOME`.
- **Reports.** BI reads only `/v1/reports/business-brands/{campaigns,ads}/query`; `/v1/reports/apps/*` is never called.
  - `groupBy` accepts `locationId`, `supplyPlacement` and `deviceClass`.
  - `DAILY` granularity allows ranges of up to 90 days. A single-day request returns totals only.
  - `timeZone` is `ORTZ` (the account's own timezone) or `UTC`.
  - Pages hold up to 5000 rows.
- **Metrics on Maps reports:**
  - `localSpend`, `impressions`, `taps`, `ttr`, `cpt`, `cpm`
  - `actions`, `firstActions`, and the individual actions `getDirections`, `call`, `tapURL`, `share`, `getTheApp` and `galleryEngagement`, each reported as `{ "tap": n }`, which means "attributed to an ad tap"
  - cost per action and per first action
- **Roles.** These are assigned in the Apple Ads UI, not through the API: `Admin`, `API Account Manager`, `API Account Read Only`, `Limited Access: API Read & Write` and `Limited Access: API Read Only`. Reporting only needs **API Account Read Only**.
- **Rate limits.** Every response carries `RateLimit-Limit`, `RateLimit-Remaining` and `RateLimit-Reset`, and a 429 adds `Retry-After`. Apple's guidance: wait `Retry-After`, double the wait on consecutive 429s up to 16 seconds, and pace before the window runs out. That is what the client does.

### The local-action metrics the spec asked about

| Asked for | What Apple reports | Shown as |
|---|---|---|
| Directions requests | `getDirections` (tap attributed) | Directions |
| Phone calls | `call` (tap attributed) | Calls |
| Website visits | `tapURL`: taps on the website link, not visits | Website taps |
| Place card interactions | No separate metric. The closest are `galleryEngagement`, `share` and `getTheApp` | Each under its own name |
| Other local actions | `actions` = all of the above, `firstActions` = first-time actions | Actions |

These are Apple's counts under Apple's attribution model. They are never added to leads, and BI writes `leads_reported = NULL` for Apple Maps spend. They are also never summed with Meta or Google conversions. Apple Business organic listing insights (Apple Business Connect) are a different product, with no API used here, and are not paid ad results.

## How it fits BI

| Piece | Where |
|---|---|
| API client: secret signing, token, pacing, retries, pagination, sanitised errors | `packages/connectors/src/appleAdsClient.ts` |
| Apple Maps provider and connector | `packages/connectors/src/appleMapsAds.ts` |
| Provider-neutral types, metric helpers, the provider interface for TikTok and Bing | `packages/connectors/src/adPlatform.ts` |
| Idempotent writer for the new tables | `packages/connectors/src/adPlatformWriter.ts` |
| Integration states | `packages/connectors/src/integrationState.ts` |
| Schema | `packages/db/migrations/tenant/0008_ad_platforms.sql` |
| Report | `workers/api/src/adPlatformReport.ts` |
| Routes | `GET /api/tenant/ad-platforms/apple_maps`, `GET /api/service/tenants/:id/ad-platforms/apple_maps`, and integration actions `disable`, `enable` and `disconnect` on both the tenant and service routes |
| Scheduling | The existing sync Worker, `workers/sync/src/index.ts` |
| Mock fixtures (test only) | `packages/connectors/test/fixtures/apple-maps-ads/` |

**Data flow.** Each sync writes a month to date in three places:

- **Daily detail.** `ad_platform_daily` gets three cuts of the same campaigns: by campaign, by location and by placement. Each cut sums to the same total, so the report always takes totals from the campaign cut and shows the other two beside it, never added to it. Without that, a campaign running in three locations would be counted three times.
- **Campaigns and locations.** `ad_platform_campaigns` stores name, status, budget and brand. `ad_platform_locations` stores the location's name and city only.
- **The existing tables**, in USD only:
  - `raw_ad_spend`, channel `Apple Maps`, campaign spend, no leads. It feeds the monthly rollup, `monthly_metrics`, `campaign_metrics`, `agency_rollup` and so Operations Center's existing BI screens.
  - `ad_line_items`, for the per-ad table.

  An account in another currency stays out of the USD totals, and the sync and the report both say so.

`ad_platform_sync_runs` holds 90 days of sync history: running, succeeded, no_campaigns or failed, each with a sanitised error. Nothing token-shaped is ever written to it.

**Schedule.** This is the existing sync Worker:

- **Hourly:** the current month.
- **Nightly:** the current and previous month. This re-read is what picks up actions Apple attributes late.
- **First sync of a new connection:** a backfill of `backfillDays` (default 90, from 1 to 365), oldest month first, rolled up immediately.
- **Manual:** the existing "sync" action, for any month.

A failure in one client, or one integration, is recorded on that integration and the loop continues.

**States.** These are derived, never stored:

- Not connected
- Pending configuration
- Connected
- Syncing
- Successfully synced
- No campaigns found
- Permission required
- Authentication expired
- Synchronization failed
- Reporting disabled

Each has a one-line hint saying what to do next, and integration lists return `state`, `stateLabel` and `stateHint`.

## What the Apple Ads account owner needs to provide

1. **Which clients run Apple Maps ads.** For each one, give the Apple Ads ad account id. If one ad account carries more than one client's brand, also give the brand id for each client.
2. **An Apple Ads API user** on the Apple Ads organization that owns those ad accounts, with the **API Account Read Only** role on each client's Apple Maps ad account. An Apple Ads account administrator invites it under Account Settings > User Management.
3. **From that API user:**
   - A P-256 key pair: `openssl ecparam -genkey -name prime256v1 -noout -out private-key.pem` and `openssl ec -in private-key.pem -pubout -out public-key.pem`.
   - The public key uploaded under Account Settings > API.
   - The **clientId, teamId and keyId** Apple then shows.
   - The **private key**, passed securely and never by email or chat. It is entered once into the BI connection form, which encrypts it with `CRED_MASTER_KEY`.
4. **Confirmation that each account is an Apple Maps account**, with product feature `BUSINESS_BRAND_MANUAL` and the client's brand delegated to it. The connection test checks both and says which is missing.
5. **Any client whose Apple Maps ads run through a channel the Platform API cannot see.** For example, ads bought through an Apple Business account that has no API access, or through a reseller. For those, the officially supported alternative is the reports in the Apple Ads web UI, exported and uploaded as a CSV. BI has no Apple Maps CSV parser yet; it would be a follow-up. Nothing will scrape Apple's UI.

## Connecting a client

From Operations Center, open the client's BI page, then the Data tab, then integrations. A client account admin can do the same through the tenant integrations API (`/api/tenant/integrations/:key/*`). The new BI web app has no integrations screen yet.

1. Add an integration with provider `apple-maps-ads`, using the key `apple-maps`. Enter the clientId, teamId, keyId and private key, and **leave Ad account ID blank**.
2. Run **Test**. Because no account is chosen, the test lists every ad account this API user can see and marks the Apple Maps ones. It never picks one itself.
3. Enter the client's Apple Maps ad account id, plus a brand id if the account carries several clients, and save.
4. Run **Test** again. It checks that the user can see the account, that it is an Apple Maps account, and that the brand is delegated. It notes if the role is broader than read only.
5. The next hourly sync backfills 90 days, or **Sync** a month by hand.

Mapping is explicit: one BI client tenant is one ad account, plus an optional brand. Nothing is matched by business name, and no client name or account id is written in code. Locations are whatever the brand's campaigns target, and the report names them from Apple's location list.

**Disable** stops syncing and keeps the credentials. **Enable**, then Test, resumes. **Disconnect** forgets the credentials and keeps the synced history. All three, plus credential saves, tests, syncs and failed syncs, write audit rows.

## Live verification (needs an authorised account)

Nothing below has been checked against Apple yet:

- [ ] The token exchange accepts the signed secret (JWT claims, form-encoded body).
- [ ] `GET /v1/acls` and `GET /v1/ad-accounts/{id}` return the fields read: `productFeatures`, `delegations`, `timezone`, `currency`.
- [ ] `POST /v1/reports/business-brands/campaigns/query` with `granularity: DAILY` and `timeZone: ORTZ` returns `granularMetrics` per row, for no `groupBy`, `locationId` and `supplyPlacement`.
- [ ] Whether Apple omits a zero action (for example no `call` field) or sends `{ "tap": 0 }`. BI treats an absent action as N/A, not 0. If Apple omits zeros, Actions shows N/A where it should show 0, and `rowsToDaily` should default reported-but-absent actions to 0.
- [ ] `POST /v1/locations/query` filtered by `brandId` is allowed for a read-only role. If it is not, location names fall back to ids and the sync carries on.
- [ ] The ads report's `metadata.campaignId` and `creative.creativeType` are present.
- [ ] Rate-limit headers appear as documented.
- [ ] Spend in BI matches the Apple Ads UI for the same days in the account's timezone.
- [ ] How far back Apple serves Maps report history, which bounds `backfillDays`.

## Deploying

1. Merge. The API and sync Workers deploy through Workers Builds. Check both "Workers Builds" checks, since a merge does not prove a deploy.
2. Migrate tenant databases: `pnpm migrate:tenants`, or Operations Center's per-client migrate. Migration 0008 rebuilds `integrations` the same way 0005 did, and is written to be re-run safely.
3. Until a client is migrated, the new code still works for it:
   - Integration lists show the state fields without `enabled`.
   - The report answers 409 "needs migrating".
   - Apple Maps cannot be connected for that client.

No Worker secrets or bindings are needed. Credentials live per client, encrypted in the client's `integrations` row like Meta's.

## Rolling back

Revert the PR and redeploy both Workers. The 0008 schema can stay: the old code never reads the new tables or the `enabled` column, and the wider provider check is harmless. To remove Apple Maps figures from the combined totals, delete the client's `raw_ad_spend` and `ad_line_items` rows with channel `Apple Maps` and rerun that month's rollup. Do not drop the `ad_platform_*` tables while there is synced history worth keeping.

## Adding TikTok or Microsoft Advertising (Bing) next

1. Implement `AdPlatformProvider` in a new connector file: health check, account list, and a snapshot that maps the platform's rows into `NormalizedCampaign`, `NormalizedDailyMetric` and `NormalizedLocation`. Write it with `writeAdPlatformSnapshot`.
2. Add the platform to `AdPlatformId` and `AD_PLATFORMS`, with its own labels and definitions. TikTok and Bing call clicks "clicks" and have their own conversion definitions. Keep them separate and never sum conversions across platforms.
3. Register the connector, add its provider to `PROVIDERS`, and widen the `integrations.provider` check in one migration that adds both providers at once, so the table is rebuilt only once more.
4. The report route, states, sync history and backfill work unchanged.
