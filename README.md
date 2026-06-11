# LetLois BI

White label, multi tenant business intelligence for marketing
attribution. Served from bi.letlois.com with per client custom domains
(bi.clientname.com). Cloudflare end to end: Next.js on Pages, Hono API
Worker, D1, R2, KV, cron triggers.

## Architecture: two planes

```
                       bi.letlois.com          bi.clientname.com
                            |                        |
                  +---------v------------------------v---------+
                  |        letlois-bi-api (Hono Worker)        |
                  |  tenant resolution by hostname, auth, CSRF |
                  +---------+------------------------+---------+
                            |                        |
              CONTROL PLANE |                        | TENANT PLANE
        (bound D1: CONTROL_DB)              (one D1 database per tenant,
                            |                via the D1 HTTP query API)
   tenants registry, agency users,        users, sources, events (immutable),
   tenant directory, audit log,           contacts, touchpoints, stage_events,
   help articles, agency rollup,          integrations vault, raw_ad_spend,
   chat tool log, custom hostnames        rollup tables, targets, settings

                  +--------------------------------------------+
                  |       letlois-bi-sync (cron Worker)        |
                  |  hourly incremental sync, nightly full     |
                  |  re sync, rollups, agency rollup pull,     |
                  |  R2 backups with 30 day retention          |
                  +--------------------------------------------+
```

Hard tenant isolation: one D1 database per tenant, created at provision
time. No query path can reach another tenant's database because the
tenant is always resolved server side from the request hostname or the
session, never from anything a client sends. The latency tradeoff of
the HTTP query API versus bindings is documented in
`packages/tenant-d1/README.md`.

## Repository layout

```
apps/web                 Next.js app router (static export), Cloudflare Pages
workers/api              Hono Worker: auth, tenant resolution, all API routes, ingest, chat
workers/sync             Cron Worker: integration syncs, rollups, agency pull, backups
packages/db              control plane schema, tenant schema template, migrations, shared types
packages/attribution     pure functions: identity resolution, touch attribution, rollups
packages/tenant-d1       thin client for the D1 HTTP query API
packages/connectors      Boulevard, Housecall Pro, Jobber connectors + CSV parser registry
scripts                  migrations, seeding, provisioning, Be Clinical migration
wrangler.toml            API Worker bindings (CONTROL_DB, ASSETS, CSV_BUCKET, SESSIONS)
```

## Setup

### 1. Create the Cloudflare resources

```sh
wrangler d1 create letlois-bi-control          # paste the id into both wrangler.toml files
wrangler r2 bucket create letlois-bi-assets
wrangler r2 bucket create letlois-bi-csv
wrangler kv namespace create SESSIONS          # paste the id into both wrangler.toml files
```

### 2. Secrets

Set on both Workers with `wrangler secret put NAME` (and
`--config workers/sync/wrangler.toml` for the sync Worker). Never in
code or wrangler.toml.

| Secret | Purpose |
|---|---|
| `CF_API_TOKEN` | scoped token: D1 edit + Custom Hostnames edit |
| `CF_ACCOUNT_ID` | account id for the D1 REST and HTTP query APIs |
| `CF_ZONE_ID` | zone id for Custom Hostnames (API Worker only) |
| `CRED_MASTER_KEY` | 32 bytes base64, integration credential vault (AES-GCM) |
| `ANTHROPIC_API_KEY` | the chat assistant (API Worker only) |
| `INGEST_PEPPER` | IP hashing and webhook signing secret derivation |

Generate a master key: `openssl rand -base64 32`.

### 3. Migrations and seed

```sh
pnpm install
pnpm migrate:control                # applies packages/db/migrations/control via wrangler
CONTROL_DB_ID=... CF_API_TOKEN=... CF_ACCOUNT_ID=... pnpm seed
# prints the first agency_admin temp password once, and seeds the ten help articles
```

Tenant migrations roll forward across every tenant database and bump
each registry row's `schema_version`:

```sh
CONTROL_DB_ID=... CF_API_TOKEN=... CF_ACCOUNT_ID=... pnpm migrate:tenants
```

After editing any `.sql` migration, regenerate the TypeScript mirror:
`node scripts/gen-sql.mjs`.

### 4. Deploy

```sh
# API Worker (routes /api/*, /ingest/*, /t.js on every dashboard hostname)
wrangler deploy --config wrangler.toml

# Sync Worker (cron)
wrangler deploy --config workers/sync/wrangler.toml

# Web app to Cloudflare Pages
pnpm --filter web build
wrangler pages deploy apps/web/out --project-name letlois-bi
```

Routing: attach the API Worker to `bi.letlois.com/api/*`,
`bi.letlois.com/ingest/*`, `bi.letlois.com/t.js`, `bi.letlois.com/t/*`,
and the same paths on `*.bi.letlois.com` plus the custom hostname
fallback origin. Pages serves everything else.

### Custom hostname prerequisites (Cloudflare for SaaS)

1. Enable Cloudflare for SaaS on the zone and set the **fallback
   origin** to the Pages deployment (the host that serves the app
   shell). Custom hostnames CNAME to `bi.letlois.com`.
2. The `CF_API_TOKEN` needs the Custom Hostnames edit permission on the
   zone.
3. The self serve flow in Data and Team, Settings creates the custom
   hostname, shows the CNAME target and any TXT ownership record, polls
   status (pending validation, pending ssl, active), and activates
   routing automatically when active because the tenant resolver reads
   `tenants.custom_hostname`. Gated to the whitelabel plan.

## Provisioning a tenant

From the agency UI (New client) or the CLI:

```sh
API_BASE=https://bi.letlois.com SESSION_COOKIE='lbi_session=...' CSRF_TOKEN=... \
pnpm provision:tenant -- --slug acme --name "Acme Plumbing" \
  --admin-email owner@acme.com --admin-name "Pat Owner" \
  --timezone America/Phoenix --plan starter
```

Provisioning creates the tenant D1 database via the REST API, applies
all tenant migrations, writes the registry row, seeds default sources,
funnel labels, theme, and layout, and creates the first account_admin
with a temp password returned exactly once. Idempotent on slug: a
retry resumes rather than duplicating.

## Be Clinical migration (tenant zero)

```sh
API_BASE=... SESSION_COOKIE=... CSRF_TOKEN=... \
node scripts/migrate-beclinical.mjs --dir ./beclinical-exports
```

Replays the historical CSVs through the new pipeline (clients first,
then contacts, then appointments and line items), runs rollups for
every historical month, and verifies the known May numbers: 208 leads,
26 showed, 36403 revenue in month. The same numbers are locked in CI by
`workers/api/test/beclinical-may.test.ts`.

## Connector credential guides

| Provider | Auth | Plan requirement | Where to get credentials |
|---|---|---|---|
| Boulevard | API key + business id | Admin API enabled | Manage Business, Integrations, API |
| Housecall Pro | API key | MAX plan or API add on | Settings, API access |
| Jobber | OAuth 2.0 | Connect or Grow plan | Connect with Jobber button (developer app) |

Credentials are encrypted with AES-GCM into the tenant database and are
write only: no API response ever includes them. Test connection
distinguishes bad credentials from insufficient plan and stores the
plan check so the UI can say "your plan supports this" or "upgrade
needed". A broken integration flips to error, flags its source red, and
the client reconnects from the Integrations hub without LetLois
touching it.

## Development

```sh
pnpm dev          # wrangler dev (API) + next dev (web) in parallel
pnpm test         # vitest across attribution, connectors, and the API worker
pnpm build        # all packages
```

localhost acts as the agency host in development. The API tests run
ingest, imports, rollups, chat tools, and the penetration checklist
against an in memory SQLite database executing the real tenant
migrations.

## Performance notes

The web app is a static export: no server rendering, fonts preloaded
from Google Fonts, all data fetched from the same origin Worker. The
Performance tab renders skeletons while months load, lazy loads
campaign rows and the leads drawer, and sticks to system level CSS
(no runtime styling library). Run Lighthouse against a seeded tenant
before launch and budget for: LCP under 2.5s on mobile, no horizontal
scroll, 44px touch targets (enforced globally in `globals.css`).

## Out of scope in v1 (stubbed or omitted cleanly)

Stripe billing (the plan field exists, nothing charges), email report
scheduling (commented cron stub in `workers/sync/src/index.ts`),
multi touch weighted attribution models (the touchpoints table already
stores full ordered history so models are additive later), the GitHub
PR code change flow (disabled `propose_code_change` stub in
`workers/api/src/chat/tools.ts`), SSO, mobile apps.
