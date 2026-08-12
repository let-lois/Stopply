// CSV generators for the mock data seeder (scripts/seed-mock-data.mjs).
// Kept in their own module so the connectors test suite can run each
// generated CSV through the real parser and prove the column names still
// line up. If a parser changes which headers it reads, that test fails
// here rather than the seeder failing silently against a live tenant.

// Deterministic PRNG so a given tenant and month always generate the same
// numbers. Re-running is then predictable, and two people reviewing the
// same seeded tenant are looking at the same figures.
export function rng(seed) {
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

export function metaCampaignCsv(month, rand) {
  const campaigns = ['Prospecting | Broad', 'Retargeting | 30d Site', 'Lookalike 1% | Purchasers'];
  const rows = campaigns.map((c) => {
    const spend = Math.round(1800 + rand() * 4200);
    const results = Math.round(spend / (28 + rand() * 22));
    return [c, spend.toFixed(2), results];
  });
  return toCsv(['Campaign name', 'Amount spent (USD)', 'Results'], rows);
}

export function googleCampaignCsv(month, rand) {
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
export function ghlContactsCsv(month, rand, count) {
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
export function appointmentsCsv(month, rand, leads) {
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

export function salesCsv(month, rand, booked) {
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
export function d2dAccountsCsv(month, rand, accounts) {
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

