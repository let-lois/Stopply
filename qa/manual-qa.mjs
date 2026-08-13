// The browser-only half of the QA list.
//
// Focus restore, tab order, and mobile layout cannot be asserted in jsdom,
// which has no layout engine and only an approximation of focus. This drives
// a real Chromium against a real production build, so what it reports is
// what a person would see.
//
// Run: npx wrangler pages dev dist --port 8788 & node qa/manual-qa.mjs
//
// It runs against the Functions rather than a static preview, because every
// page now needs a session and the session comes from the server.

import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const BASE = process.env.QA_BASE ?? 'http://localhost:8788';
const SHOTS = 'qa/screenshots';
mkdirSync(SHOTS, { recursive: true });

const results = [];
function check(name, passed, detail = '') {
  results.push({ name, passed, detail });
  console.log(`${passed ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
}

// The image ships Chromium 1194; the installed Playwright expects a newer
// build number and would otherwise try to download one. Pointing at the
// binary that is already here avoids a download this sandbox cannot make.
const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
});
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

// Anything the app logs as an error is a finding in its own right.
const consoleErrors = [];
page.on('console', (m) => {
  if (m.type() === 'error') consoleErrors.push(m.text());
});
page.on('pageerror', (e) => consoleErrors.push(String(e)));

// Sign in first. Everything below is behind a session, which is the point.
await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' });
const SEED_PASSWORD = process.env.SEED_PASSWORD ?? 'stopply-demo-password';
const loginStatus = await page.evaluate(async (password) => {
  const response = await fetch('/api/auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    credentials: 'same-origin',
    body: JSON.stringify({
      email: 'admin@letlois.example.invalid',
      password,
      turnstileToken: 'XXXX.DUMMY.TOKEN.XXXX',
    }),
  });
  return response.status;
}, SEED_PASSWORD);
check('the QA account signs in', loginStatus === 200, `status ${loginStatus}`);

await page.goto(`${BASE}/clients`, { waitUntil: 'networkidle' });
await page.waitForTimeout(600);
await page.screenshot({ path: `${SHOTS}/01-clients.png`, fullPage: true });

check('clients page renders the roster', (await page.getByText('Blue Cactus Power Washing').count()) > 0);

// QA 1: switching client shows different data.
await page.goto(`${BASE}/c/cl_roguesolar/advertising/dashboard`, { waitUntil: 'networkidle' });
await page.waitForTimeout(400);
const rogueSpend = await page.locator('.numeric-display').first().innerText();
await page.screenshot({ path: `${SHOTS}/02-advertising.png`, fullPage: true });

await page.goto(`${BASE}/c/cl_beclinical/advertising/dashboard`, { waitUntil: 'networkidle' });
await page.waitForTimeout(400);
const beclinicalSpend = await page.locator('.numeric-display').first().innerText();
check('QA1 switching client changes the numbers', rogueSpend !== beclinicalSpend, `${rogueSpend} vs ${beclinicalSpend}`);

// QA 4: a module the client has not bought.
await page.goto(`${BASE}/c/cl_allstar/logistics/dashboard`, { waitUntil: 'networkidle' });
const notEnabled = await page.getByText(/Logistics is not enabled/).count();
await page.screenshot({ path: `${SHOTS}/03-not-enabled.png`, fullPage: true });
check('QA4 an unbought module is refused explicitly', notEnabled > 0);

// QA 2: live mode is honest.
//
// Advertising is the right module to prove this on. Its data would come from
// Meta and Google Ads, neither of which is connected, so live mode has to say
// so rather than keep showing demo numbers behind a LIVE badge. That exact
// failure is what this check exists for.
await page.goto(`${BASE}/c/cl_roguesolar/settings`, { waitUntil: 'networkidle' });
await page.waitForTimeout(500);
await page.getByRole('switch', { name: /Live mode/ }).click();
await page.waitForTimeout(500);
await page.goto(`${BASE}/c/cl_roguesolar/advertising/dashboard`, { waitUntil: 'networkidle' });
await page.waitForTimeout(600);
const liveHonest = await page.getByText(/Live data is not connected/).count();
await page.screenshot({ path: `${SHOTS}/04-live-mode.png`, fullPage: true });
check('QA2 live mode says so rather than showing demo data', liveHonest > 0);

// Back to demo for the remaining checks.
await page.goto(`${BASE}/c/cl_roguesolar/settings`, { waitUntil: 'networkidle' });
await page.waitForTimeout(500);
await page.getByRole('switch', { name: /Live mode/ }).click();
await page.waitForTimeout(500);

// QA 8: filtering the canvass must not move a pin. Rogue Solar is on demo
// data, so the canvass here is the generated dataset rather than D1.
await page.goto(`${BASE}/c/cl_roguesolar/field-sales/canvass`, { waitUntil: 'networkidle' });
await page.waitForTimeout(500);
const pinBefore = await page.locator('button[aria-label*="Appointment set"]').first().boundingBox();
await page.getByRole('button', { name: 'Appointment set', exact: true }).click();
await page.waitForTimeout(300);
const pinAfter = await page.locator('button[aria-label*="Appointment set"]').first().boundingBox();
await page.screenshot({ path: `${SHOTS}/05-canvass-filtered.png`, fullPage: true });
check(
  'QA8 filtering does not move a pin',
  !!pinBefore && !!pinAfter && Math.abs(pinBefore.x - pinAfter.x) < 1 && Math.abs(pinBefore.y - pinAfter.y) < 1,
  pinBefore && pinAfter ? `${Math.round(pinBefore.x)},${Math.round(pinBefore.y)} -> ${Math.round(pinAfter.x)},${Math.round(pinAfter.y)}` : 'pin not found'
);

// Pin density. Plotting a whole client's doors into one box can put pins on
// top of each other, and a pin that intercepts another pin's click is a door
// a rep cannot tap. Measured rather than assumed.
await page.getByRole('button', { name: 'All doors' }).click();
await page.waitForTimeout(400);
const pinBoxes = await page.locator('.absolute button[aria-label*=","]').evaluateAll((nodes) =>
  nodes.map((n) => n.getBoundingClientRect()).map((r) => ({ x: r.x, y: r.y, w: r.width, h: r.height }))
);
let overlapping = 0;
for (let i = 0; i < pinBoxes.length; i++) {
  for (let j = i + 1; j < pinBoxes.length; j++) {
    const a = pinBoxes[i];
    const b = pinBoxes[j];
    if (Math.abs(a.x - b.x) < a.w * 0.6 && Math.abs(a.y - b.y) < a.h * 0.6) overlapping++;
  }
}
check(
  'canvass pins are individually clickable',
  overlapping === 0,
  `${overlapping} overlapping pairs of ${pinBoxes.length} pins`
);

// QA 14: dialog behaviour, including focus restore to the trigger.
// force: true because an overlapping pin can intercept, which is the finding
// above rather than the thing under test here.
await page.locator('.absolute button[aria-label*=","]').first().click({ force: true });
const trigger = page.getByRole('button', { name: 'Log a knock' });
await trigger.click();
await page.waitForTimeout(300);
await page.screenshot({ path: `${SHOTS}/06-log-visit-dialog.png`, fullPage: true });

const dialogOpen = await page.getByRole('dialog').count();
const focusInsideDialog = await page.evaluate(() =>
  document.querySelector('dialog')?.contains(document.activeElement) ?? false
);
check('QA14 dialog opens and takes focus', dialogOpen > 0 && focusInsideDialog);

await page.keyboard.press('Escape');
await page.waitForTimeout(300);
const closedOnEscape = (await page.getByRole('dialog').count()) === 0;
const focusRestored = await page.evaluate(
  () => document.activeElement?.textContent?.includes('Log a knock') ?? false
);
check('QA14 Escape closes it', closedOnEscape);
check('QA14 focus returns to the trigger', focusRestored);

// QA 13: keyboard reachability with a visible focus ring.
await page.goto(`${BASE}/clients`, { waitUntil: 'networkidle' });
await page.waitForTimeout(300);
let ringed = 0;
const visited = [];
for (let i = 0; i < 14; i++) {
  await page.keyboard.press('Tab');
  const info = await page.evaluate(() => {
    const el = document.activeElement;
    if (!el || el === document.body) return null;
    const style = getComputedStyle(el);
    return {
      tag: el.tagName,
      label: (el.getAttribute('aria-label') ?? el.textContent ?? '').trim().slice(0, 30),
      outline: style.outlineStyle !== 'none' && parseFloat(style.outlineWidth) > 0,
    };
  });
  if (info) {
    visited.push(`${info.tag}:${info.label}`);
    if (info.outline) ringed++;
  }
}
await page.screenshot({ path: `${SHOTS}/07-focus-ring.png`, fullPage: true });
check('QA13 tabbing reaches controls with a visible ring', ringed >= 10, `${ringed}/${visited.length} focusable had a ring`);

// Clients page card alignment. Ragged Configure buttons are the visible
// symptom of cards that size to their own content rather than to their row,
// so measure the buttons rather than eyeball the screenshot.
const configureTops = await page.getByRole('button', { name: 'Configure' }).evaluateAll((nodes) =>
  nodes.map((n) => Math.round(n.getBoundingClientRect().top))
);
const rowTops = [...new Set(configureTops)];
check(
  'client cards in a row share a baseline',
  rowTops.length <= Math.ceil(configureTops.length / 3),
  `${configureTops.length} buttons on ${rowTops.length} distinct baselines`
);

// Mobile.
// Same browser *context*, not just the same browser: browser.newPage()
// creates its own context with its own cookie jar, so a page opened that way
// is signed out and every check below would be measuring the login screen.
// That is exactly what happened the first time this ran.
// Reuse the signed-in page and shrink it, rather than opening a second one.
// browser.newPage() creates its own context with its own cookie jar, so a
// page opened that way is signed out and every check below would be
// measuring the login screen. That is exactly what happened the first time
// this ran, and it passed three checks while doing it.
const mobile = page;
await mobile.setViewportSize({ width: 390, height: 844 });
await mobile.goto(`${BASE}/c/cl_allstar/field-sales/dashboard`, { waitUntil: 'networkidle' });
await mobile.waitForTimeout(500);
const overflows = await mobile.evaluate(
  () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1
);
await mobile.screenshot({ path: `${SHOTS}/08-mobile.png`, fullPage: true });
check('mobile layout does not scroll horizontally', !overflows);

// The defect the first pass found: the sidebar sat in the flow above the
// content, so a phone scrolled past the whole navigation to reach the page.
// The page heading has to be visible without scrolling.
const headingTop = await mobile
  .locator('h1')
  .first()
  .evaluate((n) => Math.round(n.getBoundingClientRect().top));
check('mobile shows the page, not the nav, on arrival', headingTop < 844, `h1 at y=${headingTop}`);

const navHiddenAtRest = (await mobile.getByRole('link', { name: 'Clients' }).isVisible()) === false;
check('mobile hides the nav until it is asked for', navHiddenAtRest);

await mobile.getByRole('button', { name: /navigation/i }).click();
await mobile.waitForTimeout(300);
await mobile.screenshot({ path: `${SHOTS}/09-mobile-nav.png` });
check('mobile drawer opens', await mobile.getByRole('link', { name: 'Clients' }).isVisible());

await mobile.keyboard.press('Escape');
await mobile.waitForTimeout(300);
check('Escape closes the mobile drawer', !(await mobile.getByRole('link', { name: 'Clients' }).isVisible()));

await mobile.getByRole('button', { name: /navigation/i }).first().click();
await mobile.waitForTimeout(200);
await mobile.getByRole('link', { name: 'Properties' }).click();
await mobile.waitForTimeout(400);
check(
  'navigating closes the mobile drawer',
  !(await mobile.getByRole('link', { name: 'Clients' }).isVisible()) &&
    mobile.url().includes('/properties'),
  mobile.url()
);
await mobile.screenshot({ path: `${SHOTS}/10-mobile-after-nav.png`, fullPage: true });

// Two errors are expected and are not findings.
//
// The 401 is the boot session check running on /login before anyone has
// signed in; a visitor is supposed to get one, and treating it as an error
// would mean the app had to ask "am I signed in" some other way.
//
// The tunnel failure is Turnstile's script: this sandbox cannot reach
// challenges.cloudflare.com. On a real deployment it loads. Note that the
// consequence of it not loading is a disabled sign-in button, never a
// bypass: the server refuses a request with no token.
const EXPECTED = [/401 \(Unauthorized\)/, /ERR_TUNNEL_CONNECTION_FAILED/, /challenges\.cloudflare\.com/];
const unexpected = consoleErrors.filter((e) => !EXPECTED.some((p) => p.test(e)));
check(
  'no unexpected console errors during the pass',
  unexpected.length === 0,
  unexpected.slice(0, 2).join(' | ')
);

await browser.close();

const failed = results.filter((r) => !r.passed);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length > 0 ? 1 : 0);
