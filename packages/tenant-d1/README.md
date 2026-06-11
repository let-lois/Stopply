# @letlois/tenant-d1

Thin client for the Cloudflare D1 HTTP query API. Used for every tenant
database, since tenant databases are created at runtime and cannot be
bound in wrangler.toml.

## Latency tradeoff versus bindings

A bound D1 database is reached over Cloudflare's internal fabric and a
query typically completes in single digit milliseconds from a Worker.
The HTTP query API used here goes through the public Cloudflare API
(api.cloudflare.com), which adds TLS setup, auth, and routing overhead:
expect roughly 30 to 150 ms per query depending on colo placement.

We accept that cost because hard tenant isolation requires one database
per tenant, and bindings are fixed at deploy time. Mitigations built in:

- batch() groups statements per request loop so rollups do not pay
  per statement round trips in application logic.
- Retries with exponential backoff on 429 and 5xx, capped at 3 retries.
- A 10 second timeout per request.
- The hot read paths (months API) are served from rollup tables, so a
  dashboard render is a handful of queries, not hundreds.

The control plane stays on a bound database (CONTROL_DB) because it is
on every request path (tenant resolution, sessions, audit).

## Usage

```ts
import { TenantD1 } from '@letlois/tenant-d1';

const d1 = new TenantD1({ accountId: env.CF_ACCOUNT_ID, apiToken: env.CF_API_TOKEN });
const { results } = await d1.query(databaseId, 'SELECT * FROM users WHERE email = ?', [email]);
await d1.batch(databaseId, [
  { sql: 'DELETE FROM monthly_metrics WHERE period_month = ?', params: [month] },
  { sql: 'INSERT INTO monthly_metrics (...) VALUES (?, ?, ?)', params: [a, b, c] },
]);
```

Parameterized statements only. Passing objects as params throws. Never
build SQL by string interpolation of values.
