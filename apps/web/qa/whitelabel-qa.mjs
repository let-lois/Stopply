// The white-label promise, checked rather than asserted.
//
// The promise is one sentence: a client never sees Stopply. That is trivial to
// state, easy to satisfy on the page somebody looked at, and easy to break on
// the one they did not. So this signs in as a real client-scoped account,
// walks every route that account can reach, and fails on the word or the mark
// appearing anywhere in the rendered document.
//
// It checks the tab as well as the page. A workspace can be perfectly branded
// on screen and still say Stopply in the title, which is where the eye goes
// with six tabs open.
//
// Run: npx wrangler pages dev dist --port 8801 & node qa/whitelabel-qa.mjs

import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const BASE = process.env.QA_BASE ?? 'http://localhost:8801';
const SHOTS = 'qa/screenshots';
mkdirSync(SHOTS, { recursive: true });

const results = [];
const check = (name, passed, detail = '') => {
  results.push({ name, passed });
  console.log(`${passed ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
};

const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
});

async function signIn(page, email, password) {
  await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' });
  return page.evaluate(
    async ([e, p]) => {
      const r = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ email: e, password: p, turnstileToken: 'XXXX.DUMMY.TOKEN.XXXX' }),
      });
      return r.status;
    },
    [email, password]
  );
}

/**
 * Everywhere the agency's name could surface on a rendered page.
 *
 * Deliberately more than the visible text. An alt attribute, a title, an aria
 * label and the tab are all places a reader meets a brand, and the first three
 * are exactly the ones a visual check misses.
 */
async function brandLeaks(page) {
  return page.evaluate(() => {
    const leaks = [];
    const needle = /stopply/i;

    if (needle.test(document.title)) leaks.push(`title: ${document.title}`);
    if (needle.test(document.body.innerText)) {
      const line = document.body.innerText
        .split('\n')
        .find((l) => needle.test(l));
      leaks.push(`text: ${line?.trim().slice(0, 60)}`);
    }

    for (const el of document.querySelectorAll('*')) {
      for (const attr of ['alt', 'title', 'aria-label', 'placeholder']) {
        const value = el.getAttribute(attr);
        if (value && needle.test(value)) leaks.push(`${attr}: ${value.slice(0, 50)}`);
      }
    }

    // The Stopply artwork, by the file it is served from. A client-branded
    // page must not reach for it even where no text names it.
    for (const img of document.querySelectorAll('img')) {
      if (/icon-\d+\.png|stopply-logo/.test(img.getAttribute('src') ?? '')) {
        leaks.push(`img: ${img.getAttribute('src')}`);
      }
    }
    for (const link of document.querySelectorAll('link[rel="icon"]')) {
      if (/icon-\d+\.png|stopply-logo/.test(link.getAttribute('href') ?? '')) {
        leaks.push(`favicon: ${link.getAttribute('href')}`);
      }
    }

    return [...new Set(leaks)];
  });
}

// ---------------------------------------------------------------------------
// The agency's own front door keeps its name.
// ---------------------------------------------------------------------------

const agencyPage = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const consoleErrors = [];
agencyPage.on('console', (m) => {
  if (m.type() === 'error') consoleErrors.push(m.text());
});
agencyPage.on('pageerror', (e) => consoleErrors.push(String(e)));

await agencyPage.goto(`${BASE}/login`, { waitUntil: 'networkidle' });
await agencyPage.screenshot({ path: `${SHOTS}/60-login.png` });
check(
  'sign-in says who powers it',
  (await agencyPage.getByText('Powered by Stopply').count()) > 0
);

const agencyStatus = await signIn(
  agencyPage,
  'admin@letlois.example.invalid',
  process.env.SEED_PASSWORD ?? 'stopply-demo-password'
);
check('the agency admin signs in', agencyStatus === 200, `status ${agencyStatus}`);

await agencyPage.goto(`${BASE}/clients`, { waitUntil: 'domcontentloaded' });
await agencyPage.waitForTimeout(1200);
check(
  'the agency still sees its own product on its own pages',
  (await agencyPage.getByRole('banner').getByText('Stopply').count()) > 0 &&
    (await agencyPage.title()) === 'Stopply'
);

// Inside a client, even an agency admin sees the client. They are looking at
// the client's product, not at ours.
await agencyPage.goto(`${BASE}/c/cl_allstar/field-sales/dashboard`, {
  waitUntil: 'domcontentloaded',
});
await agencyPage.waitForTimeout(1500);
const inWorkspace = await brandLeaks(agencyPage);
check(
  'a workspace wears the client even for an agency admin',
  inWorkspace.length === 0 &&
    (await agencyPage.getByRole('banner').getByText('Allstar Home Solutions').count()) > 0,
  inWorkspace.slice(0, 2).join(' | ')
);
await agencyPage.screenshot({ path: `${SHOTS}/61-workspace-agency-admin.png` });

// ---------------------------------------------------------------------------
// The client, everywhere they can go.
// ---------------------------------------------------------------------------

const clientContext = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
const clientPage = await clientContext.newPage();
clientPage.on('pageerror', (e) => consoleErrors.push(String(e)));

const clientStatus = await signIn(
  clientPage,
  'admin@allstar.example.invalid',
  process.env.SEED_PASSWORD ?? 'stopply-demo-password'
);
check('the client admin signs in', clientStatus === 200, `status ${clientStatus}`);

// Signing in must not land them on the agency's client list, which refuses
// them: a white label that opens on an error page is not a white label.
await clientPage.goto(`${BASE}/login`, { waitUntil: 'networkidle' });
await clientPage.evaluate(
  async ([e, p]) => {
    await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({ email: e, password: p, turnstileToken: 'XXXX.DUMMY.TOKEN.XXXX' }),
    });
  },
  ['admin@allstar.example.invalid', process.env.SEED_PASSWORD ?? 'stopply-demo-password']
);
await clientPage.getByLabel('Email').fill('admin@allstar.example.invalid');
await clientPage.getByLabel('Password').fill(process.env.SEED_PASSWORD ?? 'stopply-demo-password');
await clientPage.waitForTimeout(300);

const CLIENT_ROUTES = [
  ['workspace root', '/c/cl_allstar'],
  ['dashboard', '/c/cl_allstar/field-sales/dashboard'],
  ['funnel', '/c/cl_allstar/field-sales/funnel'],
  ['canvass', '/c/cl_allstar/field-sales/canvass'],
  ['properties', '/c/cl_allstar/field-sales/properties'],
  ['territories', '/c/cl_allstar/field-sales/territories'],
  ['workspace settings', '/c/cl_allstar/settings'],
  ['team', '/team'],
  ['activity', '/audit'],
  ['credentials', '/credentials'],
  // Pages they are refused. The refusal itself must not be branded ours.
  ['clients (refused)', '/clients'],
  ['platform settings (refused)', '/settings'],
  ['a route that does not exist', '/c/cl_allstar/nonsense/view'],
];

const allLeaks = [];
for (const [name, path] of CLIENT_ROUTES) {
  await clientPage.goto(`${BASE}${path}`, { waitUntil: 'domcontentloaded' });
  await clientPage.waitForTimeout(1200);
  for (const leak of await brandLeaks(clientPage)) allLeaks.push(`${name}: ${leak}`);
}

check(
  'a client sees no trace of Stopply on any page they can reach',
  allLeaks.length === 0,
  allLeaks.slice(0, 4).join(' | ')
);

await clientPage.goto(`${BASE}/c/cl_allstar/field-sales/dashboard`, {
  waitUntil: 'domcontentloaded',
});
await clientPage.waitForTimeout(1200);
check(
  'the tab carries the company, not the platform',
  (await clientPage.title()) === 'Allstar Home Solutions',
  await clientPage.title()
);

const nav = await clientPage.evaluate(() =>
  [...document.querySelectorAll('aside a')].map((a) => a.textContent?.trim())
);
check(
  'the client is not offered the agency console',
  !nav.includes('Clients') && !nav.includes('Settings'),
  nav.join(', ')
);
await clientPage.screenshot({ path: `${SHOTS}/62-workspace-client-admin.png`, fullPage: true });

// ---------------------------------------------------------------------------
// Uploading a mark, and it reaching every surface.
// ---------------------------------------------------------------------------

// A 1x1 PNG is enough: what is being checked is that the value travels, is
// stored, and comes back on the pages that draw it.
const TINY_PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

const saved = await clientPage.evaluate(async (logo) => {
  const r = await fetch('/api/clients/cl_allstar/logo', {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    credentials: 'same-origin',
    body: JSON.stringify({ logo }),
  });
  return r.status;
}, TINY_PNG);
check('a client admin can set their own logo', saved === 200, `status ${saved}`);

const refusedType = await clientPage.evaluate(async () => {
  const r = await fetch('/api/clients/cl_allstar/logo', {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    credentials: 'same-origin',
    body: JSON.stringify({ logo: 'data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=' }),
  });
  return { status: r.status, body: await r.text() };
});
check(
  'the server refuses a type the picker would not offer',
  refusedType.status === 400 && /PNG, JPEG or WebP/.test(refusedType.body),
  `${refusedType.status} ${refusedType.body.slice(0, 80)}`
);

const refusedSize = await clientPage.evaluate(async () => {
  const huge = `data:image/png;base64,${'A'.repeat(120 * 1024)}`;
  const r = await fetch('/api/clients/cl_allstar/logo', {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    credentials: 'same-origin',
    body: JSON.stringify({ logo: huge }),
  });
  return r.status;
});
check('and one over the ceiling', refusedSize === 400, `status ${refusedSize}`);

await clientPage.goto(`${BASE}/c/cl_allstar/field-sales/dashboard`, {
  waitUntil: 'domcontentloaded',
});
await clientPage.waitForTimeout(1400);
const wearing = await clientPage.evaluate(() => ({
  header: document.querySelector('header img')?.getAttribute('src')?.slice(0, 24) ?? null,
  favicon: document.querySelector('link[rel="icon"]')?.getAttribute('href')?.slice(0, 24) ?? null,
}));
check(
  'the uploaded mark reaches the header and the tab',
  wearing.header?.startsWith('data:image/png') === true &&
    wearing.favicon?.startsWith('data:image/png') === true,
  JSON.stringify(wearing)
);

// A workspace from another agency client must not be reachable, logo route
// included: this is a write endpoint that takes a client id in the URL.
const foreign = await clientPage.evaluate(async () => {
  const r = await fetch('/api/clients/cl_roguesolar/logo', {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    credentials: 'same-origin',
    body: JSON.stringify({ logo: null }),
  });
  return r.status;
});
check(
  'a client cannot set another client logo',
  foreign === 404,
  `got ${foreign}`
);

// Put it back, so the harness leaves the database as it found it.
await clientPage.evaluate(async () => {
  await fetch('/api/clients/cl_allstar/logo', {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    credentials: 'same-origin',
    body: JSON.stringify({ logo: null }),
  });
});

// ---------------------------------------------------------------------------
// The rep app, which is the client's staff holding the client's product.
// ---------------------------------------------------------------------------

const phone = await browser.newContext({
  viewport: { width: 390, height: 844 },
  isMobile: true,
  hasTouch: true,
  geolocation: { latitude: 33.97, longitude: -117.38 },
  permissions: ['geolocation'],
});
const rep = await phone.newPage();
await rep.goto(`${BASE}/field`, { waitUntil: 'domcontentloaded' });
await rep.waitForTimeout(800);
check('the rep sign-in says who powers it', (await rep.getByText('Powered by Stopply').count()) > 0);

const repStatus = await rep.evaluate(async (password) => {
  const r = await fetch('/api/field/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    credentials: 'same-origin',
    body: JSON.stringify({
      email: 'marcus@allstar.example.invalid',
      password,
      turnstileToken: 'XXXX.DUMMY.TOKEN.XXXX',
    }),
  });
  return r.status;
}, process.env.REP_PASSWORD ?? 'test1234');
check('the rep signs in', repStatus === 200, `status ${repStatus}`);

await rep.goto(`${BASE}/field`, { waitUntil: 'domcontentloaded' });
await rep.waitForTimeout(1800);
const repLeaks = await brandLeaks(rep);
check(
  'a signed-in rep sees their employer, not us',
  repLeaks.length === 0 && (await rep.title()) === 'Allstar Home Solutions',
  `${await rep.title()} | ${repLeaks.slice(0, 2).join(' | ')}`
);
await rep.screenshot({ path: `${SHOTS}/63-field-branded.png` });
await phone.close();

const EXPECTED = [
  /401 \(Unauthorized\)/,
  /403 \(Forbidden\)/,
  /404 \(Not Found\)/,
  /400 \(Bad Request\)/,
  /ERR_TUNNEL_CONNECTION_FAILED/,
  /challenges\.cloudflare\.com/,
  /basemaps\.cartocdn\.com/,
];
const unexpected = consoleErrors.filter((e) => !EXPECTED.some((p) => p.test(e)));
check('no unexpected page errors', unexpected.length === 0, unexpected.slice(0, 2).join(' | '));

await browser.close();
const failed = results.filter((r) => !r.passed);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length > 0 ? 1 : 0);
