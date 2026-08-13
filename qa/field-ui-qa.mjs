// The rep app on a phone.
//
// Everything here is a property that only exists at 390px with a thumb: touch
// target sizes, the primary actions sitting low, no horizontal scroll, and the
// one irreversible action being hard to hit by accident.

import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const BASE = process.env.QA_BASE ?? 'http://localhost:8803';
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
// An iPhone-sized viewport with a real touch surface and a location fix inside
// the seeded territory.
const context = await browser.newContext({
  viewport: { width: 390, height: 844 },
  isMobile: true,
  hasTouch: true,
  deviceScaleFactor: 3,
  geolocation: { latitude: 33.42, longitude: -111.63 },
  permissions: ['geolocation'],
});
const page = await context.newPage();

const consoleErrors = [];
page.on('pageerror', (e) => consoleErrors.push(String(e)));

await page.goto(`${BASE}/field`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(1200);
await page.screenshot({ path: `${SHOTS}/20-field-login.png` });

check('a signed-out rep gets the field sign-in, not the dashboard one', 
  (await page.getByText('Stopply Field').count()) > 0 &&
  (await page.getByText('Operations platform').count()) === 0);

const loginStatus = await page.evaluate(async (password) => {
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
check('the rep signs in', loginStatus === 200, `status ${loginStatus}`);

await page.goto(`${BASE}/field`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(1800);
await page.screenshot({ path: `${SHOTS}/21-field-today.png` });

check('the rep sees their own name and territory', 
  (await page.getByText('Marcus Webb').count()) > 0 &&
  (await page.getByText('East Mesa North').count()) > 0);

const overflows = await page.evaluate(
  () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1
);
check('nothing scrolls sideways', !overflows);

// Doors ordered by distance, which is the entire reason the list exists.
const distances = await page.locator('ul li button span.tabular-nums').allInnerTexts();
const parsed = distances.map((d) => (d.includes('mi') ? parseFloat(d) * 5280 : parseFloat(d)));
const sorted = parsed.every((d, i) => i === 0 || d >= parsed[i - 1] - 1);
check('doors are ordered by distance from the rep', sorted && parsed.length > 3, distances.slice(0, 3).join(', '));

// Touch targets. 44px is the published floor; this app is used outdoors with
// one hand, so the bar is higher and worth measuring rather than trusting.
const small = await page.locator('button').evaluateAll((nodes) =>
  nodes
    .map((n) => ({ h: n.getBoundingClientRect().height, label: (n.textContent ?? n.getAttribute('aria-label') ?? '').trim().slice(0, 24) }))
    .filter((b) => b.h > 0 && b.h < 44)
);
check('every control is at least 44px tall', small.length === 0, small.map((s) => `${s.label}:${Math.round(s.h)}`).join(', '));

await page.locator('ul li button').first().click();
await page.waitForTimeout(600);
await page.screenshot({ path: `${SHOTS}/22-field-knock.png` });

check('tapping a door opens the knock sheet', (await page.getByRole('dialog').count()) > 0);

// Scoped to the sheet. A door row's accessible name contains its outcome, so
// an unscoped "No answer" matches half the list.
const sheet = page.getByRole('dialog');

// The outcome buttons have to sit in the thumb's arc, not under the notch.
const outcomeTop = await sheet.getByRole('button', { name: 'No answer', exact: true }).evaluate((n) => n.getBoundingClientRect().top);
check('the outcome buttons sit in the lower half of the screen', outcomeTop > 422, `top at ${Math.round(outcomeTop)}px of 844`);

// Do not knock is sticky and cannot be undone from the app, so it must not be
// reachable by one stray tap among six pastel buttons.
const dnkDirect = await sheet.getByRole('button', { name: 'Yes, do not knock' }).count();
check('do not knock is not one tap away', dnkDirect === 0);

await sheet.getByRole('button', { name: 'Do not knock', exact: true }).click();
await page.waitForTimeout(300);
check(
  'do not knock asks again, and says it is permanent',
  (await sheet.getByRole('button', { name: 'Yes, do not knock' }).count()) > 0 &&
    (await sheet.getByText(/permanently/).count()) > 0
);
await sheet.getByRole('button', { name: 'Cancel' }).click();
await page.waitForTimeout(300);

// Log a real knock and see it land.
// The count, not the label beside it: getByText(/knocked today/) matches the
// words and never changes.
const tally = page.locator('header .tabular-nums').first();
const before = await tally.innerText();
await sheet.getByRole('button', { name: 'Interested', exact: true }).click();
await page.waitForTimeout(1200);
const after = await tally.innerText();
check(
  'logging a knock updates the day tally immediately',
  Number(after) === Number(before) + 1,
  `${before} -> ${after}`
);
await page.screenshot({ path: `${SHOTS}/23-field-after-knock.png` });

check('no page errors', consoleErrors.length === 0, consoleErrors.slice(0, 1).join(''));

await browser.close();
const failed = results.filter((r) => !r.passed);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length > 0 ? 1 : 0);
