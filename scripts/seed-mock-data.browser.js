/* Stopply mock data seeder, browser version. GENERATED FILE.
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

(async () => {
  // Deterministic PRNG so a given tenant and month always generate the same
  // numbers. Re-running is then predictable, and two people reviewing the
  // same seeded tenant are looking at the same figures.
  function rng(seed) {
    let h = 2166136261;
    for (const ch of seed) {
      h ^= ch.charCodeAt(0);
      h = Math.imul(h, 16777619);
    }
    return () => {
      h ^= h << 13;
      h ^= h >>> 17;
      h ^= h << 5;
      return ((h >>> 0) % 100000) / 100000;
    };
  }

  const FIRST = ['Avery', 'Jordan', 'Riley', 'Casey', 'Morgan', 'Quinn', 'Rowan', 'Sage', 'Emerson', 'Harper', 'Reese', 'Skyler'];
  const LAST = ['Delgado', 'Whitfield', 'Okafor', 'Lindqvist', 'Barros', 'Nakamura', 'Achebe', 'Vasquez', 'Duarte', 'Kowalski', 'Mbeki', 'Fontaine'];
  const REPS = ['Dana Whitmore', 'Elias Boone', 'Priya Raman', 'Marcus Hale', 'Tessa Nguyen'];
  const CLOSERS = ['Jonah Reyes', 'Bianca Ford', 'Omar Haddad'];

  const pad = (n) => String(n).padStart(2, '0');
  const daysIn = (month) => {
    const [y, m] = month.split('-').map(Number);
    return new Date(Date.UTC(y, m, 0)).getUTCDate();
  };
  const dayIso = (month, day, hour = 14) => `${month}-${pad(day)}T${pad(hour)}:00:00Z`;
  const csvEscape = (v) => {
    const s = String(v ?? '');
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const toCsv = (headers, rows) =>
    [headers.join(','), ...rows.map((r) => r.map(csvEscape).join(','))].join('\n');

  // ---------------------------------------------------------------------
  // Generators. Column names match what each parser in
  // packages/connectors/src/parsers.ts actually reads.
  // ---------------------------------------------------------------------

  function metaCampaignCsv(month, rand) {
    const campaigns = ['Prospecting | Broad', 'Retargeting | 30d Site', 'Lookalike 1% | Purchasers'];
    const rows = campaigns.map((c) => {
      const spend = Math.round(1800 + rand() * 4200);
      const results = Math.round(spend / (28 + rand() * 22));
      return [c, spend.toFixed(2), results];
    });
    return toCsv(['Campaign name', 'Amount spent (USD)', 'Results'], rows);
  }

  function googleCampaignCsv(month, rand) {
    const campaigns = ['Search | Brand', 'Search | Non-Brand', 'Performance Max | All'];
    const rows = campaigns.map((c) => {
      const cost = Math.round(1200 + rand() * 3800);
      const conv = Math.round(cost / (34 + rand() * 26));
      return [c, cost.toFixed(2), conv];
    });
    return toCsv(['Campaign', 'Cost', 'Conversions'], rows);
  }

  // Leads. Channel is derived downstream from utm_source, so these split
  // across Meta, Google and direct the way a real export would.
  function ghlContactsCsv(month, rand, count) {
    const dim = daysIn(month);
    const rows = [];
    for (let i = 0; i < count; i++) {
      const first = FIRST[Math.floor(rand() * FIRST.length)];
      const last = LAST[Math.floor(rand() * LAST.length)];
      const day = 1 + Math.floor(rand() * dim);
      const roll = rand();
      const [utmSource, campaign] =
        roll < 0.45
          ? ['facebook', 'Prospecting | Broad']
          : roll < 0.85
            ? ['google', 'Search | Non-Brand']
            : ['', ''];
      rows.push([
        `c${month.replace('-', '')}${pad(i)}`,
        first,
        last,
        `${first.toLowerCase()}.${last.toLowerCase()}${i}@example.com`,
        `602555${pad(i % 100)}${Math.floor(rand() * 10)}`,
        dayIso(month, day, 9 + Math.floor(rand() * 9)),
        utmSource,
        utmSource ? 'cpc' : '',
        campaign,
      ]);
    }
    return toCsv(
      ['Contact Id', 'First Name', 'Last Name', 'Email', 'Phone', 'Created', 'utm_source', 'utm_medium', 'Campaign name'],
      rows
    );
  }

  // Appointments. "final" counts as both scheduled and completed, anything
  // booked or confirmed counts as scheduled only.
  function appointmentsCsv(month, rand, leads) {
    const dim = daysIn(month);
    const rows = [];
    const booked = Math.round(leads * (0.42 + rand() * 0.14));
    for (let i = 0; i < booked; i++) {
      const first = FIRST[Math.floor(rand() * FIRST.length)];
      const last = LAST[Math.floor(rand() * LAST.length)];
      const day = 1 + Math.floor(rand() * dim);
      rows.push([
        `appt${month.replace('-', '')}${pad(i)}`,
        `cl${pad(i)}`,
        `${first} ${last}`,
        dayIso(month, day, 10 + Math.floor(rand() * 8)),
        rand() < 0.68 ? 'FINAL' : 'BOOKED',
      ]);
    }
    return { csv: toCsv(['Appointment Id', 'Client Id', 'Client Name', 'Start at', 'State'], rows), booked };
  }

  function salesCsv(month, rand, booked) {
    const dim = daysIn(month);
    const rows = [];
    const sales = Math.round(booked * (0.3 + rand() * 0.2));
    for (let i = 0; i < sales; i++) {
      const first = FIRST[Math.floor(rand() * FIRST.length)];
      const last = LAST[Math.floor(rand() * LAST.length)];
      const day = 1 + Math.floor(rand() * dim);
      rows.push([
        `sale${month.replace('-', '')}${pad(i)}`,
        `${first} ${last}`,
        dayIso(month, day, 12 + Math.floor(rand() * 6)),
        (350 + Math.round(rand() * 2400)).toFixed(2),
      ]);
    }
    return toCsv(['Sale Id', 'Client Name', 'Sale date', 'Net sales'], rows);
  }

  // Door to door. Each account carries its own funnel timestamps; the rep
  // on Owner.Name earns the knock/pitch/appointment credit and Closer.Name
  // earns the sit/close, which is what fills the two leaderboards.
  function d2dAccountsCsv(month, rand, accounts) {
    const dim = daysIn(month);
    const rows = [];
    for (let i = 0; i < accounts; i++) {
      const first = FIRST[Math.floor(rand() * FIRST.length)];
      const last = LAST[Math.floor(rand() * LAST.length)];
      const owner = REPS[Math.floor(rand() * REPS.length)];
      const closer = CLOSERS[Math.floor(rand() * CLOSERS.length)];
      const day = 1 + Math.floor(rand() * dim);
      const knock = dayIso(month, day, 16);
      const pitched = rand() < 0.34;
      const appointment = pitched && rand() < 0.45;
      const sat = appointment && rand() < 0.7;
      const closed = sat && rand() < 0.42;
      const installed = closed && rand() < 0.55;
      rows.push([
        `acct${month.replace('-', '')}${pad(i)}`,
        owner,
        // A closer is assigned once an appointment is set, not only when the
        // deal closes. The parser credits sitsRun to Closer.Name and falls
        // back to "Unattributed" when it is blank, so gating this on `closed`
        // put every sit-without-close under Unattributed and left the real
        // closers looking idle.
        appointment ? closer : '',
        first,
        last,
        `${first.toLowerCase()}.${last.toLowerCase()}${i}@example.com`,
        `480555${pad(i % 100)}${Math.floor(rand() * 10)}`,
        knock,
        'Door to Door',
        closed ? 'Closed Won' : sat ? 'Sat' : appointment ? 'Appointment Set' : pitched ? 'Pitched' : 'Knocked',
        knock,
        pitched ? dayIso(month, day, 17) : '',
        appointment ? dayIso(month, Math.min(day + 1, dim), 11) : '',
        sat ? dayIso(month, Math.min(day + 3, dim), 13) : '',
        closed ? dayIso(month, Math.min(day + 3, dim), 15) : '',
        installed ? dayIso(month, Math.min(day + 12, dim), 10) : '',
      ]);
    }
    return toCsv(
      [
        'AccountId', 'Owner.Name', 'Closer.Name', 'Resident.FirstName', 'Resident.LastName',
        'Resident.Email', 'Resident.Phone', 'CreatedDate', 'Source', 'WorkflowStage',
        'Knock', 'Pitch', 'Appointment', 'Sit', 'Closed', 'Installed',
      ],
      rows
    );
  }



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

  let okCount = 0;
  let failCount = 0;
  const failedClients = [];

  for (let ti = 0; ti < targets.length; ti++) {
    const t = targets[ti];
    const profile = window.SEED_PROFILE ?? (/solar|roof|d2d|door/i.test((t.name ?? '') + ' ' + (t.slug ?? '')) ? 'd2d' : 'ads');
    log('[' + (ti + 1) + '/' + targets.length + '] ' + t.name + ' (' + profile + ')');
    try {
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
          okCount++;
          log('  ' + month + ' ' + key + ': ' + res.rowCount + ' rows');
        } catch (err) {
          failCount++;
          console.error('[seed]  ' + month + ' ' + key + ' FAILED', err.message);
        }
      }
    }
    // Anything outside the import loop (switch-tenant, listing or creating
    // sources) used to throw straight past every remaining client, so one
    // bad tenant silently ended the run. Contain it per client instead.
    } catch (err) {
      failCount++;
      failedClients.push(t.name);
      console.error('[seed] ' + t.name + ' ABORTED, moving to the next client:', err.message);
    }
  }

  log('done. ' + okCount + ' imports succeeded, ' + failCount + ' failed.');
  if (failedClients.length) log('clients that aborted: ' + failedClients.join(', '));
  log('Reload the page, then open a client to see its dashboard.');
  log('The Clients roster totals come from agency_rollup, written by the sync');
  log('worker on its own schedule, so that list can lag behind by a cycle.');

})().catch((e) => console.error('[seed] failed:', e));
