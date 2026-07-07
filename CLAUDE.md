# CLAUDE.md

This file is loaded automatically at the start of every Claude Code session in this repo. It is the permanent memory for this project. The conversation (session) holds the active thread of work; this file holds the stable facts that must survive across every session.

---

## Project overview

This is the LetLois multi-tenant BI dashboard (bi.letlois.com). It tracks lead attribution and funnel metrics across LetLois clients (Be Clinical, Blue Cactus, Back Nine East Mesa, TXD Roofing).

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

Deployment is **not** uniformly automatic — the frontend and the API worker deploy differently. There is no GitHub Actions workflow in `.github/` for either.

**Frontend (`apps/web`):**
- Hosted on Cloudflare Pages, connected to this GitHub repo for automatic builds (build command `pnpm build` / `next build`, output directory `out` — configured in the Cloudflare dashboard, not in code).
- **Production branch:** `main`. Push/merge to `main` → Cloudflare Pages builds and deploys to production.
- Push to any other branch / open a PR → Cloudflare Pages builds a preview deployment.
- This part matches "push and it deploys."

**API (`workers/api`) and `workers/sync`:**
- These are Cloudflare Workers, not part of the Pages build. There is currently **no CI step that deploys them.**
- A change to `workers/api/**` or `workers/sync/**` does **not** go live on push — it requires someone to run `wrangler deploy` manually from a machine with Cloudflare credentials.
- **Do not assume the API is up to date just because code was pushed to `main`.** If you change worker code and the change needs to be live, say so explicitly and confirm whether a manual `wrangler deploy` happened — do not silently assume it did.
- This gap is a known source of confusion: a prior session hit an unexplained HTTP 405 on login after a merge, and it was never confirmed whether the worker had actually been redeployed with the current code.

Production domains (from `wrangler.toml` vars): `bi.letlois.com` (agency host), `*.bi.letlois.com` (tenant subdomains).

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
- Do not assume pushing to `main` deployed the API or sync worker — those need a manual `wrangler deploy`.
- Do not commit directly to `main`; use a feature branch and a PR.
