// Emit the SQL that seeds a database with a working sign-in and one
// workspace's worth of field data.
//
// It writes SQL to stdout rather than talking to D1 itself, so the same script
// seeds the local database during development and the remote one on first
// deploy, and so the statements can be read before they are run.
//
// Usage:
//   node scripts/seed.mjs > /tmp/seed.sql
//   wrangler d1 execute stopply-platform --local --file /tmp/seed.sql

import { argon2id } from '@noble/hashes/argon2.js';
import { randomBytes } from 'node:crypto';

const PARAMS = { m: 19456, t: 2, p: 1, dkLen: 32 };

function hashPassword(password) {
  const salt = new Uint8Array(randomBytes(16));
  const hash = argon2id(password, salt, PARAMS);
  const b64 = (b) => Buffer.from(b).toString('base64');
  return `$argon2id$v=19$m=${PARAMS.m},t=${PARAMS.t},p=${PARAMS.p}$${b64(salt)}$${b64(hash)}`;
}

const q = (v) => (v === null ? 'NULL' : `'${String(v).replace(/'/g, "''")}'`);
const now = new Date('2026-08-01T12:00:00.000Z');
const iso = (d) => d.toISOString();

// The password is a seed value for a demo workspace, not a production
// credential, and it is printed to stderr rather than baked into any file the
// application reads.
const password = process.env.SEED_PASSWORD ?? 'stopply-demo-password';

const lines = ['PRAGMA foreign_keys = ON;'];

const clients = [
  ['cl_bluecactus', 'BLU', 'Blue Cactus Power Washing', 'Exterior cleaning', 'Pro', ['advertising', 'crm', 'analytics']],
  ['cl_allstar', 'ALL', 'Allstar Home Solutions', 'Home improvement', 'Pro', ['field_sales', 'crm']],
  ['cl_beclinical', 'BEC', 'BeClinical', 'Med spa', 'Enterprise', ['advertising', 'crm', 'analytics']],
  ['cl_roguesolar', 'ROG', 'Rogue Solar', 'Solar', 'Enterprise', ['advertising', 'field_sales', 'crm', 'analytics']],
];

for (const [id, code, name, industry, plan, modules] of clients) {
  // Allstar reads live, because field sales is the one module with a real
  // source behind it. The others stay on demo data: their numbers would come
  // from Meta, Google Ads, Shopify and a carrier API, and none of those
  // integrations exists, so live mode for them would mean an honest empty
  // state rather than a dashboard.
  const dataMode = id === 'cl_allstar' ? 'live' : 'demo';
  lines.push(
    `INSERT INTO clients (id, code, name, industry, status, plan, data_mode, contact_name, contact_email, created_at, last_active) VALUES (${q(id)}, ${q(code)}, ${q(name)}, ${q(industry)}, 'active', ${q(plan)}, ${q(dataMode)}, ${q('Operations')}, ${q(`ops@${code.toLowerCase()}.example.invalid`)}, ${q(iso(now))}, ${q(iso(now))});`
  );
  for (const m of modules) {
    lines.push(
      `INSERT INTO client_modules (client_id, module_id, enabled_at) VALUES (${q(id)}, ${q(m)}, ${q(iso(now))});`
    );
  }
}

// Two demo accounts with a known password: one platform-wide, one scoped to a
// single workspace. The second is what proves tenant scoping restricts rather
// than merely filtering a sidebar, so it earns its place.
const users = [
  ['usr_admin', 'admin@letlois.example.invalid', 'Alex Rivera', 'super_admin', null],
  ['usr_allstar', 'admin@allstar.example.invalid', 'Dana Fields', 'client_admin', 'cl_allstar'],
];

for (const [id, email, name, role, clientId] of users) {
  lines.push(
    `INSERT INTO users (id, email, name, role, client_id, status, password_hash, created_at) VALUES (${q(id)}, ${q(email)}, ${q(name)}, ${q(role)}, ${clientId ? q(clientId) : 'NULL'}, 'active', ${q(hashPassword(password))}, ${q(iso(now))});`
  );
}

// The real LetLois team, from bi.letlois.com.
//
// They share one temporary password so the accounts are usable immediately.
// Each row still gets its own salt, so the stored hashes differ and cracking
// one tells you nothing about the others, but the password itself is written
// down here and is therefore known to anyone who can read this repository.
//
// It is meant to be replaced, and there are two ways to do that. Running
// scripts/import-bi-users.mjs brings each person's existing bi.letlois.com
// hash across, after which their real password works here and this one stops
// mattering. Failing that, set TEAM_PASSWORD and re-seed.
const team = [
  ['usr_curtis', 'curtis@letlois.com', 'Curtis Smith', 'super_admin', null],
  ['usr_josh', 'josh@letlois.com', 'LetLois Admin', 'super_admin', null],
  ['usr_noah', 'noah@letlois.com', 'Noah Rance', 'super_admin', null],
  ['usr_rohel', 'rohel@letlois.com', 'Rohel', 'super_admin', null],
  // Staff, scoped to Allstar, exactly as the BI team page has them.
  ['usr_roh', 'rohellegson@protonmail.com', 'Roh', 'client_admin', 'cl_allstar'],
];

const teamPassword = process.env.TEAM_PASSWORD ?? 'test1234';

for (const [id, email, name, role, clientId] of team) {
  lines.push(
    `INSERT INTO users (id, email, name, role, client_id, status, password_hash, created_at) VALUES (${q(id)}, ${q(email)}, ${q(name)}, ${q(role)}, ${clientId ? q(clientId) : 'NULL'}, 'active', ${q(hashPassword(teamPassword))}, ${q(iso(now))});`
  );
}

// Field data for Allstar, over real Riverside, California extents. California
// is the market; the client's timezone drives how reporting days are cut, so
// the data and the zone have to agree or "knocked today" means two things.
const territories = [
  ['ter_as_1', 'Riverside North', 33.99, 33.95, -117.34, -117.42, 'rep_as_1'],
  ['ter_as_2', 'Riverside South', 33.95, 33.91, -117.34, -117.42, 'rep_as_2'],
];
for (const [id, name, north, south, east, west] of territories) {
  // The boundary is the definition and the box is derived from it, so the seed
  // writes both rather than leaving a territory with no shape. assigned_rep_id
  // is gone: who works a territory lives on the rep, in one place.
  const ring = JSON.stringify([
    [west, south],
    [east, south],
    [east, north],
    [west, north],
  ]);
  lines.push(
    `INSERT INTO territories (id, client_id, name, north, south, east, west, boundary_json) VALUES (${q(id)}, 'cl_allstar', ${q(name)}, ${north}, ${south}, ${east}, ${west}, ${q(ring)});`
  );
}

// Reps sign in with their own credential, against their own table, and get
// their own cookie. They are never rows in `users`.
const repPassword = process.env.REP_PASSWORD ?? 'test1234';
const reps = [
  ['rep_as_1', 'Marcus Webb', 'ter_as_1', 'marcus@allstar.example.invalid'],
  ['rep_as_2', 'Priya Anand', 'ter_as_2', 'priya@allstar.example.invalid'],
];
for (const [id, name, territoryId, email] of reps) {
  lines.push(
    `INSERT INTO reps (id, client_id, name, territory_id, user_id, created_at, email, password_hash, status) VALUES (${q(id)}, 'cl_allstar', ${q(name)}, ${q(territoryId)}, NULL, ${q(iso(now))}, ${q(email)}, ${q(hashPassword(repPassword))}, 'active');`
  );
}

// Deterministic pseudo-random, so re-running the seed produces the same
// database and a screenshot from yesterday still matches.
let state = 20260801;
const rand = () => {
  state = (state * 1103515245 + 12345) % 2147483648;
  return state / 2147483648;
};

const STREETS = [
  'Magnolia Ave',
  'Arlington Ave',
  'Van Buren Blvd',
  'Central Ave',
  'Chicago Ave',
];

// Weighted to look like a real week rather than a tidy funnel. The three
// appointment outcomes are what make the booked-to-showed gap visible: a
// no-show is not a booking that has not happened yet, and until now the two
// were indistinguishable.
const OUTCOMES = [
  ['not_visited', 0.3],
  ['no_answer', 0.28],
  ['come_back', 0.08],
  ['not_interested', 0.13],
  ['interested', 0.07],
  ['appointment_set', 0.05],
  ['appointment_missed', 0.03],
  ['appointment_kept', 0.04],
  ['closed_sale', 0.02],
];

// A door that reached a later stage passed through the earlier ones, so each
// outcome carries the ladder that produced it. Without this the funnel shows
// more sales than appointments, which is not a funnel.
const LADDER = {
  not_visited: [],
  no_answer: ['no_answer'],
  come_back: ['no_answer', 'come_back'],
  not_interested: ['not_interested'],
  interested: ['interested'],
  appointment_set: ['interested', 'appointment_set'],
  appointment_missed: ['interested', 'appointment_set', 'appointment_missed'],
  appointment_kept: ['interested', 'appointment_set', 'appointment_kept'],
  closed_sale: ['interested', 'appointment_set', 'appointment_kept', 'closed_sale'],
  do_not_knock: ['do_not_knock'],
};

function pickOutcome() {
  let r = rand();
  for (const [name, weight] of OUTCOMES) {
    if (r < weight) return name;
    r -= weight;
  }
  return 'not_visited';
}

let visitSeq = 0;
for (let i = 0; i < 96; i++) {
  const t = territories[i % 2];
  const [terId, , north, south, east, west] = t;
  const lat = south + rand() * (north - south);
  const lng = west + rand() * (east - west);
  const disposition = pickOutcome();
  const id = `prp_as_${String(i).padStart(3, '0')}`;
  const streetNumber = 1200 + i * 7;
  const street = STREETS[i % STREETS.length];

  lines.push(
    `INSERT INTO properties (id, client_id, address, city, state, postal_code, lat, lng, territory_id, disposition, owner_name, owner_phone, notes, created_at, updated_at) VALUES (${q(id)}, 'cl_allstar', ${q(`${streetNumber} ${street}`)}, 'Riverside', 'CA', '92503', ${lat.toFixed(6)}, ${lng.toFixed(6)}, ${q(terId)}, ${q(disposition)}, NULL, NULL, NULL, ${q(iso(now))}, ${q(iso(now))});`
  );

  // A door that was knocked has visits behind it, one per stage it passed
  // through, spaced out in time. The two have to agree or the dashboard's
  // "doors visited" disagrees with its own outcome breakdown, and the funnel
  // shows sales with no appointment in front of them.
  const stages = LADDER[disposition] ?? [];
  const firstDaysAgo = 4 + Math.floor(rand() * 24);

  stages.forEach((stage, stageIndex) => {
    // Later stages happen later: an appointment is set at the door and kept
    // days afterwards, which is exactly the interval the funnel measures.
    const daysAgo = Math.max(0, firstDaysAgo - stageIndex * (1 + Math.floor(rand() * 4)));
    const occurred = new Date(
      now.getTime() - daysAgo * 86400000 - Math.floor(rand() * 8) * 3600000
    );
    // A car on the drive, recorded at the door only. Unknown for a third of
    // them, because a rep who did not look is not the same as no car.
    const roll = rand();
    const vehicle = roll < 0.34 ? 'NULL' : roll < 0.72 ? '1' : '0';
    lines.push(
      `INSERT INTO visits (id, device_visit_id, client_id, property_id, rep_id, disposition, notes, vehicle_present, occurred_at, recorded_at) VALUES (${q(`vis_seed_${visitSeq}`)}, ${q(`dev_seed_${visitSeq}`)}, 'cl_allstar', ${q(id)}, ${q(reps[i % 2][0])}, ${q(stage)}, NULL, ${vehicle}, ${q(iso(occurred))}, ${q(iso(occurred))});`
    );
    visitSeq++;
  });
}

process.stderr.write(`demo password: ${password}\n`);
process.stderr.write(`team temporary password: ${teamPassword}\n`);
process.stderr.write(`rep password: ${repPassword}\n`);
process.stdout.write(lines.join('\n') + '\n');
