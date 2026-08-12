// Seeds a tenant with mock CSV imports so its dashboard is populated for
// prototype review. Goes through the real API and the real parsers, so
// what lands is shaped exactly like a genuine import: same sources, same
// rollup, same freshness handling. Nothing is written to the database
// directly.
//
// THIS WRITES FABRICATED NUMBERS INTO A LIVE TENANT. Only run it against
// tenants with no real customer behind them. Every contact, campaign and
// sale below is invented. Remove the imports before a tenant is handed to
// anyone who would read its dashboard as fact.
//
// Usage:
//   API_BASE=https://bi.letlois.com \
//   SESSION_COOKIE='lbi_session=...' CSRF_TOKEN='...' \
//   pnpm seed:mock -- --all
//
//   ...or one client, and/or a specific shape and months:
//   pnpm seed:mock -- --slug allstar --profile ads --months 2026-06,2026-07
//
// Profiles:
//   ads  (default) paid media funnel: Meta + Google spend, GHL leads,
//        appointments booked and completed, sales with revenue.
//   d2d  door to door, the shape Rogue Solar has: knocks, pitches,
//        appointments, sits and closes, which also fills the setter and
//        closer leaderboard.
//
// Re-running the same slug and month re-imports rather than replacing, so
// counts add up on each pass. Seed once, or vary --months.

import {
  rng,
  metaCampaignCsv,
  googleCampaignCsv,
  ghlContactsCsv,
  appointmentsCsv,
  salesCsv,
  d2dAccountsCsv,
} from './lib/mock-csv.mjs';

const base = process.env.API_BASE ?? 'http://localhost:8787';
let cookie = process.env.SESSION_COOKIE;
let csrf = process.env.CSRF_TOKEN;

if (!cookie || !csrf) {
  console.error('set SESSION_COOKIE and CSRF_TOKEN (sign in as agency_admin first)');
  process.exit(1);
}

function arg(name, fallback = undefined) {
  const i = process.argv.indexOf(`--${name}`);
  if (i === -1) return fallback;
  return process.argv[i + 1];
}
const flag = (name) => process.argv.includes(`--${name}`);

const onlySlug = arg('slug');
const profileArg = arg('profile');
const months = (arg('months') ?? '2026-06,2026-07').split(',').map((m) => m.trim()).filter(Boolean);

if (!onlySlug && !flag('all')) {
  console.error('pass --slug <slug> or --all');
  process.exit(1);
}
for (const m of months) {
  if (!/^\d{4}-\d{2}$/.test(m)) {
    console.error(`bad month "${m}", expected YYYY-MM`);
    process.exit(1);
  }
}

async function call(path, { method = 'GET', json } = {}) {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: {
      cookie,
      'x-csrf-token': csrf,
      ...(json ? { 'content-type': 'application/json' } : {}),
    },
    body: json ? JSON.stringify(json) : undefined,
  });
  const text = await res.text();
  let body;
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    body = { raw: text.slice(0, 200) };
  }
  if (!res.ok) {
    throw new Error(`${method} ${path} -> ${res.status} ${body.error ?? body.raw ?? ''}`);
  }
  return body;
}

// ---------------------------------------------------------------------

const PROFILES = {
  ads: [
    { key: 'meta-campaign', name: 'Meta Ads (campaigns)' },
    { key: 'google-campaign', name: 'Google Ads (campaigns)' },
    { key: 'ghl-contacts', name: 'Go High Level (contacts)' },
    { key: 'blvd-appointments', name: 'Appointments' },
    { key: 'blvd-line-items', name: 'Sales' },
  ],
  d2d: [
    { key: 'd2d-accounts', name: 'Door to door (accounts)' },
    { key: 'google-campaign', name: 'Google Ads (campaigns)' },
  ],
};

async function ensureSources(needed) {
  const { sources } = await call('/api/tenant/sources');
  const have = new Set((sources ?? []).map((s) => s.key));
  for (const s of needed) {
    if (have.has(s.key)) continue;
    await call('/api/tenant/sources', {
      method: 'POST',
      json: { name: s.name, connectorType: s.key },
    });
    console.log(`    + source ${s.key}`);
  }
}

function buildCsvs(profile, month, slug) {
  const rand = rng(`${slug}:${month}`);
  if (profile === 'd2d') {
    const accounts = 260 + Math.floor(rand() * 420);
    return [
      { key: 'd2d-accounts', csv: d2dAccountsCsv(month, rand, accounts) },
      { key: 'google-campaign', csv: googleCampaignCsv(month, rand) },
    ];
  }
  const leads = 48 + Math.floor(rand() * 70);
  const appts = appointmentsCsv(month, rand, leads);
  return [
    { key: 'meta-campaign', csv: metaCampaignCsv(month, rand) },
    { key: 'google-campaign', csv: googleCampaignCsv(month, rand) },
    { key: 'ghl-contacts', csv: ghlContactsCsv(month, rand, leads) },
    { key: 'blvd-appointments', csv: appts.csv },
    { key: 'blvd-line-items', csv: salesCsv(month, rand, appts.booked) },
  ];
}

async function seedTenant(tenant, profile) {
  console.log(`\n${tenant.name} (${tenant.slug ?? tenant.id}) profile=${profile}`);
  const switched = await call('/api/auth/switch-tenant', {
    method: 'POST',
    json: { tenantId: tenant.id },
  });
  csrf = switched.csrf;
  const slug = switched.tenant?.slug ?? tenant.id;

  await ensureSources(PROFILES[profile]);

  for (const month of months) {
    for (const { key, csv } of buildCsvs(profile, month, slug)) {
      try {
        const res = await call('/api/imports', {
          method: 'POST',
          json: { sourceKey: key, month, csv },
        });
        console.log(`    ${month} ${key}: ${res.rowCount} rows (${res.kind})`);
      } catch (err) {
        console.error(`    ${month} ${key}: FAILED ${err.message}`);
      }
    }
  }
}

const { tenants } = await call('/api/agency/tenants');
if (!tenants?.length) {
  console.error('no tenants visible to this session');
  process.exit(1);
}

const targets = onlySlug
  ? tenants.filter((t) => (t.slug ?? '').toLowerCase() === onlySlug.toLowerCase() || t.id === onlySlug)
  : tenants;

if (targets.length === 0) {
  console.error(`no tenant matched "${onlySlug}". Visible: ${tenants.map((t) => t.slug ?? t.id).join(', ')}`);
  process.exit(1);
}

console.log('Seeding MOCK data. Every figure below is invented.');
console.log(`months: ${months.join(', ')}`);

for (const t of targets) {
  // A tenant whose name or slug looks like door to door gets that shape
  // unless the caller pinned a profile explicitly.
  const auto = /solar|roof|d2d|door/i.test(`${t.name} ${t.slug ?? ''}`) ? 'd2d' : 'ads';
  await seedTenant(t, profileArg ?? auto);
}

console.log('\nDone. Each client dashboard is current immediately (imports roll up inline).');
console.log('The Clients roster totals and green dot come from agency_rollup, which the');
console.log('sync worker writes on its own schedule, so that list can lag by a cycle.');
