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

## The canvass map

MapLibre GL, with doors as a GeoJSON source and a circle layer rather than DOM
markers. A real territory is thousands of houses, and thousands of absolutely
positioned elements make panning stutter on the phone a rep is actually
holding; circles render on the GPU and stay smooth into six figures.

What this replaced was honest but was not a map: real coordinates projected
into a fixed box, so pins sat correctly relative to each other and nowhere in
particular otherwise. A rep navigates by streets.

### The basemap is optional, and unset here

`VITE_MAP_STYLE_URL` points at a MapLibre style. Without it the map still pans,
zooms, scales, geolocates and places every door at its true coordinates; it
simply has no streets drawn underneath. The Canvass says so rather than letting
a dark background read as a broken map.

Two ways to set it, and the choice has a running cost attached:

- **Protomaps on R2.** Self-hosted vector tiles. One `.pmtiles` extract for the
  area being canvassed, uploaded to R2, served from the account this already
  deploys to. No per-request bill and no third party in the path, at the cost
  of a one-time setup and re-cutting the extract when the coverage area grows.
- **A hosted provider** (MapTiler, Mapbox). A style URL and a key, working in
  minutes, metered forever.

Protomaps fits this stack better. Nothing in the code depends on which is
chosen: the style URL is the entire integration.

### The worker has to be bundled, not copied

```ts
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';
setWorkerUrl(workerUrl);
```

Both halves of that are load-bearing, and getting either wrong produces the
same silent failure: a map with its source, its layers, the right viewport,
working controls, no console error, and not one door drawn.

MapLibre 6 resolves its worker at runtime from `import.meta.url`, which the
bundler cannot see, so without `setWorkerUrl` the file is never emitted, the
request falls through to the SPA's `index.html`, and every `setData` waits
forever on a worker that will never answer.

And the suffix must be `?worker&url`. Plain `?url` copies the file verbatim,
but the worker imports MapLibre's shared chunk relative to itself, so the copy
resolves that import to a file that was never emitted and fails the same silent
way. `?worker` bundles the dependency in: 18KB emitted is the broken version,
470KB is the working one.

`qa/manual-qa.mjs` guards this by comparing two canvas screenshots, one with
doors and one with none. If nothing is ever drawn the two are identical, which
is what the check reports. Verified by reintroducing the bug: "the canvass
renders a real map" keeps passing and the doors check fails, which is precisely
why the second check exists.

## The rep app

`/field` is its own route tree, its own session provider and its own chunk. A
phone never downloads the dashboard and a desk never downloads this.

### Two populations, two cookies

Reps authenticate against `reps` and never appear in `users`. Their sessions
live in `field_sessions` and carry `stopply_field` rather than
`stopply_session`. The separation is structural: a field token hashes to a row
in `field_sessions`, which joins only to `reps`, and the dashboard's resolver
never touches that table. There is no query that turns a rep's cookie into a
dashboard session.

It matters because one person holds both at once, on the same hostname: a
manager who also knocks. If a phone is lost, the blast radius stops at that
rep's own doors. `qa/field-qa.mjs` checks the wall in both directions.

Scope comes off the session row, so a phone cannot name a workspace, a
territory or a rep. `repId` is optional in the shared schema and the two routes
read it differently: the dashboard requires it, because a manager logging on
someone's behalf has to say whose knock it was, and the field route ignores it
and uses the session.

### The outbox

A knock is written to IndexedDB before anything is attempted, and sent whenever
there is signal. Without it a knock in a stairwell is lost, and a rep who loses
a few knocks stops logging them, which is worse than the knocks.

Retrying is safe because `deviceVisitId` is minted on the device before the
first send and reused on every retry: the server recognises a knock it already
holds and answers 200, so a drain cannot double count a door however often it
runs. That is also why a duplicate must never become a 4xx, which would stop
the queue draining forever.

Three details worth keeping:

- **A refresh overlays the queue.** The server has not heard about unsent
  knocks, so its answer is the old outcome. Without the overlay a rep watches
  their morning undo itself.
- **The queue drains on boot**, not only on the `online` event and the timer. A
  rep who closes the app in a dead zone and reopens it in signal is precisely
  the person checking whether their morning made it, and they would otherwise
  wait a minute to find out.
- **Signing out keeps the queue.** Those knocks belong to the rep who took them
  and send when they sign back in. Clearing it to tidy up would throw away a
  morning.

A 4xx other than 401 drops the knock from the queue, because a door that no
longer exists will be refused identically forever and would block everything
behind it. A 401 is kept: the rep can sign in again and the knock is still good.

### The service worker

`public/field-sw.js`, scoped to `/field`, so the dashboard never passes through
it. One job: make the app open with no signal.

It **never caches `/api`**. Not once, not stale-while-revalidate, not "just the
door list". A stale do-not-knock list means a rep knocks a household that asked
not to be, which is the one mistake this system exists to prevent.

It reads the entry assets out of the HTML at install time rather than listing
hashed filenames it cannot know. Without that the first visit cached the shell
and none of the scripts, because those were requested before the worker took
control, and a reload offline served a document referencing files that were not
there. The app appeared to have offline support and did not. `qa/offline-qa.mjs`
catches that specific failure by cutting the browser's connection for real.

## The funnel

Knocked, contacted, booked, showed, sold. `src/modules/field-sales/funnel.ts`
derives all five from the visit log; nothing is stored pre-aggregated.

**Showed and no-show exist because the gap between booked and sold was
invisible.** Before them, an appointment nobody turned up to and an appointment
that had not happened yet were the same row, and that gap is where this
business leaks. `appointment_kept` and `appointment_missed` split it. They are
offered on the knock sheet only at a door already sitting at
`appointment_set`, because they belong to an appointment rather than to a
knock, and putting them beside the six outcomes a rep taps all day would invite
marking a house "no-show" that never had one.

**A stage is reached once and stays reached.** Counting current dispositions
made the booked total fall every time an appointment went well, because a door
that showed leaves `appointment_set`. The one deliberate exception is the
headline "Sales" count, which is standing rather than cumulative: a sale later
re-dispositioned did happen and the funnel counts the flow, but the card a
manager reads as "we have this many sales" must not include it. The funnel view
says so in words when the two numbers differ, rather than showing whichever is
larger.

**A later stage implies the earlier ones.** A door sold at the kerb with no
appointment counts as booked, timestamped at the same visit. The alternative is
a funnel where a stage is wider than the one above it, which is not a funnel.
`STAGE_RANK` in `funnel.ts` is the whole definition and is written down there.

**Credit follows the visit that first reached each stage.** The setter keeps
their booking when a closer finishes the sale, and the closer is not credited
with a booking they inherited. `passedOn` counts doors one rep booked and
another closed, which is the only place a good setter's contribution is
visible at all.

**Days are cut in the client's timezone**, from `clients.timezone`, via
`src/lib/format/zonedDay.ts`. A knock at 11pm in Riverside is 6am the next day
in UTC, so cutting in UTC makes the crew's Tuesday disagree with the crew's own
Tuesday. The range filter and the daily buckets read the same day-keys, because
when they did not the headline and the chart underneath it disagreed by exactly
the knocks in the overlap.

### Cars on the drive

`visits.vehicle_present` is nullable on purpose and three-valued end to end:
null means the rep did not look, which is not the same as saying there was no
car. The knock sheet starts with neither answer chosen and says out loud what
leaving it alone means. Reporting counts only knocks where a rep said either
way, because folding "did not look" into "no car" would put most of a day in
the no-car row and make the signal look worthless.

### A larger crew

The market is California and the crew is about to grow, so two things changed.

Rep colours come from a hash of the rep's id, not from their position in the
roster. Position meant hiring one rep re-coloured everyone after them, so a
manager who had learned the map found it meaning something else the next day.
Past a full palette collisions are unavoidable and the legend, which names
every rep, is what disambiguates. `repColors.test.ts` is the guard.

The canvass legend lists only the reps whose colour is actually on screen.
Thirty names wrapped to five rows and pushed the map down the page to explain
colours that were not on it.

### Rebuilding a table on D1

Migration `0005` opens with a warning worth repeating here. D1 manages the
connection and **ignores `PRAGMA foreign_keys = OFF`**: it still reports 1. The
first version of that migration rebuilt `properties` before `visits`, so
`DROP TABLE properties` cascaded through `visits.property_id ON DELETE CASCADE`
and deleted every knock in the database before the copy could read them. The
copy then inserted nothing and the migration reported success. Reordering does
not help, because `visits` references `properties` whichever way round they are
rebuilt. The fix is to stage the child rows in a table with no foreign key at
all: `CREATE TABLE AS SELECT` produces one with no constraints, so the cascade
cannot reach it.

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
- **The LetLois team share one temporary password**, `test1234`, which is
  written down in `scripts/seed.mjs` and therefore known to anyone who can read
  this repository. Each account has its own salt, so the stored hashes differ,
  but that does not make the password itself any less shared. Running
  `scripts/import-bi-users.mjs` replaces it with each person's real
  bi.letlois.com hash, after which their existing password works here and this
  one stops mattering.
- **A rep's knock is not on the audit trail.** `audit_log`'s actor is a `users`
  row and a rep is not one. Forcing one in would break the foreign key or
  require making it nullable, weakening the trail for everyone else. The knock
  is its own record, with the rep, both clocks and the device id on it.
- **The app must be opened once with a connection** before it works without
  one, which is what installs the worker and its cache.

## Light and dark

Three settings, Light, Dark and System, in the header on a desktop and in the
account menu and at the foot of the rep app on a phone.

**Dark is the default, not System.** Defaulting to the machine would mean that
the day this shipped, every user on a light laptop opened the tool to an
application they did not recognise and had not asked for. System is one click
away. This is why the CSS scopes the `prefers-color-scheme` block to
`[data-theme='system']` rather than to a bare `:root`.

**Two layers.** `@theme inline` in `src/index.css` maps every Tailwind colour
utility onto a plain CSS variable instead of a literal; `inline` is what makes
that work, because it emits `var(--surface-base)` into the utility rather than
resolving the colour at build time. The palettes then set those variables.
Switching a theme sets one attribute on `<html>` and every colour follows, with
no class churn, no re-render, and no component knowing a theme exists.

Each palette is written once and the theme blocks only alias it. A light colour
written out twice is a light colour that will eventually differ between the
toggle and the OS preference, and nobody would find that by looking.

**`light-dark()` is deliberately not used.** It would collapse each token to one
line, and it landed in browsers in 2024. If a rep's phone does not have it,
every token becomes invalid at once: not a theme bug, a colourless application.
The indirection degrades to dark instead.

**The theme is applied in `main.tsx`, before React.** Doing it in a component
paints the default first and corrects it a frame later, which is a dark flash
on every load for anyone who chose light, and no amount of CSS fixes it once
the decision lives in a component.

### What did not simply invert

- **Fills.** `bg-white/6` was not a colour, it was an instruction to lighten
  what is underneath. Correct on a dark ground, backwards on a light one.
  These are now `--color-fill-subtle` / `-fill` / `-fill-strong` and `--color-well`
  for a recessed input, named for intent rather than mechanism.
- **Accents get *darker* in light, not lighter.** A 0.78 amber that glows on
  slate is invisible on white.
- **`--color-primary` is separate from `--color-accent-indigo`,** same hue and
  different jobs. The accent is used as ink, so on a dark ground it must be
  light; a fill carrying white text must be dark enough for the white. One
  token cannot be both, and trying made the primary button's own label fail at
  3.8:1.
- **The map's rim does not flip.** `halo` and `label` are read against the
  ground and invert; `rim` outlines a coloured mark so two pastels do not merge,
  and a dark outline does that on either basemap. Flipping it put a pale ring
  around a pale tack on pale streets.
- **One disposition colour genuinely breaks.** `do_not_knock` is near-white so
  that it stands apart from every hue, which is invisible on a light basemap.
  `dispositionHexFor()` overrides that one and two others, as a partial map: the
  other seven are mid-tone hues that read on both, and duplicating them would
  only create seven more chances to drift.
- **Recharts colours its legend labels with the series colour.** An amber word
  on a white card is 2:1. The label is now ink and the swatch beside it carries
  the colour.

### The map restyles rather than rebuilds

`map.setStyle()`, not a new `MapLibreMap`. A rebuild throws away wherever the
reader had panned to, which on a city of doors means finding their street again
every time they touch the toggle.

The cost is that `setStyle` drops every source, layer and image the application
added, because none of them are in the new style. So the `style.load` handler is
registered with `on` rather than `once` and rebuilds them, and the last data
application is held in a ref and replayed. Event handlers are bound once behind
a flag: re-binding them alongside the layers would stack a second click handler
on every theme change, and a door would report being tapped twice.

### Contrast is measured, not eyeballed

`qa/theme-qa.mjs` walks nine dashboard views and the rep app in both themes and
computes the WCAG ratio of every text node against what is actually painted
behind it, plus a check for marks painted the same colour as their background.

Two things that harness got wrong first, both worth knowing:

- **The palette is oklch, and `getComputedStyle` returns it verbatim.** Pulling
  the numbers out with a regex reads lightness as red and hue as blue. The first
  version reported every element in both themes at 1:1, which is not a contrast
  failure, it is a measurement failure. Colours are now resolved by painting
  them on a 1x1 canvas, which composites translucency for free.
- **Text sits on its own element's background,** not its parent's. Measuring a
  filled button's label against the page behind the button reported white on
  white.

Once it measured correctly it found twenty-one distinct failures in the **dark**
theme, which had been there since long before any of this: `--ink-faint` at 3.8:1
on fourteen elements, three accents used as text on their own tint, and the
primary button's own label. Those tokens moved. Both themes now pass at 4.5:1
for small text and 3:1 for large.

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
node qa/manual-qa.mjs                 # 24 browser checks
node qa/login-qa.mjs                  # 10 sign-in checks
node qa/theme-qa.mjs                  # 16 checks, both themes, contrast measured
```

`.dev.vars` holds the local secrets and is gitignored. Deployed secrets are set
with `wrangler pages secret put` against
`CLOUDFLARE_ACCOUNT_ID=af6cdf4448e16dc7a72f84c3dd7cf7fb`.

### Deploying, and the order it has to happen in

```sh
npm run verify                        # typecheck, lint, tests, build
npx wrangler pages deploy dist --project-name stopply-platform --branch main
```

**`--branch main` is not optional.** Without it, wrangler infers the current
git branch and the deploy lands as a Preview. It reports success and gives you
a URL that works, so nothing looks wrong, and `stopply-platform.pages.dev`
keeps serving whatever was there before. Check with
`wrangler pages deployment list` that the top row says Production.

**There is one database, and every deployment shares it.** So a change that
widens what the database may contain has to reach the browser *before* it
reaches the data, not after. Adding `appointment_kept` and then seeding rows
with it, while production still ran the build before that, gave every page on
production "That data could not be loaded": the old contract correctly refused
a value it had never heard of. The contract was not the bug. The order was.

The rule, in order:

1. Deploy the frontend that understands the new value, to production.
2. Apply the migration.
3. Write the new values.

A tab left open across step 1 is still running the old contract and will show
the same error until it is reloaded, which is why `ApiContractError` says so.

Two sets of accounts are seeded.

The demo pair, `admin@letlois.example.invalid` (platform-wide) and
`admin@allstar.example.invalid` (one workspace, which is what proves scoping
restricts rather than merely filters a sidebar). Their password comes from
`SEED_PASSWORD`.

And the real LetLois team, carried over from the bi.letlois.com team page with
the same roles: four platform admins, plus Roh scoped to Allstar alone. Their
temporary password comes from `TEAM_PASSWORD` and defaults to `test1234`. See
"Still not true" above.

### Carrying passwords over from bi.letlois.com

A hash cannot be converted between algorithms, so the only way somebody's
existing password can work here is for this server to verify the old format.
It does: `verifyPassword` accepts `pbkdf2$iterations$salt$hash`, which is what
that platform stores, and login re-hashes with Argon2id the first time a
legacy hash verifies. Nobody has to do anything, and the upgrade happens at
the one moment in an account's life when the plaintext is in hand.

The export has to be run by someone with access to the LetLois Cloudflare
account, because the two platforms live in different accounts and neither can
read the other's database:

```sh
npx wrangler d1 execute letlois-bi-control --remote --json \
  --command "SELECT id, email, name, role, password_hash, assigned_tenants_json, active FROM agency_users" \
  > bi-users.json

node scripts/import-bi-users.mjs < bi-users.json > import.sql
npx wrangler d1 execute stopply-platform --remote --file import.sql
```

The tradeoff is the point rather than a side effect: two systems accepting the
same credential means a password compromised on one is compromised on both.
Dropping `password_hash` from the export gives you the accounts without that.
