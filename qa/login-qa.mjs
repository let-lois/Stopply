// The sign-in flow, in a real browser against a real workerd.
//
// The Turnstile widget cannot load in this sandbox: the network policy blocks
// challenges.cloudflare.com, which is the same reason the server's verifier
// is pointed at a local stub for these runs. So this drives the flow the way
// the app does, and checks the two things a browser can prove and a unit test
// cannot: that a signed-out visitor is sent to sign-in rather than shown an
// empty shell, and that the session cookie is never visible to script.

import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const BASE = 'http://localhost:8788';
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
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

await page.goto(`${BASE}/clients`, { waitUntil: 'networkidle' });
await page.waitForTimeout(600);
await page.screenshot({ path: `${SHOTS}/11-signed-out.png`, fullPage: true });

check('a signed-out visitor lands on sign-in', page.url().includes('/login'), page.url());
check('the sign-in form is there', (await page.getByLabel('Email').count()) > 0);
check(
  'no dashboard is drawn behind it',
  (await page.getByRole('link', { name: 'Clients' }).count()) === 0
);

// Sign in the way the app does, then reload so the SPA boots from the cookie.
const signedIn = await page.evaluate(async () => {
  const response = await fetch('/api/auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    credentials: 'same-origin',
    body: JSON.stringify({
      email: 'admin@letlois.example.invalid',
      password: 'stopply-demo-password',
      turnstileToken: 'XXXX.DUMMY.TOKEN.XXXX',
    }),
  });
  return response.status;
});
check('the login endpoint accepts the seeded account', signedIn === 200, `status ${signedIn}`);

const cookieVisible = await page.evaluate(() => document.cookie);
check(
  'the session cookie is invisible to script',
  !cookieVisible.includes('stopply_session'),
  cookieVisible || '(document.cookie is empty)'
);

await page.goto(`${BASE}/clients`, { waitUntil: 'networkidle' });
await page.waitForTimeout(800);
await page.screenshot({ path: `${SHOTS}/12-signed-in-clients.png`, fullPage: true });

check(
  'the workspace list comes from the server',
  (await page.getByText('Allstar Home Solutions').count()) > 0 &&
    (await page.getByText('Rogue Solar').count()) > 0
);

await page.goto(`${BASE}/c/cl_allstar/field-sales/dashboard`, { waitUntil: 'networkidle' });
await page.waitForTimeout(1000);
await page.screenshot({ path: `${SHOTS}/13-live-field-sales.png`, fullPage: true });

const knocks = await page.locator('.numeric-display').first().innerText();
check('field sales renders live data from D1', Number(knocks.replace(/\D/g, '')) > 0, `knocks: ${knocks}`);

await page.goto(`${BASE}/audit`, { waitUntil: 'networkidle' });
await page.waitForTimeout(600);
await page.screenshot({ path: `${SHOTS}/14-audit.png`, fullPage: true });
check('the audit trail renders server entries', (await page.getByText(/Logged|Stored|Created/).count()) > 0);

await page.goto(`${BASE}/credentials`, { waitUntil: 'networkidle' });
await page.waitForTimeout(600);
const html = await page.content();
await page.screenshot({ path: `${SHOTS}/15-credentials.png`, fullPage: true });
check(
  'the credentials page has no reveal control and no secret input',
  !/reveal/i.test(html) && (await page.locator('input[type="password"]').count()) === 0
);
check(
  'no copy claims encryption, a vault, or security',
  !/\b(encrypted|vault|secure)\b/i.test(await page.locator('main').innerText())
);

await browser.close();
const failed = results.filter((r) => !r.passed);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length > 0 ? 1 : 0);
