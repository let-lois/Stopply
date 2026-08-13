// Carry the BI platform's team across, passwords included.
//
// bi.letlois.com and this platform live in different Cloudflare accounts, so
// nothing here can read that database directly. Somebody with access runs the
// export below and pipes the result in; this turns it into SQL.
//
//   # against the LetLois account (40d6a92830a7cb75278c823f7f1b19a0)
//   npx wrangler d1 execute letlois-bi-control --remote --json \
//     --command "SELECT id, email, name, role, password_hash, assigned_tenants_json, active FROM agency_users" \
//     > bi-users.json
//
//   node scripts/import-bi-users.mjs < bi-users.json > import.sql
//   npx wrangler d1 execute stopply-platform --remote --file import.sql
//
// The password_hash column comes across verbatim. It is a PBKDF2 hash, not a
// password: it cannot be reversed, and server/crypto/password.ts knows how to
// verify that format. Everyone's existing password therefore works here on the
// first try, and login quietly re-hashes it with Argon2id the first time it
// succeeds.
//
// Worth being clear-eyed about the tradeoff, because it is the point of the
// exercise rather than a side effect: two systems now accept the same
// credential, so a password compromised on one is compromised on both. That is
// what "same login" means. If that is not wanted, drop the password_hash
// column from the export and everyone sets a password here instead.

import { readFileSync } from 'node:fs';

const q = (v) => (v === null || v === undefined ? 'NULL' : `'${String(v).replace(/'/g, "''")}'`);
const now = new Date().toISOString();

const raw = readFileSync(0, 'utf8');
let payload;
try {
  payload = JSON.parse(raw);
} catch {
  process.stderr.write('Input is not JSON. Pipe the output of `wrangler d1 execute --json`.\n');
  process.exit(1);
}

// wrangler --json wraps results in an array of statement results.
const rows = Array.isArray(payload)
  ? (payload[0]?.results ?? [])
  : (payload.results ?? payload.rows ?? []);

if (rows.length === 0) {
  process.stderr.write('No rows in the export.\n');
  process.exit(1);
}

/**
 * Map a BI role onto a Stopply role.
 *
 * agency_admin holds the whole platform, which is super_admin here.
 * agency_staff is scoped to the tenants assigned to them. Stopply's users
 * table carries one client per user and CHECKs that a client-scoped role has
 * one, so a staff member assigned several tenants cannot be represented
 * faithfully and is reported rather than silently truncated to the first.
 */
function parseTenants(json) {
  try {
    const parsed = JSON.parse(json ?? '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function mapUser(row) {
  if (row.role === 'agency_admin') {
    return { role: 'super_admin', clientId: null };
  }

  const assigned = parseTenants(row.assigned_tenants_json);

  if (assigned.length !== 1) {
    return { skip: `${row.email}: agency_staff assigned to ${assigned.length} tenants` };
  }
  return { role: 'client_admin', clientId: assigned[0] };
}

const lines = ['PRAGMA foreign_keys = ON;'];
const skipped = [];
let imported = 0;
let withPassword = 0;

for (const row of rows) {
  const mapped = mapUser(row);
  if (mapped.skip) {
    skipped.push(mapped.skip);
    continue;
  }

  // Deactivated over there stays deactivated here. Carrying an account across
  // and quietly reactivating it is the kind of thing nobody notices until the
  // person who was removed still has access.
  const status = row.active === 0 ? 'inactive' : 'active';
  if (row.password_hash) withPassword++;

  lines.push(
    `INSERT OR REPLACE INTO users (id, email, name, role, client_id, status, password_hash, created_at) VALUES (` +
      [
        q(row.id),
        q(String(row.email).trim().toLowerCase()),
        q(row.name),
        q(mapped.role),
        mapped.clientId ? q(mapped.clientId) : 'NULL',
        q(status),
        row.password_hash ? q(row.password_hash) : 'NULL',
        q(row.created_at ?? now),
      ].join(', ') +
      ');'
  );
  imported++;
}

process.stderr.write(`${imported} users, ${withPassword} with a password that will work as-is\n`);
for (const note of skipped) process.stderr.write(`skipped  ${note}\n`);

process.stdout.write(lines.join('\n') + '\n');
