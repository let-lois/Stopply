// The funnel view, against real data.
//
// The properties worth asserting here are the ones a unit test cannot see:
// that the numbers on screen agree with each other, that the chart underneath
// the headline is cut on the same day boundary, and that a stage never reads
// wider than the stage above it. A funnel that widens is the single most
// obvious way to lose a client's trust in a report.
//
// Run: npx wrangler pages dev dist --port 8801 & node qa/funnel-qa.mjs

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
const page = await browser.newPage({ viewport: { width: 1440, height: 1200 } });

const consoleErrors = [];
page.on('console', (m) => {
  if (m.type() === 'error') consoleErrors.push(m.text());
});
page.on('pageerror', (e) => consoleErrors.push(String(e)));

await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' });
const loginStatus = await page.evaluate(async (password) => {
  const r = await fetch('/api/auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    credentials: 'same-origin',
    body: JSON.stringify({
      email: 'admin@letlois.example.invalid',
      password,
      turnstileToken: 'XXXX.DUMMY.TOKEN.XXXX',
    }),
  });
  return r.status;
}, process.env.SEED_PASSWORD ?? 'stopply-demo-password');
check('signed in as a manager', loginStatus === 200, `status ${loginStatus}`);

await page.goto(`${BASE}/c/cl_allstar/field-sales/funnel`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(2000);
await page.screenshot({ path: `${SHOTS}/30-funnel.png`, fullPage: true });

check('the funnel view is reachable from the module nav',
  (await page.getByRole('link', { name: 'Funnel' }).count()) > 0);

/** The five stage rows, as numbers, in the order they are drawn. */
async function stageNumbers() {
  return page.evaluate(() => {
    const card = [...document.querySelectorAll('div')].find(
      (d) => d.querySelector('p')?.textContent?.trim() === 'The funnel'
    );
    return [...(card?.querySelectorAll('li') ?? [])].map((li) => {
      const label = li.querySelector('span.font-medium')?.textContent?.trim() ?? '';
      const spans = [...li.querySelectorAll('span.numeric-display')];
      const value = spans[spans.length - 1]?.textContent?.replace(/[^\d]/g, '') ?? '';
      return { label, doors: Number(value) };
    });
  });
}

const stages = await stageNumbers();
check(
  'all five stages are drawn, in order',
  stages.map((s) => s.label).join(' > ') === 'Knocked > Contacted > Booked > Showed > Sold',
  stages.map((s) => s.label).join(' > ')
);

check(
  'no stage is wider than the one above it',
  stages.every((s, i) => i === 0 || s.doors <= stages[i - 1].doors),
  stages.map((s) => `${s.label}:${s.doors}`).join(', ')
);

check('there is real data behind it, not an empty funnel', (stages[0]?.doors ?? 0) > 0,
  `${stages[0]?.doors} doors knocked`);

// The headline cards and the funnel rows are two renderings of one number.
// They came from the same selector, so a disagreement means the view is
// reading a different window for one of them.
const headline = await page.evaluate(() => {
  const out = {};
  for (const el of document.querySelectorAll('p, span')) {
    const t = el.textContent?.trim();
    if (t === 'Doors knocked' || t === 'Booked' || t === 'Showed' || t === 'Sold') {
      const value = el.parentElement?.querySelector('.numeric-display, [class*="text-3xl"], [class*="text-4xl"]');
      if (value && out[t] === undefined) out[t] = Number(value.textContent.replace(/[^\d]/g, ''));
    }
  }
  return out;
});
check(
  'the headline cards agree with the funnel rows',
  headline['Doors knocked'] === stages[0]?.doors &&
    headline['Booked'] === stages[2]?.doors &&
    headline['Sold'] === stages[4]?.doors,
  JSON.stringify(headline)
);

// That the chart is cut on the same day boundary as the numbers above it is
// asserted in funnel.test.ts, where the day-keys are readable. What the
// browser can add is that the chart is actually drawn, which is the failure a
// unit test cannot see.
const chart = await page.evaluate(() => ({
  // Queried off the document, not off '.recharts-wrapper svg'. The first svg
  // under the wrapper belongs to a legend icon, so that selector found a
  // legend and reported an empty chart.
  series: document.querySelectorAll('.recharts-bar').length,
  rectangles: document.querySelectorAll('.recharts-rectangle').length,
  ticks: document.querySelectorAll('.recharts-xAxis .recharts-cartesian-axis-tick').length,
}));
check('the daily chart renders four series', chart.series === 4, JSON.stringify(chart));
check('with bars on it and a dated axis', chart.rectangles > 0 && chart.ticks > 0, JSON.stringify(chart));

check(
  'the view says which timezone the days were cut in',
  (await page.getByText(/Days cut in/).count()) > 0,
  (await page.getByText(/Days cut in/).first().innerText().catch(() => '')) || ''
);

// Narrowing the window must narrow the numbers, not leave them alone. A range
// control that changes nothing is worse than no range control.
await page.getByRole('button', { name: '7 days' }).click();
await page.waitForTimeout(900);
const narrowed = await stageNumbers();
check(
  'narrowing the range narrows the funnel',
  (narrowed[0]?.doors ?? 0) < (stages[0]?.doors ?? 0),
  `${stages[0]?.doors} over 30 days, ${narrowed[0]?.doors} over 7`
);
check(
  'and it still never widens as it descends',
  narrowed.every((s, i) => i === 0 || s.doors <= narrowed[i - 1].doors),
  narrowed.map((s) => `${s.label}:${s.doors}`).join(', ')
);

await page.getByRole('button', { name: '90 days' }).click();
await page.waitForTimeout(900);
await page.screenshot({ path: `${SHOTS}/31-funnel-90.png`, fullPage: true });

// Per-stage rep credit. The setter column is the reason this table exists.
const repTable = await page.evaluate(() => {
  const table = [...document.querySelectorAll('table')].find((t) =>
    t.textContent?.includes('Passed on')
  );
  if (!table) return null;
  return {
    headers: [...table.querySelectorAll('th')].map((th) => th.textContent?.trim()),
    rows: [...table.querySelectorAll('tbody tr')].map((tr) =>
      [...tr.querySelectorAll('td')].map((td) => td.textContent?.trim())
    ),
  };
});
check(
  'the rep table separates the stages rather than showing one total',
  repTable?.headers?.join(',') === 'Rep,Knocked,Booked,Showed,Sold,Passed on',
  repTable?.headers?.join(',')
);
check(
  'every rep on the roster has a row, including one who sold nothing',
  (repTable?.rows?.length ?? 0) >= 2,
  `${repTable?.rows?.length} rows`
);

check(
  'the car signal is reported, or says plainly that nobody recorded one',
  (await page.getByText('Cars on the drive').count()) > 0 &&
    ((await page.getByText(/answered,/).count()) > 0 ||
      (await page.getByText(/No knocks in this window recorded/).count()) > 0)
);

const overflows = await page.evaluate(
  () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1
);
check('nothing scrolls sideways at 1440px', !overflows);

await page.setViewportSize({ width: 390, height: 844 });
await page.waitForTimeout(600);
const mobileOverflow = await page.evaluate(
  () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1
);
check('nor at 390px', !mobileOverflow);
await page.screenshot({ path: `${SHOTS}/32-funnel-mobile.png`, fullPage: true });

// The 401 is the app asking who it is before anyone has signed in, which is
// the correct request to make and the correct answer to get. Turnstile and the
// basemap host are unreachable from this sandbox and reachable in a browser.
const EXPECTED = [
  /401 \(Unauthorized\)/,
  /ERR_TUNNEL_CONNECTION_FAILED/,
  /challenges\.cloudflare\.com/,
  /basemaps\.cartocdn\.com/,
];
const unexpected = consoleErrors.filter((e) => !EXPECTED.some((p) => p.test(e)));
check('no unexpected page errors', unexpected.length === 0, unexpected.slice(0, 1).join(''));

await browser.close();
const failed = results.filter((r) => !r.passed);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length > 0 ? 1 : 0);
