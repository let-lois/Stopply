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
- **Shared packages:** `packages/attribution` (click ID / channel normalization), `packages/connectors` (CSV parsers), `packages/db`.
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
- The API worker additionally has `.github/workflows/deploy-worker.yml`, a GitHub Actions workflow that also runs `wrangler deploy` on push to `main` when `workers/api/**` or root `wrangler.toml` change (plus manual `workflow_dispatch`). This is redundant with the Workers Builds integration above; both exist.
- **Still confirm a deploy actually succeeded before assuming code is live.** The Workers Builds check for `bi-dashboard-api-worker` failed on every push for a stretch during the `stopply.com` migration attempt (wrong account/zone, see above), so a merge to `main` does not by itself guarantee the Worker is running the latest code, check the "Workers Builds" status.
- This gap was the root cause of a prior unexplained HTTP 405 on login: before the routes below existed at all, `wrangler.toml` had zero `[[routes]]`, so requests to `bi.letlois.com/api/*` were never reaching the Worker.

Production domain (from `wrangler.toml` `[[routes]]` and `[vars]`): `bi.letlois.com` (agency host), `*.bi.letlois.com` (tenant subdomains). Single Cloudflare account: **LetLois** (`40d6a92830a7cb75278c823f7f1b19a0`), pinned explicitly via `account_id` in `wrangler.toml`. Do not add routes for a zone that lives in a different Cloudflare account, Worker Routes and bindings (D1/R2/KV) are account-scoped and cannot cross accounts.

---

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
- Do not remove the `bi.letlois.com` routes/vars in `wrangler.toml`, that's the only routing this Worker has.
- Do not add Worker Routes, D1/R2/KV bindings, or an `account_id` for any zone/resource outside the LetLois account (`40d6a92830a7cb75278c823f7f1b19a0`) without confirming that zone/resource actually lives in that account first.
