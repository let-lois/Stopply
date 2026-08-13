// The outbox, against a real browser with the network genuinely cut.
//
// This is the only way to test the feature honestly. Mocking fetch to reject
// proves the code path runs; cutting the connection at the browser proves the
// thing a rep actually depends on, which is that a knock taken in a dead zone
// is still there afterwards.

import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const BASE = process.env.QA_BASE ?? 'http://localhost:8805';
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
const context = await browser.newContext({
  viewport: { width: 390, height: 844 },
  isMobile: true,
  hasTouch: true,
  geolocation: { latitude: 33.42, longitude: -111.63 },
  permissions: ['geolocation'],
});
const page = await context.newPage();

async function signIn() {
  await page.goto(`${BASE}/field`, { waitUntil: 'domcontentloaded' });
  await page.evaluate(async (password) => {
    await fetch('/api/field/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({
        email: 'marcus@allstar.example.invalid',
        password,
        turnstileToken: 'XXXX.DUMMY.TOKEN.XXXX',
      }),
    });
  }, process.env.REP_PASSWORD ?? 'test1234');
  await page.goto(`${BASE}/field`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1500);
}

await signIn();

const tally = page.locator('header .tabular-nums').first();
const startTally = Number(await tally.innerText());

// Which door we are about to knock, so we can check the server later.
const doorLabel = await page.locator('ul li button').nth(1).innerText();
const address = doorLabel.split('\n')[0];

// The dead zone.
await context.setOffline(true);
await page.waitForTimeout(300);

await page.locator('ul li button').nth(1).click();
await page.waitForTimeout(400);
const sheet = page.getByRole('dialog');
await sheet.getByRole('button', { name: 'Appointment set', exact: true }).click();
await page.waitForTimeout(1200);
await page.screenshot({ path: `${SHOTS}/24-field-offline.png` });

check(
  'a knock with no signal still closes the sheet',
  (await page.getByRole('dialog').count()) === 0
);
check(
  'the tally counts it immediately',
  Number(await tally.innerText()) === startTally + 1,
  `${startTally} -> ${await tally.innerText()}`
);
check(
  'the rep is told it is waiting to send',
  (await page.getByText(/waiting to send/).count()) > 0
);

const queuedCount = await page.evaluate(
  () =>
    new Promise((resolve) => {
      const req = indexedDB.open('stopply-field', 1);
      req.onsuccess = () => {
        const db = req.result;
        const all = db.transaction('outbox', 'readonly').objectStore('outbox').getAll();
        all.onsuccess = () => resolve(all.result.length);
        all.onerror = () => resolve(-1);
      };
      req.onerror = () => resolve(-1);
    })
);
check('the knock is on the phone, not in memory', queuedCount === 1, `${queuedCount} queued`);

// Knock two more while still offline, to prove the queue is a queue.
for (const n of [2, 3]) {
  await page.locator('ul li button').nth(n).click();
  await page.waitForTimeout(300);
  await page.getByRole('dialog').getByRole('button', { name: 'No answer', exact: true }).click();
  await page.waitForTimeout(600);
}
check('the queue accumulates', (await page.getByText(/waiting to send/).count()) > 0);

// The hard part: a reload with no connection at all. Without the service
// worker this is the browser's error page and the rep's morning is unreachable.
await page.reload({ waitUntil: 'domcontentloaded' }).catch(() => {});
await page.waitForTimeout(1500);
const survivedReload = (await page.getByText(/Stopply Field|Marcus Webb|waiting to send/).count()) > 0;
await page.screenshot({ path: `${SHOTS}/25-field-offline-reload.png` });
check('the app still opens with no connection', survivedReload);

const stillQueued = await page.evaluate(
  () =>
    new Promise((resolve) => {
      const req = indexedDB.open('stopply-field', 1);
      req.onsuccess = () => {
        const db = req.result;
        const all = db.transaction('outbox', 'readonly').objectStore('outbox').getAll();
        all.onsuccess = () => resolve(all.result.length);
        all.onerror = () => resolve(-1);
      };
      req.onerror = () => resolve(-1);
    })
);
check('the knocks survive a reload with no connection', stillQueued === 3, `${stillQueued} queued`);

// Signal comes back.
await context.setOffline(false);
await page.waitForTimeout(500);
// The reload above may have left the page uncontrolled; reload once online so
// the app is running, then let the drain triggers fire.
await page.goto(`${BASE}/field`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(4000);
await page.screenshot({ path: `${SHOTS}/26-field-drained.png` });

const drained = await page.evaluate(
  () =>
    new Promise((resolve) => {
      const req = indexedDB.open('stopply-field', 1);
      req.onsuccess = () => {
        const db = req.result;
        const all = db.transaction('outbox', 'readonly').objectStore('outbox').getAll();
        all.onsuccess = () => resolve(all.result.length);
        all.onerror = () => resolve(-1);
      };
      req.onerror = () => resolve(-1);
    })
);
check('the queue drains when signal returns', drained === 0, `${drained} left`);
check('the waiting badge clears', (await page.getByText(/waiting to send/).count()) === 0);

// And the server actually has it.
const onServer = await page.evaluate(async (addr) => {
  const r = await fetch('/api/field/doors', { credentials: 'same-origin' });
  const data = await r.json();
  const door = data.properties.find((p) => p.address === addr);
  return door ? door.disposition : null;
}, address);
check(
  'the server holds the knock taken in the dead zone',
  onServer === 'appointment_set',
  `${address} is ${onServer}`
);

await browser.close();
const failed = results.filter((r) => !r.passed);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length > 0 ? 1 : 0);
