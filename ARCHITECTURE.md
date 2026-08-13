# Stopply platform

Multi-client, multi-module operations platform. React 19 + Vite SPA, deployed
to Cloudflare Pages. Phase 1 is front end only and runs entirely on demo data.

## Two decisions taken at the start

### 1. The prototype was not reachable, so this is a reconstruction

The build spec says to port the demo data values, the module registry copy,
and the visual identity from an existing Google AI Studio prototype. That
prototype was not available to this build. Its repository is not the deployed
platform and was not identifiable in the organisation.

What that changes:

- **Visual identity is reconstructed, not ported.** The spec describes it
  precisely enough to rebuild: dark slate ground, indigo primary, glass
  panels at a 2rem radius with a heavy backdrop blur, uppercase micro-labels
  with wide tracking, and black-weight tabular numerics. That is what
  `src/index.css` implements, as tokens rather than as repeated class strings.
- **Demo data is authored fresh.** The original numbers were described as
  internally consistent and worth keeping; they could not be read. Each
  module's dataset therefore lives in exactly one file under
  `src/lib/data/demo/`, so replacing invented figures with the originals is a
  value swap rather than a rewrite.

If the prototype turns up, the port is a mechanical change to those files and
to the accent and copy values in `src/modules/registry.ts`.

### 2. This is the future front end for the platform that already exists

There is a production system at `let-lois/Stopply` serving real clients:
Next.js on Pages, a Hono Worker, and one D1 database per client. It already
carries a door to door field tracking module, live, with its own schema
(`field_reps`, `field_addresses`, `field_visits`, `field_dispositions`).

The `field-sales` module specified here covers the same domain. Building a
second system that stores the same knocks in a different place would leave two
answers to "where did this rep's day go", which is a worse problem than any
defect in the audit that prompted this rebuild.

So:

- **Phase 1 is standalone and demo only**, exactly as specified. Nothing here
  reads or writes the production platform.
- **Phase 2's `field-sales` live adapter targets the existing schema**, rather
  than defining a new one. `src/lib/data/live/` is where that binding lives,
  and it is the only place that needs to know.
- The other five modules have no production counterpart, so their Phase 2
  adapters are new work against the D1 schema in the build spec.

This costs nothing in Phase 1 and is the difference between one system and
two. Revisit it deliberately if the production platform is being retired,
which would change the answer.

## The four seams

Every one of these replaces a place where the prototype had two sources of
truth that agreed by coincidence.

1. **`src/modules/registry.ts`** is the only place a module's name, icon,
   accent, views, or default view is defined. Nothing hardcodes them.
2. **`useModuleData(moduleId)`** is the only path from a view to data.
   Switching client or data mode is therefore visible on screen by
   construction, not by remembering to wire it.
3. **`src/types/routes.ts`** is the only place a path string is written.
   Navigation is typed; a mistyped route is a compile error.
4. **Selectors** compute every derived number from `visits` and `properties`.
   No KPI is stored, so none can drift from what it summarises.

## Rules enforced by the linter, not by convention

`eslint.config.js` fails the build on each of these. All five were verified to
fire against deliberate violations before any feature code was written.

- No import may use a deep relative path. The `@/` alias exists for this.
- Platform and library code may not import a module's types. The registry and
  the module data map are the two sanctioned exceptions, configured by name.
- A module view may not import a demo dataset. It reads through the seam.
- No route string literal in a `to` prop or a `navigate()` call.
- No unused local or parameter.

## Gates

`npm run verify` runs all four. CI runs them on every push and every pull
request. The prototype's typecheck failed on its main branch for an unknown
length of time because esbuild strips types without resolving them and no CI
ran `tsc`; that is the single most valuable line in the workflow file.

```
npx tsc --noEmit
npx tsc --noEmit -p tsconfig.node.json
npx eslint . --max-warnings 0
npx vitest run
npm run build
```

## The backend

Cloudflare Pages Functions, D1, and Workers Secrets. One function
(`functions/api/[[route]].ts`) dispatches `server/api.ts`, which is the entire
API surface on one screen. Reviewing what is reachable means reading one table
rather than walking a directory of `_middleware.ts` files.

### Where the enforcement is

Every handler starts by resolving the session, then validating the requested
client against that session's scope, then checking entitlement if it serves
module data. Those are the first lines of the handler, not middleware a route
can forget to declare: a handler that skips one has no `session` variable to
use afterwards.

- **Scope comes from the session.** A `client_id` in the URL is a hint checked
  against it, never an instruction. Out of scope answers **404, not 403**,
  because confirming a workspace exists is itself a disclosure.
- **Entitlement is re-checked per request.** `ModuleGuard` in the browser is a
  UX affordance and says so in its own comment. `requireModuleEnabled` is the
  decision, and it reads the same row the invoice is about.
- **The audit trail is the server's.** Server clock, actor from the session,
  address from `CF-Connecting-IP`. The table refuses `UPDATE` and `DELETE` by
  trigger, so append-only is a property rather than a habit. One consequence
  worth knowing: it cannot be pruned, so retention needs a plan before it
  needs one urgently.

### Invariants are constraints

Each was probed with a deliberate violation before being relied on.

- `users` CHECKs that a client-scoped role has a client. That is exactly the
  object the prototype's role switcher produced on every use.
- `territories` CHECKs that its bounds are the right way round.
- Entitlement is the existence of a `client_modules` row, not a boolean, so
  "disabled" and "missing" cannot drift apart.
- `visits.device_visit_id` is UNIQUE, which is the whole offline story.

### Argon2id, and one discarded attempt

workerd refuses runtime WASM compilation: `hash-wasm` and every WASM-backed
Argon2 instantiate lazily inside the first call and fail with *"Wasm code
generation disallowed by embedder"*. Confirmed against `wrangler pages dev`,
not assumed. `@noble/hashes` is pure JavaScript and works, measured at roughly
270ms per hash at OWASP's first recommended parameters. That cost is the
feature, and it is also why login sits behind both Turnstile and a
per-address failure limit: an endpoint that burns a quarter second of CPU per
call is a denial of service vector otherwise.

### Turnstile fails closed

The secret is read through `requireBinding`, which throws. A missing secret is
a 500 on every write, not a silent open door. `if (env.TURNSTILE_SECRET)` is
the shape this avoids, and the spec names it.

`TURNSTILE_VERIFY_URL` moves the verification endpoint **outside production
only** so a sandbox that cannot reach `challenges.cloudflare.com` can still
exercise the signed-in half of the API. It is ignored when `ENVIRONMENT` is
`production`, and a test asserts that. The secret is still required and
`success` must still come back true; only the destination moves.

### The credential store has no read path

`server/crypto/seal.ts` exports `sealSecret` and `last4`, and a test asserts
that those are the only two exports. There is no `open()`, `unseal()`, or
`decrypt()`, and that is not an oversight to be filled in later: §7's
guarantee is cheapest to keep when the code that could break it does not
exist. When an integration eventually needs to spend a credential, the decrypt
belongs next to that outbound call.

## Still not true

- **The Turnstile keys on the deployment are Cloudflare's test pair**, which
  accept any answer. The API token available during the build could not create
  a real widget. The login page says so in visible copy rather than looking
  protected. Replace them in the dashboard, then
  `wrangler pages secret put TURNSTILE_SECRET` and rebuild with
  `VITE_TURNSTILE_SITE_KEY`.
- **WAF rate limiting is not configured.** The per-address login limit in
  `login_attempts` is real and enforced; the dashboard-level rule the spec also
  asks for is a console setting nobody has made yet.
- **Five of six modules have no live source.** Advertising, ecommerce,
  logistics, CRM and analytics reject live mode with "not connected", because
  their data would come from Meta, Google Ads, Shopify, Stripe and a carrier
  API and none of those integrations exists. Each becomes a case in
  `src/lib/data/live/index.ts` when its integration is built, and no view
  changes on that day.
- **A rep cannot sign in yet.** `reps.user_id` exists for it, and `fieldScope`
  style separation between rep and dashboard sessions has not been built here.

## Brand assets

`public/stopply-logo-mark.png` and `stopply-logo-wordmark.png` are the real
brand files, carried over from the production platform rather than traced
from a screenshot.

The square icons (`icon-32`, `icon-180`, `icon-192`, `icon-512`) are generated
from the mark, which is 223x256. They use `fit: contain` onto a transparent
square, so the rounded tile is padded rather than stretched: resizing it to a
square directly would distort the corner radius. To regenerate after a logo
change:

```sh
npm i -D sharp
node -e "const s=require('sharp');for(const n of [32,180,192,512])s('public/stopply-logo-mark.png').resize(n,n,{fit:'contain',background:{r:0,g:0,b:0,alpha:0}}).png().toFile('public/icon-'+n+'.png')"
npm remove sharp
```

sharp is removed again afterwards because the icons are committed and nothing
in the application imports it.

The mark's pink is available as `--color-brand`. It is identity, not
interaction: it belongs to the logo and the occasional deliberate highlight,
never to a button. The interactive accent stays indigo, so a control's colour
continues to mean something.

## Running it

```sh
# Local, against a local D1
npx wrangler d1 execute stopply-platform --local --file migrations/0001_initial.sql
npx wrangler d1 execute stopply-platform --local --file migrations/0002_login_attempts.sql
node scripts/seed.mjs > /tmp/seed.sql
npx wrangler d1 execute stopply-platform --local --file /tmp/seed.sql

node qa/turnstile-stub.mjs &          # this sandbox cannot reach Cloudflare's
npx wrangler pages dev dist --port 8788 &

node qa/api-qa.mjs                    # 35 checks against a real workerd
node qa/manual-qa.mjs                 # 19 browser checks
node qa/login-qa.mjs                  # 10 sign-in checks
```

`.dev.vars` holds the local secrets and is gitignored. Deployed secrets are set
with `wrangler pages secret put` against
`CLOUDFLARE_ACCOUNT_ID=af6cdf4448e16dc7a72f84c3dd7cf7fb`.

The seeded accounts are `admin@letlois.example.invalid` (platform) and
`admin@allstar.example.invalid` (one workspace, which is what proves scoping
restricts rather than merely filters a sidebar). The password comes from
`SEED_PASSWORD` and defaults to a demo value printed by the seed script.
