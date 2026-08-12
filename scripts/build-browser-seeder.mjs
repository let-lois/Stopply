// Emits scripts/seed-mock-data.browser.js: a paste-into-DevTools version of
// the mock data seeder.
//
// The Node seeder needs SESSION_COOKIE and CSRF_TOKEN pulled out of the
// browser by hand, and the CSRF token is not even a cookie (it lives in
// memory, returned by the login response), so getting it means digging
// through the Network tab. Run from the console on an already signed in
// tab instead and both problems disappear: the cookie rides along on
// same-origin fetches, and /api/auth/me hands back the CSRF token.
//
// Generated rather than hand-maintained so the CSV builders can never
// drift from the ones the connectors test suite verifies.
//
//   node scripts/build-browser-seeder.mjs

import { readFileSync, writeFileSync } from 'node:fs';

const shared = readFileSync(new URL('./lib/mock-csv.mjs', import.meta.url), 'utf8')
  // Strip the module header and the export keywords: the browser build is
  // one IIFE, not a module.
  .replace(/^\/\/[^\n]*\n(\/\/[^\n]*\n)*\n/, '')
  .replace(/^export /gm, '');

const driver = `
  // ---- driver ----------------------------------------------------------
  const log = (...a) => console.log('%c[seed]', 'color:#8ab4f8', ...a);

  async function call(path, { method = 'GET', json } = {}) {
    const res = await fetch(path, {
      method,
      credentials: 'same-origin',
      headers: { 'x-csrf-token': csrf, ...(json ? { 'content-type': 'application/json' } : {}) },
      body: json ? JSON.stringify(json) : undefined,
    });
    const text = await res.text();
    let body;
    try { body = text ? JSON.parse(text) : {}; } catch { body = { raw: text.slice(0, 200) }; }
    if (!res.ok) throw new Error(method + ' ' + path + ' -> ' + res.status + ' ' + (body.error ?? body.raw ?? ''));
    return body;
  }

  // Last three whole months, so the seeded data reads as current whenever
  // this is run rather than being pinned to a date baked in at build time.
  function recentMonths(n) {
    const out = [];
    const d = new Date();
    for (let i = 0; i < n; i++) {
      out.unshift(d.getUTCFullYear() + '-' + String(d.getUTCMonth() + 1).padStart(2, '0'));
      d.setUTCMonth(d.getUTCMonth() - 1);
    }
    return out;
  }

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

  function buildCsvs(profile, month, slug) {
    const rand = rng(slug + ':' + month);
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

  let csrf = '';
  const me = await (await fetch('/api/auth/me', { credentials: 'same-origin' })).json();
  if (!me.csrf) throw new Error('not signed in on this tab, or session expired');
  csrf = me.csrf;
  if (me.role !== 'agency_admin' && me.role !== 'agency_staff') {
    throw new Error('run this signed in as an agency user, current role: ' + me.role);
  }

  const months = (window.SEED_MONTHS ?? recentMonths(3));
  const onlySlug = window.SEED_SLUG ?? null;

  const { tenants } = await call('/api/agency/tenants');
  const targets = onlySlug
    ? tenants.filter((t) => (t.slug ?? '').toLowerCase() === String(onlySlug).toLowerCase())
    : tenants;
  if (!targets.length) throw new Error('no tenants matched. Visible: ' + tenants.map((t) => t.slug ?? t.id).join(', '));

  log('seeding MOCK data, every figure is invented');
  log('months:', months.join(', '));
  log('clients:', targets.map((t) => t.name).join(', '));

  for (const t of targets) {
    const profile = window.SEED_PROFILE ?? (/solar|roof|d2d|door/i.test((t.name ?? '') + ' ' + (t.slug ?? '')) ? 'd2d' : 'ads');
    log(t.name + ' (' + profile + ')');
    const switched = await call('/api/auth/switch-tenant', { method: 'POST', json: { tenantId: t.id } });
    csrf = switched.csrf;
    const slug = switched.tenant?.slug ?? t.id;

    // Sources are keyed by a slug of their NAME, not by connector type, so
    // the key to import against must come back from the API. Existing ones
    // are matched on connector_type so a re-run reuses them.
    const { sources } = await call('/api/tenant/sources');
    const byType = new Map();
    for (const s of sources ?? []) {
      if (s.connector_type && !byType.has(s.connector_type)) byType.set(s.connector_type, s.key);
    }
    const sourceKeys = {};
    for (const s of PROFILES[profile]) {
      if (byType.has(s.key)) { sourceKeys[s.key] = byType.get(s.key); continue; }
      const created = await call('/api/tenant/sources', { method: 'POST', json: { name: s.name, connectorType: s.key } });
      sourceKeys[s.key] = created.key;
      log('  + source ' + s.key + ' as "' + created.key + '"');
    }

    for (const month of months) {
      for (const { key, csv } of buildCsvs(profile, month, slug)) {
        try {
          const res = await call('/api/imports', { method: 'POST', json: { sourceKey: sourceKeys[key], month, csv } });
          log('  ' + month + ' ' + key + ': ' + res.rowCount + ' rows');
        } catch (err) {
          console.error('[seed]  ' + month + ' ' + key + ' FAILED', err.message);
        }
      }
    }
  }

  log('done. Reload the page, then open a client to see its dashboard.');
  log('The Clients roster totals come from agency_rollup, written by the sync');
  log('worker on its own schedule, so that list can lag behind by a cycle.');
`;

const banner = `/* Stopply mock data seeder, browser version. GENERATED FILE.
 * Rebuild with: node scripts/build-browser-seeder.mjs
 *
 * WRITES FABRICATED NUMBERS INTO WHICHEVER TENANTS THIS SESSION CAN SEE.
 * Only run against tenants with no real customer behind them.
 *
 * Usage: sign in at bi.letlois.com as an agency admin, open DevTools
 * (F12) -> Console, paste this whole file, press Enter.
 *
 * Optional, set before pasting:
 *   window.SEED_SLUG = 'allstar';            // one client instead of all
 *   window.SEED_MONTHS = ['2026-06'];        // instead of the last 3 months
 *   window.SEED_PROFILE = 'd2d';             // force a shape
 */
`;

const out = `${banner}
(async () => {
${shared
  .split('\n')
  .map((l) => (l.trim() ? `  ${l}` : l))
  .join('\n')}
${driver}
})().catch((e) => console.error('[seed] failed:', e));
`;

writeFileSync(new URL('./seed-mock-data.browser.js', import.meta.url), out);
console.log('wrote scripts/seed-mock-data.browser.js');
