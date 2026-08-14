# CLAUDE.md

This file is loaded automatically at the start of every Claude Code session in this repo. It is the permanent memory for this project. The conversation (session) holds the active thread of work; this file holds the stable facts that must survive across every session.

---

## Project overview

This is the LetLois multi-tenant BI dashboard (`bi.letlois.com`). It tracks lead attribution and funnel metrics across LetLois clients (Be Clinical, Blue Cactus, Back Nine East Mesa, TXD Roofing).

**A migration to a `stopply.com` domain was attempted and abandoned.** `stopply.com`'s Cloudflare zone lives in a separate Cloudflare account ("All LetLois Domains", `af6cdf4448e16dc7a72f84c3dd7cf7fb`) from the one this Worker and its D1/R2/KV bindings live in ("LetLois", `40d6a92830a7cb75278c823f7f1b19a0`). Cloudflare Worker Routes and bindings are account-scoped, a Worker can't attach a route to a zone in a different account, so the two-domain setup could never deploy cleanly. Decision: stay on `bi.letlois.com` in the LetLois account. Don't reintroduce `stopply.com` routes/vars/cookie-domain without first getting `stopply.com`'s zone moved into the LetLois account.

- Repo: GitHub (`let-lois/business-intelligence-dashboard`)
- Hosting: Cloudflare Pages (frontend) + a separate Cloudflare Worker (API) — see "Build and deploy" below, the two do not deploy the same way.
- Primary tool: Claude Code (desktop app)

---

## Tech stack

- **Monorepo:** pnpm workspaces (`pnpm-workspace.yaml`) — packages under `apps/*`, `workers/*`, `packages/*`.
- **Frontend (`apps/web`):** Next.js, static export (`output: 'export'`, `images: { unoptimized: true }`). Build output: `apps/web/out/`.
- **API (`workers/api`):** Cloudflare Worker (Hono), bindings defined in root `wrangler.toml`: D1 (`CONTROL_DB`), R2 (`ASSETS`, `CSV_BUCKET`), KV (`SESSIONS`). Secrets (`CF_API_TOKEN`, `CRED_MASTER_KEY`, `ANTHROPIC_API_KEY`, `INGEST_PEPPER`, etc.) are set via `wrangler secret put` and never committed.
- **Other workers:** `workers/sync` (own `wrangler.toml`).
- **Shared packages:** `packages/attribution` (click ID / channel normalization), `packages/connectors` (CSV parsers), `packages/db`, `packages/field` (door to door address normalization, disposition semantics, field reporting aggregation).
- The static frontend calls the API client-side; there is no server-side rendering at request time.

---

## Local development

```bash
pnpm install               # first time / after dependency changes, from repo root
pnpm dev                   # runs API + web dev servers in parallel (root script)
pnpm build                 # builds all packages (root script: pnpm -r build)
pnpm test                  # runs all package test suites

# Frontend only, from apps/web/:
next dev
next build
```

---

## Build and deploy (READ THIS BEFORE PUSHING)

**Frontend (`apps/web`):**
- Hosted on Cloudflare Pages, connected to this GitHub repo for automatic builds (build command `pnpm build` / `next build`, output directory `out` — configured in the Cloudflare dashboard, not in code).
- **Production branch:** `main`. Push/merge to `main` → Cloudflare Pages builds and deploys to production.
- Push to any other branch / open a PR → Cloudflare Pages builds a preview deployment.

**API (`workers/api`) and `workers/sync`:**
- Both workers have a **native Cloudflare Workers Builds Git integration** (configured in the Cloudflare dashboard, not in this repo) that auto-builds and deploys on every push, this does not show up as a GitHub Actions workflow, look for "Workers Builds: bi-dashboard-api-worker" / "Workers Builds: bi-dashboard-sync-worker" checks on a PR or commit to see it.
- **Still confirm a deploy actually succeeded before assuming code is live.** The Workers Builds check for `bi-dashboard-api-worker` failed on every push for a stretch during the `stopply.com` migration attempt (wrong account/zone, see above), so a merge to `main` does not by itself guarantee the Worker is running the latest code, check the "Workers Builds" status.
- This gap was the root cause of a prior unexplained HTTP 405 on login: before the routes below existed at all, `wrangler.toml` had zero `[[routes]]`, so requests to `bi.letlois.com/api/*` were never reaching the Worker.

Production domain (from `wrangler.toml` `[[routes]]` and `[vars]`): `bi.letlois.com` (agency host), `*.bi.letlois.com` (tenant subdomains). Single Cloudflare account: **LetLois** (`40d6a92830a7cb75278c823f7f1b19a0`), pinned explicitly via `account_id` in `wrangler.toml`. Do not add routes for a zone that lives in a different Cloudflare account, Worker Routes and bindings (D1/R2/KV) are account-scoped and cannot cross accounts.

---

## Door to door field tracking (All Star)

Built for the All Star engagement: a field app reps use at the door, plus the reporting the client reads. See "Door to door field tracking" in `README.md` for the full picture. The facts that must survive a session:

- **Two populations, two cookies.** Reps live in the tenant's `field_reps` table, never in `users`, and carry `lbi_field`; dashboard users carry `lbi_session`. `contextMiddleware` refuses to load a field session into `c.get('session')`, `tenantScope` explicitly rejects any user type that is neither `tenant` nor `agency`, and `fieldScope` guards `/api/field/*`. **Do not** collapse these into one session or one cookie: an account admin holds both at once on the same hostname, and the separation is what keeps a leaked rep credential away from client reporting.
- **`field_visits.client_uuid` is minted on the phone and is UNIQUE.** That index is the entire offline story. A resend of an already recorded visit answers **200 with `duplicate: true`, not an error**, so the app's outbox can retry forever without double counting a knock. Never change a duplicate to a 4xx, and never generate the id server side.
- **`occurred_at` is the phone's clock at the door; `recorded_at` is the server's.** Reporting uses `occurred_at`, so a knock uploaded hours later stays on the day it happened. Don't "fix" a backdated visit to arrival time.
- **Reporting windows are cut in the tenant's timezone**, via `zonedDayRangeUtc` in `packages/field`. The SQL filter and the daily buckets must use the same cut, or the headline totals disagree with the chart underneath them. This was a real bug, caught by `workers/api/test/field-admin.test.ts`.
- **The funnel reads disposition flags, not keys.** `is_contact` / `is_lead` / `is_appointment` / `is_sale` on `field_dispositions` are what reporting aggregates on, so a client can rename or add outcomes without losing a stage. Don't hard code `'sale'` anywhere in reporting.
- **`do_not_knock` on an address is sticky and never rolls back**, whatever order out of order offline uploads land in.
- Migration `packages/db/migrations/tenant/0006_field_tracking.sql` seeds the default outcome catalog into **every** tenant database with `INSERT OR IGNORE`. The tables stay inert for a client with no reps, so there is no enable step. The Door to Door dashboard section only renders once the roster is non-empty; the roster itself lives in Data and Team so the first rep can always be added.
- **Sample data is flagged, not guessed.** `is_sample` on `field_reps` / `field_addresses` / `field_visits` (migration `0007`) is what "Remove sample data" matches on, and the only thing it matches on. Never delete demo activity by date range or name pattern: that deletes a rep's real day. The dashboard labels any window containing sample rows, because a client reading fabricated numbers as their own is the one harm this feature can do.
- **A client's dashboard sections are configurable** via `tenants.sections_json` (control migration `0005`, `parseSections` in `packages/db`). NULL means the historical ads dashboard, so existing clients are unchanged. All Star is door to door only: no spend, channels, Meta or Google, because they run no ads. Data and Team is always reachable regardless, since that is where the setting lives.
- **Agency admins can apply tenant migrations from the console** (`POST /api/agency/tenants/:id/migrate`). Schema ships with a deploy but only reaches a tenant database when migrations run, and that gap is what left a client staring at "internal error" for a live feature. The CLI (`pnpm migrate:tenants`) still works and does the same thing.
- The field app is a separate static route (`apps/web/src/app/field/`) with its own service worker (`apps/web/public/field-sw.js`). The worker caches the app shell only and **never** `/api` responses: a stale do-not-knock list is worse than none.

## The standalone field app (App Store / Play Store)

All Star's reps also get the field app as a real installable app, built with Capacitor in `apps/field-app`. See `apps/field-app/README.md` and `docs/field-app-release.md`.

- **One copy of the screens, two shells.** Everything a rep sees lives in `packages/field-ui`; `apps/web`'s `/field` route and `apps/field-app` both mount `<FieldApp />`. Do **not** fix a bug in one shell: there is only one place to fix it. What legitimately differs between them is declared through `configureFieldPlatform` (`packages/field-ui/src/platform.ts`) and nowhere else.
- **`packages/field-ui/src/field.css` does not define its own palette.** It reads tokens the host supplies: `globals.css` on the web, `apps/field-app/src/app.css` in the app. A new token means adding it in both, or the app renders it as nothing.
- **The web `/field` route stays.** It is how a rep works before the app is approved and on a phone that cannot install it. Do not remove it in favour of the store build.
- **The app still gets its tenant from the hostname.** It talks to `all-star.bi.letlois.com` and sends no client id, so `fieldScope` and "tenant comes from the host, never from the client" are untouched. Never add a tenant/slug parameter to `/api/field/*` to make a native client work.
- **Bearer tokens are field only, and app origins only.** `/api/field/*` accepts `Authorization: Bearer` because a WebView origin cannot be sent a cookie. The login token is returned only to an app origin (`isAppOrigin` in `workers/api/src/cors.ts`), the cookie wins when both are present, and CSRF is skipped only for bearer requests, because that token is not a credential the browser attaches on its own. Do not extend bearer auth to `/api/tenant/*` or `/api/agency/*`, and do not set `Access-Control-Allow-Credentials` anywhere.
- **Field sessions slide, dashboard sessions do not.** `renewSession` pushes a bearer field session's expiry out on every `/api/field/me`, because being signed out mid shift at a door with no signal is this app's worst failure. `/me` rechecks `active` on every call, which is the kill switch. Do not give the dashboard the same treatment.
- **The offline queue is mirrored to native storage.** Clearing an Android app's cache takes `localStorage` with it, and the queue is a rep's unsent day. `restoreOutboxBackup` only ever restores into an empty queue, so it can never overwrite newer knocks; the server's `client_uuid` dedupe makes a re-sent knock harmless. Do not make the restore merge or overwrite.
- **`resources/mark.svg` is the only artwork source.** `pnpm --filter @letlois/all-star-field-app icons` regenerates every icon and splash in both native projects. Never hand-edit a PNG under `ios/` or `android/`.
- **`cap sync` after every web change**, or the phone runs the previous build inside the new version number. `version:set` writes the version into `package.json`, `build.gradle` and the Xcode project together; never edit those two by hand.
- **An API change reaches every phone immediately; an app change does not.** Reps update on their own schedule, so do not remove or reshape a `/api/field/*` response without checking what an older installed build does with it.
- **`/prototypes` lists the apps in build**, driven by `apps/web/src/lib/prototypes.ts`. Adding an app is one entry there. Keep its `blockers` honest: the page is only worth having if you can look at it and know what is actually left.
- **The test site is `/field-preview` on the dashboard**, with `/field-demo` as the app it frames. All three are static routes in `apps/web`, so every branch push gets a Cloudflare Pages preview URL (project `stopply-platform`). They run the real screens against `@letlois/field-ui/demo`, which replaces the network only. Never let the demo module into `apps/field-app/src`: `test/identity.test.ts` fails if it does.
- **`/field-preview` never navigates its frame twice.** A Next static export page mounts once per browsing context, so a reload or a keyed remount leaves an empty document. Changing device resizes the frame and the app reflows; Restart is `__fieldDemo.restart()`, which remounts in place. Do not "fix" it by reloading the iframe.
- **Links into `/field-preview` must open a new tab.** Reaching it by a same tab link from another dashboard page leaves the framed app unhydrated and blank, which is the same Next constraint as above seen from the other side. The `/prototypes` cards carry `target="_blank"` for that reason, not as a preference.

## Code conventions

- **Never use em dashes** in any copy, content, comments, or UI text. Use periods, commas, or rewrite the sentence.
- **Click IDs:** the canonical internal field name is `clickId` (camelCase). Inbound GHL webhook/CSV payloads spell this inconsistently (`clickld` with a lowercase L, `clickid`, `Click Id`, etc.) — `readClickId()` in `packages/attribution/src/channels.ts` normalizes all of these on ingest. Use `clickId` in code; don't rename it to match an external spelling.
- **Static export constraints:** no server-side rendering at request time, no Next.js API routes that need a Node server, no `next/image` optimization (images are `unoptimized`). Live data comes from the Worker/API called client-side.
- **PBKDF2 in Cloudflare Workers/Pages is capped at 100,000 iterations.** `workers/api/src/crypto.ts` uses exactly this cap. Any password hashing must use iterations <= 100,000, and the stored hash and the verify step must use the same iteration count.
- There is no `siteConfig.ts` (or equivalent single shared config file) in this repo currently. If one gets added, update this section — until then, don't assume it exists.

---

## Git workflow

- Small, focused commits with clear messages.
- **Feature branch + PR into `main`.** This is what every merged PR in this repo's history (#4 through #13) has actually done — work happens on a `claude/...`-style feature branch (or an intermediate long-lived branch when stacking related work), then a PR is opened into `main` and merged. Don't commit directly to `main`.
- Merging to `main` triggers a Cloudflare Pages deploy of the frontend (see "Build and deploy"), but does **not** deploy either Worker — factor that into any PR that touches `workers/`.
- Keep working on the same branch across the session. Switching git branches does not require a new Claude Code session.

---

## Do not

- Do not add em dashes anywhere.
- Do not rename the internal `clickId` field to match an external payload spelling like `clickld`.
- Do not introduce server-only Next.js features that break static export.
- Do not exceed 100,000 PBKDF2 iterations in Worker/Pages code.
- Do not assume a push to `main` actually deployed the API or sync worker without checking, Workers Builds auto-deploys but can fail silently (see "Build and deploy").
- Do not commit directly to `main`; use a feature branch and a PR.
- Do not let a field rep's session reach any `/api/tenant/*` route, and do not merge the field and dashboard session cookies.
- Do not make a duplicate field visit an error response, and do not mint `client_uuid` server side; both break offline retry.
- Do not remove the `bi.letlois.com` routes/vars in `wrangler.toml`, that's the only routing this Worker has.
- Do not add Worker Routes, D1/R2/KV bindings, or an `account_id` for any zone/resource outside the LetLois account (`40d6a92830a7cb75278c823f7f1b19a0`) without confirming that zone/resource actually lives in that account first.
