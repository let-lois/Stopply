// The browser-only half of the QA list.
//
// Focus restore, tab order, and mobile layout cannot be asserted in jsdom,
// which has no layout engine and only an approximation of focus. This drives
// a real Chromium against a real production build, so what it reports is
// what a person would see.
//
// Run: npx vite preview --port 4173 & node qa/manual-qa.mjs

import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const BASE = 'http://localhost:4173';
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

await page.goto(`${BASE}/clients`, { waitUntil: 'networkidle' });
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
await page.goto(`${BASE}/c/cl_allstar/settings`, { waitUntil: 'networkidle' });
await page.getByRole('switch', { name: /Live mode/ }).click();
await page.goto(`${BASE}/c/cl_allstar/field-sales/dashboard`, { waitUntil: 'networkidle' });
await page.waitForTimeout(400);
const liveHonest = await page.getByText(/Live data is not connected/).count();
await page.screenshot({ path: `${SHOTS}/04-live-mode.png`, fullPage: true });
check('QA2 live mode says so rather than showing demo data', liveHonest > 0);

// Back to demo for the remaining checks.
await page.goto(`${BASE}/c/cl_allstar/settings`, { waitUntil: 'networkidle' });
await page.getByRole('switch', { name: /Live mode/ }).click();

// QA 8: filtering the canvass must not move a pin.
await page.goto(`${BASE}/c/cl_allstar/field-sales/canvass`, { waitUntil: 'networkidle' });
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
const mobile = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true });
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

check('no console errors during the pass', consoleErrors.length === 0, consoleErrors.slice(0, 2).join(' | '));

await browser.close();

const failed = results.filter((r) => !r.passed);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length > 0 ? 1 : 0);
