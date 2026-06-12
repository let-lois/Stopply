// Generates the paste-ready handoff SQL for the Cloudflare D1 console and
// re-verifies the embedded admin hash against the worker's verifier.
import { writeFileSync, readFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes, pbkdf2Sync, pbkdf2 as pbkdf2cb } from 'node:crypto';
import { promisify } from 'node:util';
import { HELP_ARTICLES } from './seed-help.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, 'handoff');
mkdirSync(outDir, { recursive: true });

// Never hardcode the temp password. Pass it at runtime, e.g.
//   SEED_TEMP_PASSWORD=... node scripts/generate-handoff.mjs
const TEMP_PASSWORD = process.env.SEED_TEMP_PASSWORD ?? process.argv[2];
if (!TEMP_PASSWORD) {
  console.error('set SEED_TEMP_PASSWORD env var or pass the password as argv[1]');
  process.exit(1);
}
const ADMIN_EMAIL = process.env.SEED_ADMIN_EMAIL ?? 'josh@letlois.com';

// same algorithm as scripts/seed.mjs hashPassword
const salt = randomBytes(16);
const hash = pbkdf2Sync(TEMP_PASSWORD, salt, 100000, 32, 'sha256');
const storedHash = `pbkdf2$100000$${salt.toString('base64')}$${hash.toString('base64')}`;

const auId = `au_${randomBytes(8).toString('hex')}`;
const sqlStr = (s) => `'${String(s).replace(/'/g, "''")}'`; // SQLite: double single quotes

// ---- migration file: copy verbatim, it is already paste-ready ----
const migration = readFileSync(join(root, 'packages/db/migrations/control/0001_init.sql'), 'utf8');
writeFileSync(join(outDir, '01-control-migration.sql'), migration);

// ---- seed file ----
const lines = [];
lines.push('-- Control plane seed. Run AFTER 01-control-migration.sql.');
lines.push('-- Mirrors scripts/seed.mjs: first agency_admin + the ten help articles.');
lines.push(`-- Admin: ${ADMIN_EMAIL}  (temp password is delivered out of band, not stored here)`);
lines.push('');
lines.push('-- Agency admin (guarded: only inserts if this email is not already present).');
lines.push(
  `INSERT INTO agency_users (id, email, name, role, password_hash, active)\n` +
    `SELECT ${sqlStr(auId)}, ${sqlStr(ADMIN_EMAIL)}, ${sqlStr('LetLois Admin')}, 'agency_admin', ${sqlStr(storedHash)}, 1\n` +
    `WHERE NOT EXISTS (SELECT 1 FROM agency_users WHERE email = ${sqlStr(ADMIN_EMAIL)});`
);
lines.push('');
lines.push('-- Ten help articles (idempotent upsert on slug, same as the seed script).');
for (const a of HELP_ARTICLES) {
  const haId = `ha_${randomBytes(8).toString('hex')}`;
  lines.push(
    `INSERT INTO help_articles (id, slug, title, body_md, tags, published, updated_by)\n` +
      `VALUES (${sqlStr(haId)}, ${sqlStr(a.slug)}, ${sqlStr(a.title)}, ${sqlStr(a.body)}, ${sqlStr(a.tags)}, 1, 'seed')\n` +
      `ON CONFLICT (slug) DO UPDATE SET title = excluded.title, body_md = excluded.body_md, tags = excluded.tags;`
  );
  lines.push('');
}
const seed = lines.join('\n');
writeFileSync(join(outDir, '02-control-seed.sql'), seed);

// ---- re-verify the embedded hash with the worker's verifier logic ----
const pbkdf2Async = promisify(pbkdf2cb);
const parts = storedHash.split('$');
const iterations = Math.min(parseInt(parts[1], 10) || 100000, 100000);
const actual = await pbkdf2Async(TEMP_PASSWORD, Buffer.from(parts[2], 'base64'), iterations, 32, 'sha256');
const expected = Buffer.from(parts[3], 'base64');
const ok = parts.length === 4 && parts[0] === 'pbkdf2' && actual.equals(expected);

console.log('embedded password_hash:', storedHash);
console.log('hash parts:', parts.length, '| worker verifyPassword(temp) =', ok);
console.log('wrote handoff/01-control-migration.sql and handoff/02-control-seed.sql');
process.exit(ok ? 0 : 1);
