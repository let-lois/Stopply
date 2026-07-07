// CLI wrapper around the provisioning API for local and ops use.
// Usage:
//   API_BASE=https://bi.letlois.com SESSION_COOKIE=... CSRF_TOKEN=... \
//   pnpm provision:tenant -- --slug acme --name "Acme Plumbing" \
//     --admin-email owner@acme.com --admin-name "Pat Owner" \
//     [--timezone America/Phoenix] [--plan starter] \
//     [--budget 5000] [--platforms meta,google]
function arg(name, fallback = undefined) {
  const i = process.argv.indexOf(`--${name}`);
  if (i === -1) return fallback;
  return process.argv[i + 1];
}

const base = process.env.API_BASE ?? 'http://localhost:8787';
const cookie = process.env.SESSION_COOKIE;
const csrf = process.env.CSRF_TOKEN;
if (!cookie || !csrf) {
  console.error('set SESSION_COOKIE and CSRF_TOKEN (log in as agency_admin first)');
  process.exit(1);
}

const body = {
  slug: arg('slug'),
  name: arg('name'),
  adminEmail: arg('admin-email'),
  adminName: arg('admin-name'),
};
const timezone = arg('timezone');
const plan = arg('plan');
const budget = arg('budget');
const platforms = arg('platforms');
if (timezone) body.timezone = timezone;
if (plan) body.plan = plan;
if (budget) body.monthlyAdSpendBudget = Number(budget);
if (platforms) body.adPlatforms = platforms.split(',').map((p) => p.trim()).filter(Boolean);

if (!body.slug || !body.name || !body.adminEmail || !body.adminName) {
  console.error('required: --slug --name --admin-email --admin-name');
  process.exit(1);
}

const res = await fetch(`${base}/api/agency/tenants`, {
  method: 'POST',
  headers: {
    'content-type': 'application/json',
    cookie,
    'x-csrf-token': csrf,
  },
  body: JSON.stringify(body),
});
const json = await res.json();
if (!res.ok) {
  console.error(`provisioning failed (${res.status}):`, JSON.stringify(json, null, 2));
  process.exit(1);
}
console.log('tenant provisioned:');
console.log(JSON.stringify(json, null, 2));
if (json.tempPassword) {
  console.log('\nTemp admin password (shown once, store it now):', json.tempPassword);
}
