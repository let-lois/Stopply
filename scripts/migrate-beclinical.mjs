// Be Clinical migration: provisions the tenant zero registry entry (if
// needed), replays its historical CSV exports through the new import
// pipeline, runs rollups for every historical month, and verifies the
// known hand checked numbers.
//
// Usage:
//   API_BASE=https://bi.letlois.com SESSION_COOKIE=... CSRF_TOKEN=... \
//   node scripts/migrate-beclinical.mjs --dir ./beclinical-exports
//
// The export directory is expected to contain files named
//   {sourceKey}.{YYYY-MM}.csv
// for example: ghl-csv.2026-05.csv, meta-csv.2026-05.csv,
// blvd-appointments.2026-05.csv, blvd-line-items.2026-05.csv,
// blvd-clients.all.csv (client records are not month scoped; use any
// month suffix, they upsert by id).
//
// Known May verification: 208 leads, 26 showed, 36403 revenue in month.

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? fallback : process.argv[i + 1];
}

const base = process.env.API_BASE ?? 'http://localhost:8787';
const cookie = process.env.SESSION_COOKIE;
const csrf = process.env.CSRF_TOKEN;
const dir = arg('dir');
const verifyMonth = arg('verify-month', '2026-05');

if (!cookie || !csrf || !dir) {
  console.error('required: SESSION_COOKIE, CSRF_TOKEN env vars and --dir <export directory>');
  process.exit(1);
}

const headers = { 'content-type': 'application/json', cookie, 'x-csrf-token': csrf };

async function post(path, body) {
  const res = await fetch(`${base}${path}`, { method: 'POST', headers, body: JSON.stringify(body) });
  const json = await res.json();
  if (!res.ok) throw new Error(`${path}: ${res.status} ${JSON.stringify(json)}`);
  return json;
}

// 1. Provision (idempotent on slug; resumes if it exists).
console.log('provisioning beclinical tenant (idempotent)');
try {
  const result = await post('/api/agency/tenants', {
    slug: 'beclinical',
    name: 'Be Clinical',
    timezone: 'America/Los_Angeles',
    plan: 'whitelabel',
    adminEmail: process.env.BECLINICAL_ADMIN ?? 'admin@beclinical.com',
    adminName: 'Be Clinical Admin',
    funnelLabels: { lead: 'Leads', scheduled: 'Booked', completed: 'Showed', purchase: 'Purchases' },
  });
  if (result.tempPassword) console.log(`admin temp password (shown once): ${result.tempPassword}`);
} catch (err) {
  console.error(String(err));
  process.exit(1);
}

// 2. Switch agency context into the tenant for the import routes.
const sw = await post('/api/auth/switch-tenant', { tenantId: (await listTenantId()) });
headers['x-csrf-token'] = sw.csrf;
async function listTenantId() {
  const res = await fetch(`${base}/api/agency/tenants`, { headers });
  const json = await res.json();
  const tenant = json.tenants.find((t) => t.slug === 'beclinical');
  if (!tenant) throw new Error('beclinical tenant missing after provisioning');
  return tenant.id;
}

// 3. Replay the CSVs, oldest month first, client records first within a
// month so the identity bridge exists before appointments and sales.
const files = readdirSync(dir)
  .filter((f) => f.endsWith('.csv'))
  .map((f) => {
    const match = f.match(/^([a-z0-9-]+)\.(\d{4}-\d{2}|all)\.csv$/);
    if (!match) {
      console.warn(`skipping unrecognized file name: ${f}`);
      return null;
    }
    return { file: f, sourceKey: match[1], month: match[2] };
  })
  .filter(Boolean)
  .sort((a, b) => {
    if (a.month !== b.month) return a.month.localeCompare(b.month);
    const order = (k) => (k.includes('clients') ? 0 : k.includes('ghl') ? 1 : 2);
    return order(a.sourceKey) - order(b.sourceKey);
  });

const months = new Set();
for (const item of files) {
  const month = item.month === 'all' ? verifyMonth : item.month;
  months.add(month);
  console.log(`importing ${item.file} as ${item.sourceKey} for ${month}`);
  const csv = readFileSync(join(dir, item.file), 'utf8');
  const result = await post('/api/imports', { sourceKey: item.sourceKey, month, csv });
  console.log(`  ${result.rowCount} rows (${result.kind})`);
}

// 4. Re run rollups for every historical month (imports already rolled
// up their own month; this catches cohort spillover between months).
for (const month of [...months].sort()) {
  await post(`/api/tenant/rollup/${month}`, {});
  console.log(`rollup complete for ${month}`);
}

// 5. Verify the known month.
const res = await fetch(`${base}/api/tenant/months/${verifyMonth}?basis=first`, { headers });
const data = await res.json();
const totals = data.channels.reduce(
  (acc, ch) => ({
    leads: acc.leads + ch.leads,
    completed: acc.completed + ch.completed,
    revenue: Math.round((acc.revenue + ch.revenue) * 100) / 100,
  }),
  { leads: 0, completed: 0, revenue: 0 }
);
console.log(`\n${verifyMonth} totals: ${totals.leads} leads, ${totals.completed} showed, $${totals.revenue} revenue`);
if (verifyMonth === '2026-05') {
  const ok = totals.leads === 208 && totals.completed === 26 && Math.abs(totals.revenue - 36403) < 1;
  console.log(ok ? 'MATCH: numbers reproduce the original dashboard' : 'MISMATCH: expected 208 leads, 26 showed, 36403 revenue');
  process.exit(ok ? 0 : 2);
}
