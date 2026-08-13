// Bulk onboarding for a door to door crew.
//
// Adding reps one at a time through the dashboard is fine for a hire; it is
// not fine for standing up a crew of twenty on day one. This posts a roster
// and prints each rep's first password once, which is the only time it
// exists in plaintext.
//
// Usage:
//   API_BASE=https://all-star.bi.letlois.com SESSION_COOKIE=... CSRF_TOKEN=... \
//   node scripts/add-field-reps.mjs --file crew.csv
//
//   API_BASE=... SESSION_COOKIE=... CSRF_TOKEN=... \
//   node scripts/add-field-reps.mjs --rep "Dana Reyes,dana@allstar.com,rep,Team A"
//
// The CSV wants one rep per line: name,email,role,team
// role is 'rep' or 'manager' and defaults to rep. team is optional.
//
// SESSION_COOKIE and CSRF_TOKEN come from a dashboard login with write
// access to this client (an account_admin, or an agency user switched into
// it). Reps themselves cannot run this.

import { readFileSync } from 'node:fs';

function arg(name, fallback = undefined) {
  const i = process.argv.indexOf(`--${name}`);
  if (i === -1) return fallback;
  return process.argv[i + 1];
}

const base = process.env.API_BASE;
const cookie = process.env.SESSION_COOKIE;
const csrf = process.env.CSRF_TOKEN;

if (!base || !cookie || !csrf) {
  console.error('set API_BASE (the client dashboard host), SESSION_COOKIE and CSRF_TOKEN');
  process.exit(1);
}

function parseLine(line) {
  const [name, email, role, team] = line.split(',').map((p) => p.trim());
  if (!name || !email) return null;
  return {
    name,
    email,
    role: role === 'manager' ? 'manager' : 'rep',
    team: team || null,
  };
}

const lines = [];
const file = arg('file');
if (file) {
  for (const raw of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const line = raw.trim();
    // Skip blanks, comments, and a header row if the file has one.
    if (!line || line.startsWith('#') || /^name\s*,/i.test(line)) continue;
    lines.push(line);
  }
}
for (let i = 0; i < process.argv.length; i++) {
  if (process.argv[i] === '--rep' && process.argv[i + 1]) lines.push(process.argv[i + 1]);
}

const reps = lines.map(parseLine).filter(Boolean);
if (reps.length === 0) {
  console.error('nothing to add: pass --file crew.csv or one or more --rep "name,email,role,team"');
  process.exit(1);
}

const issued = [];
const failed = [];

for (const rep of reps) {
  const res = await fetch(`${base}/api/tenant/field/reps`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie, 'x-csrf-token': csrf },
    body: JSON.stringify(rep),
  });
  const body = await res.json().catch(() => ({}));
  if (res.ok) {
    issued.push({ ...rep, tempPassword: body.tempPassword });
  } else {
    // One bad row does not stop the crew. A duplicate email is the usual
    // cause and means that rep is already on the roster.
    failed.push({ ...rep, error: body.error ?? `HTTP ${res.status}` });
  }
}

if (issued.length > 0) {
  console.log('\nAdded. These passwords are shown once, nowhere else:\n');
  console.log(['name', 'email', 'role', 'team', 'first password'].join('\t'));
  for (const r of issued) {
    console.log([r.name, r.email, r.role, r.team ?? '', r.tempPassword].join('\t'));
  }
  console.log(`\nReps sign in at ${base}/field`);
}

if (failed.length > 0) {
  console.log('\nNot added:\n');
  for (const r of failed) console.log(`  ${r.email}: ${r.error}`);
}

console.log(`\n${issued.length} added, ${failed.length} skipped.`);
process.exit(failed.length > 0 && issued.length === 0 ? 1 : 0);
