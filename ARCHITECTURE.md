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

## Not yet true

Phase 1 stores nothing on a server and authenticates nobody. In particular:

- The role switcher is a presentation device. There is no authorization.
- Credentials are references only. No code path accepts, stores, transmits,
  or displays a secret value, and none will before the backend exists.
- Nothing is encrypted, and no copy in the interface says otherwise.
