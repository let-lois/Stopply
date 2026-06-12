// Offline end-to-end dry run. No wrangler, no network, no Cloudflare.
// 1. Applies the real control migration SQL to an in-memory SQLite db
//    (this is exactly the file migrate-control.mjs feeds to wrangler d1 execute).
// 2. Runs the real seed logic from seed.mjs (same hashPassword, same INSERTs,
//    same HELP_ARTICLES) against that db.
// 3. Verifies the stored hash with a faithful port of the WORKER's verifyPassword
//    (workers/api/src/crypto.ts) to prove login would accept the temp password.
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes, pbkdf2Sync, pbkdf2 as pbkdf2cb } from 'node:crypto';
import { promisify } from 'node:util';
import { HELP_ARTICLES } from './seed-help.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
// Never hardcode the temp password. Pass it at runtime, e.g.
//   SEED_TEMP_PASSWORD=... node scripts/dryrun-verify.mjs
const TEMP_PASSWORD = process.env.SEED_TEMP_PASSWORD ?? process.argv[2];
if (!TEMP_PASSWORD) {
  console.error('set SEED_TEMP_PASSWORD env var or pass the password as argv[1]');
  process.exit(1);
}
const ADMIN_EMAIL = process.env.SEED_ADMIN_EMAIL ?? 'josh@letlois.com';

// --- exact copy of seed.mjs hashPassword ---
function hashPassword(password) {
  const salt = randomBytes(16);
  const hash = pbkdf2Sync(password, salt, 100000, 32, 'sha256');
  return `pbkdf2$100000$${salt.toString('base64')}$${hash.toString('base64')}`;
}

// --- faithful port of workers/api/src/crypto.ts verifyPassword ---
const PBKDF2_ITERATIONS = 100000;
const pbkdf2Async = promisify(pbkdf2cb);
async function workerVerifyPassword(password, stored) {
  const record = stored ?? null;
  if (record === null) return false;
  const parts = record.split('$');
  if (parts.length !== 4 || parts[0] !== 'pbkdf2') return false;
  const iterations = Math.min(parseInt(parts[1] ?? '0', 10) || PBKDF2_ITERATIONS, PBKDF2_ITERATIONS);
  const salt = Buffer.from(parts[2] ?? '', 'base64');
  const expected = Buffer.from(parts[3] ?? '', 'base64');
  const actual = await pbkdf2Async(password, salt, iterations, 32, 'sha256');
  return actual.length === expected.length && actual.equals(expected);
}

const db = new DatabaseSync(':memory:');

// 1. migration
const migrationSql = readFileSync(join(root, 'packages/db/migrations/control/0001_init.sql'), 'utf8');
db.exec(migrationSql);
const tables = db
  .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
  .all()
  .map((r) => r.name);
console.log('[migrate] tables created:', tables.join(', '));

// 2. seed: admin user
const storedHash = hashPassword(TEMP_PASSWORD);
db.prepare(
  `INSERT INTO agency_users (id, email, name, role, password_hash, active) VALUES (?, ?, ?, 'agency_admin', ?, 1)`
).run(`au_${randomBytes(8).toString('hex')}`, ADMIN_EMAIL, 'LetLois Admin', storedHash);

// 2b. seed: help articles (same ON CONFLICT upsert; run twice to prove idempotency)
for (let pass = 0; pass < 2; pass++) {
  for (const a of HELP_ARTICLES) {
    db.prepare(
      `INSERT INTO help_articles (id, slug, title, body_md, tags, published, updated_by)
       VALUES (?, ?, ?, ?, ?, 1, 'seed')
       ON CONFLICT (slug) DO UPDATE SET title = excluded.title, body_md = excluded.body_md, tags = excluded.tags`
    ).run(`ha_${randomBytes(8).toString('hex')}`, a.slug, a.title, a.body, a.tags);
  }
}

const userCount = db.prepare('SELECT COUNT(*) c FROM agency_users').get().c;
const articleCount = db.prepare('SELECT COUNT(*) c FROM help_articles').get().c;
const adminRow = db.prepare('SELECT email, role, active, password_hash FROM agency_users WHERE email=?').get(ADMIN_EMAIL);
console.log(`[seed] agency_users=${userCount}, help_articles=${articleCount} (after 2 passes => idempotent)`);
console.log(`[seed] admin role=${adminRow.role} active=${adminRow.active}`);
console.log(`[seed] stored hash format: ${storedHash.split('$').slice(0, 2).join('$')}$<saltB64>$<hashB64>  parts=${storedHash.split('$').length}`);

// 3. verify login would accept the temp password, reject a wrong one
const okRight = await workerVerifyPassword(TEMP_PASSWORD, adminRow.password_hash);
const okWrong = await workerVerifyPassword('not-the-password', adminRow.password_hash);
console.log(`[verify] worker verifyPassword(correct) = ${okRight}`);
console.log(`[verify] worker verifyPassword(wrong)   = ${okWrong}`);

const pass =
  tables.includes('agency_users') &&
  tables.includes('help_articles') &&
  userCount === 1 &&
  articleCount === 10 &&
  okRight === true &&
  okWrong === false;
console.log(`\nDRY RUN ${pass ? 'PASSED' : 'FAILED'}`);
process.exit(pass ? 0 : 1);
