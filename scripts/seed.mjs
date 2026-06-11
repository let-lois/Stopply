// Seeds the control plane: the first agency_admin user, the Be Clinical
// tenant registry row placeholder, and the ten help articles.
// Run after migrate:control. Requires CONTROL_DB_ID, CF_API_TOKEN,
// CF_ACCOUNT_ID. Pass --local to seed the local wrangler database instead.
import { randomBytes, pbkdf2Sync } from 'node:crypto';
import { d1Query, requireEnv } from './lib/cf.mjs';
import { HELP_ARTICLES } from './seed-help.mjs';

function hashPassword(password) {
  const salt = randomBytes(16);
  const hash = pbkdf2Sync(password, salt, 100000, 32, 'sha256');
  return `pbkdf2$100000$${salt.toString('base64')}$${hash.toString('base64')}`;
}

const controlDbId = requireEnv('CONTROL_DB_ID');
const adminEmail = process.env.SEED_ADMIN_EMAIL ?? 'josh@letlois.com';

const existing = await d1Query(controlDbId, `SELECT id FROM agency_users WHERE email = ?`, [
  adminEmail,
]);
if (existing.length === 0) {
  const tempPassword = randomBytes(9).toString('hex');
  await d1Query(
    controlDbId,
    `INSERT INTO agency_users (id, email, name, role, password_hash, active) VALUES (?, ?, ?, 'agency_admin', ?, 1)`,
    [`au_${randomBytes(8).toString('hex')}`, adminEmail, 'LetLois Admin', hashPassword(tempPassword)]
  );
  console.log(`agency admin created: ${adminEmail}`);
  console.log(`temp password (shown once): ${tempPassword}`);
} else {
  console.log(`agency admin already exists: ${adminEmail}`);
}

for (const article of HELP_ARTICLES) {
  await d1Query(
    controlDbId,
    `INSERT INTO help_articles (id, slug, title, body_md, tags, published, updated_by)
     VALUES (?, ?, ?, ?, ?, 1, 'seed')
     ON CONFLICT (slug) DO UPDATE SET title = excluded.title, body_md = excluded.body_md, tags = excluded.tags`,
    [`ha_${randomBytes(8).toString('hex')}`, article.slug, article.title, article.body, article.tags]
  );
}
console.log(`${HELP_ARTICLES.length} help articles seeded`);
console.log('seed complete. Provision Be Clinical with: pnpm provision:tenant -- --slug beclinical --name "Be Clinical" --timezone America/Los_Angeles --plan whitelabel --admin-email admin@beclinical.com --admin-name "Be Clinical Admin"');
