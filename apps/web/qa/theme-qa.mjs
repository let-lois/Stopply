// Both themes, in a real browser.
//
// A light theme fails quietly. Nothing throws, nothing 500s, and the page
// still renders; some text is just the same colour as what is behind it. So
// most of this file measures contrast rather than looking for errors, and it
// walks every view rather than trusting that one page proves the palette.
//
// Run: npx wrangler pages dev dist --port 8801 & node qa/theme-qa.mjs

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
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
const page = await context.newPage();

const consoleErrors = [];
page.on('console', (m) => {
  if (m.type() === 'error') consoleErrors.push(m.text());
});
page.on('pageerror', (e) => consoleErrors.push(String(e)));

// WCAG relative luminance and contrast ratio, run inside the page so it reads
// the colours the browser actually computed rather than the ones the source
// asked for.
// WCAG relative luminance and contrast ratio, run inside the page.
//
// Every colour is resolved through a canvas rather than parsed out of the
// string. The palette is written in oklch, and getComputedStyle hands back
// `oklch(0.97 0.005 265)` verbatim for those, so pulling the numbers out with
// a regex reads lightness as red and hue as blue. The first version of this
// file did exactly that and reported every element in both themes at 1:1,
// which is not a contrast failure, it is a measurement failure.
//
// Painting the colour on a 1x1 canvas also composites translucency for free,
// which matters because most of the fills here are translucent by design and
// their real colour is whatever they are sitting on.
const CONTRAST_HELPERS = `
  const _cvs = document.createElement('canvas');
  _cvs.width = _cvs.height = 1;
  const _ctx = _cvs.getContext('2d', { willReadFrequently: true });

  /** Any CSS colour, composited over a stack of grounds, as sRGB. */
  function solid(colors) {
    _ctx.clearRect(0, 0, 1, 1);
    // White underneath, because a page is ultimately painted on the canvas
    // colour and a fully transparent stack has to resolve to something.
    _ctx.fillStyle = '#ffffff';
    _ctx.fillRect(0, 0, 1, 1);
    for (const color of colors) {
      _ctx.fillStyle = color;
      _ctx.fillRect(0, 0, 1, 1);
    }
    const d = _ctx.getImageData(0, 0, 1, 1).data;
    return { r: d[0], g: d[1], b: d[2] };
  }

  function lum({ r, g, b }) {
    const f = (v) => {
      const s = v / 255;
      return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
    };
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
  }

  function ratio(fg, bg) {
    const a = lum(fg), b = lum(bg);
    return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
  }

  /**
   * The colours painted behind an element, outermost first.
   *
   * The whole chain, not the nearest opaque ancestor: a translucent fill on a
   * translucent card on a solid page is three layers, and stopping at the
   * first one that happens to be opaque enough gets the wrong answer for
   * exactly the fills this theme is built out of.
   */
  function groundStack(el) {
    const layers = [];
    let node = el;
    while (node) {
      const bg = getComputedStyle(node).backgroundColor;
      if (bg && bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent') layers.unshift(bg);
      node = node.parentElement;
    }
    return layers;
  }
`;

async function signIn() {
  await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' });
  const status = await page.evaluate(async (password) => {
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
  return status;
}

/** Set the theme the way a user does: by clicking the control. */
async function setTheme(label) {
  await page.getByRole('radio', { name: label }).first().click();
  await page.waitForTimeout(400);
}

/** Every text node's contrast against what is painted behind it. */
async function worstContrast() {
  return page.evaluate(`(() => {
    ${CONTRAST_HELPERS}
    const results = [];
    for (const el of document.querySelectorAll('body *')) {
      // Only elements with their own visible text, so a wrapper is not blamed
      // for its children.
      const own = [...el.childNodes]
        .filter((n) => n.nodeType === 3)
        .map((n) => n.textContent.trim())
        .join('');
      if (!own) continue;

      const style = getComputedStyle(el);
      if (style.visibility === 'hidden' || style.display === 'none') continue;
      if (Number(style.opacity) < 0.5) continue;
      // Visually hidden, which sr-only does with clip rather than display, so
      // it still has a box and a colour and neither reaches a reader.
      if (el.classList.contains('sr-only')) continue;
      const box = el.getBoundingClientRect();
      if (box.width < 1 || box.height < 1) continue;

      // groundStack(el), not of its parent: text sits on its own element's
      // background. Measuring a filled button's label against the page behind
      // the button reported white on white at 1.09:1.
      const ground = groundStack(el);
      const bg = solid(ground);
      const fg = solid([...ground, style.color]);

      const size = parseFloat(style.fontSize);
      const bold = Number(style.fontWeight) >= 700;
      // WCAG's own definition of large text, which has a lower bar.
      const large = size >= 24 || (size >= 18.66 && bold);

      results.push({
        text: own.slice(0, 40),
        ratio: Number(ratio(fg, bg).toFixed(2)),
        required: large ? 3 : 4.5,
      });
    }
    // Everything that fails, not the worst few: fixing the top of a
    // truncated list only reveals the next slice of the same problem.
    return results
      .filter((r) => r.ratio < r.required)
      .sort((a, b) => a.ratio / a.required - b.ratio / b.required);
  })()`);
}

/**
 * Every <option>, against the ground its own dropdown will paint.
 *
 * The contrast sweep above walks rendered text and cannot see these: an option
 * inside a closed select has no box, so it is filtered out before it is
 * measured. The dropdown is drawn by the browser and there is no way to open
 * it from a script, which is exactly why this went out broken. What can be
 * measured is the pair of colours the browser will use, which is the select's
 * own background and the option's inherited ink.
 */
async function optionContrast() {
  return page.evaluate(`(() => {
    ${CONTRAST_HELPERS}
    const bad = [];
    for (const option of document.querySelectorAll('option')) {
      const style = getComputedStyle(option);
      const select = option.closest('select');
      if (!select) continue;

      // The popup's ground is the option's own background where one is set,
      // and the select's otherwise. A translucent value composites over the
      // browser's white popup base, which is the failure being checked.
      const own = style.backgroundColor;
      const fromSelect = getComputedStyle(select).backgroundColor;
      const layers = [];
      for (const layer of [fromSelect, own]) {
        if (layer && layer !== 'rgba(0, 0, 0, 0)' && layer !== 'transparent') layers.push(layer);
      }
      const bg = solid(layers);
      const fg = solid([...layers, style.color]);
      const r = ratio(fg, bg);
      if (r < 4.5) {
        bad.push(JSON.stringify(option.textContent.trim().slice(0, 24)) + ' ' + r.toFixed(2) + ':1');
      }
    }
    return [...new Set(bad)];
  })()`);
}

/**
 * Marks painted the same colour as what is behind them.
 *
 * Restricted to small or thin elements: swatches, dots, knobs, progress bars.
 * A raised header sitting a hair above the page ground is the design, not a
 * bug, and including large surfaces only reports that.
 */
async function invisibleMarks() {
  return page.evaluate(`(() => {
    ${CONTRAST_HELPERS}
    const found = [];
    for (const el of document.querySelectorAll('body *')) {
      const box = el.getBoundingClientRect();
      if (box.width < 4 || box.height < 4) continue;
      // A mark, not a surface.
      if (box.width > 48 && box.height > 48) continue;

      const style = getComputedStyle(el);
      if (style.visibility === 'hidden' || style.display === 'none') continue;
      if (Number(style.opacity) < 0.5) continue;
      // MapLibre and Recharts ship their own control and tooltip styling, and
      // both keep a hidden element in the tree at full size. Neither is ours
      // to theme, and the map controls carry a shadow rather than a fill.
      if (el.closest('.maplibregl-ctrl, .recharts-tooltip-wrapper')) continue;

      const own = style.backgroundColor;
      if (!own || own === 'rgba(0, 0, 0, 0)' || own === 'transparent') continue;
      // Text of its own means it is a control, judged by the contrast pass.
      if (el.textContent && el.textContent.trim()) continue;

      const ground = groundStack(el.parentElement ?? document.body);
      const bg = solid(ground);
      const fg = solid([...ground, own]);
      if (ratio(fg, bg) < 1.06) {
        found.push({
          tag: el.tagName.toLowerCase(),
          cls: (el.className.baseVal ?? el.className ?? '').toString().slice(0, 44),
          size: Math.round(box.width) + 'x' + Math.round(box.height),
        });
      }
    }
    return found.slice(0, 8);
  })()`);
}

check('signed in as a manager', (await signIn()) === 200);

// The default, before anything is chosen, has to be what everyone already has.
await page.goto(`${BASE}/clients`, { waitUntil: 'networkidle' });
check(
  'nothing chosen still means dark',
  (await page.evaluate(() => document.documentElement.getAttribute('data-theme'))) === 'dark'
);

const VIEWS = [
  ['clients', '/clients'],
  ['team', '/team'],
  ['activity', '/audit'],
  ['credentials', '/credentials'],
  ['field-dashboard', '/c/cl_allstar/field-sales/dashboard'],
  ['funnel', '/c/cl_allstar/field-sales/funnel'],
  ['canvass', '/c/cl_allstar/field-sales/canvass'],
  ['properties', '/c/cl_allstar/field-sales/properties'],
  ['territories', '/c/cl_allstar/field-sales/territories'],
];

for (const theme of ['Light', 'Dark']) {
  await page.goto(`${BASE}/clients`, { waitUntil: 'networkidle' });
  await setTheme(theme);

  const attr = await page.evaluate(() => document.documentElement.getAttribute('data-theme'));
  check(`choosing ${theme} sets the document`, attr === theme.toLowerCase(), attr);

  const failures = [];
  const invisible = [];
  const options = [];
  for (const [name, path] of VIEWS) {
    await page.goto(`${BASE}${path}`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1400);

    const worst = await worstContrast();
    for (const row of worst) {
      if (row.ratio < row.required) failures.push(`${name}: "${row.text}" ${row.ratio}:1`);
    }
    for (const row of await invisibleMarks()) {
      invisible.push(`${name}: ${row.tag}.${row.cls} ${row.size}`);
    }
    for (const row of await optionContrast()) options.push(`${name}: ${row}`);
  }

  check(
    `every piece of text in ${theme} meets its contrast floor`,
    failures.length === 0,
    failures.slice(0, 3).join(' | ')
  );
  check(
    `nothing in ${theme} is painted the same colour as its background`,
    invisible.length === 0,
    invisible.slice(0, 3).join(' | ')
  );
  check(
    `every dropdown option in ${theme} reads against its own popup`,
    options.length === 0,
    options.slice(0, 3).join(' | ')
  );
}

// The rep app, which the loop above cannot reach: it is a separate tree
// behind a separate session, and it is the half of the product used outdoors
// where a light theme is not a preference so much as a legibility fix.
{
  const phone = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    deviceScaleFactor: 3,
    geolocation: { latitude: 33.97, longitude: -117.38 },
    permissions: ['geolocation'],
  });
  const rep = await phone.newPage();
  await rep.goto(`${BASE}/field`, { waitUntil: 'domcontentloaded' });
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

  for (const theme of ['light', 'dark']) {
    await rep.goto(`${BASE}/field`, { waitUntil: 'domcontentloaded' });
    await rep.evaluate((t) => {
      localStorage.setItem('stopply.theme', t);
      document.documentElement.setAttribute('data-theme', t);
    }, theme);
    await rep.waitForTimeout(1500);

    // The knock sheet as well as the list: the outcome chips are filled with
    // accent colours and carry their own ink, which is the pairing most likely
    // to break in one theme and not the other.
    await rep.locator('ul li button').first().click();
    await rep.waitForTimeout(500);
    await rep.screenshot({ path: `${SHOTS}/41-field-${theme}.png` });

    const worst = await rep.evaluate(`(() => {
      ${CONTRAST_HELPERS}
      const out = [];
      for (const el of document.querySelectorAll('body *')) {
        const own = [...el.childNodes].filter((n) => n.nodeType === 3)
          .map((n) => n.textContent.trim()).join('');
        if (!own) continue;
        const st = getComputedStyle(el);
        if (st.visibility === 'hidden' || st.display === 'none') continue;
        if (Number(st.opacity) < 0.5) continue;
        if (el.classList.contains('sr-only')) continue;
        const b = el.getBoundingClientRect();
        if (b.width < 1 || b.height < 1) continue;
        const g = groundStack(el);
        const size = parseFloat(st.fontSize);
        const req = (size >= 24 || (size >= 18.66 && Number(st.fontWeight) >= 700)) ? 3 : 4.5;
        const r = ratio(solid([...g, st.color]), solid(g));
        if (r < req) out.push(JSON.stringify(own.slice(0, 24)) + ' ' + r.toFixed(2) + ':1');
      }
      return out;
    })()`);

    check(
      `the rep app reads in ${theme}`,
      worst.length === 0,
      worst.slice(0, 3).join(' | ')
    );
  }
  await phone.close();
}

// The choice has to survive a reload, which is the whole reason it is stored.
await page.goto(`${BASE}/clients`, { waitUntil: 'networkidle' });
await setTheme('Light');
await page.reload({ waitUntil: 'domcontentloaded' });
await page.waitForTimeout(600);
check(
  'the choice survives a reload',
  (await page.evaluate(() => document.documentElement.getAttribute('data-theme'))) === 'light'
);

// And it has to be on the very first paint. A page that paints dark and flips
// to light a frame later does it on every single load.
const beforeReact = await page.evaluate(async () => {
  // Read the attribute at the moment the document element exists, which is
  // what main.tsx sets before render rather than what a component sets after.
  return {
    attr: document.documentElement.getAttribute('data-theme'),
    hasRoot: !!document.getElementById('root')?.firstChild,
  };
});
check('the theme is on the document, not applied by a component after paint',
  beforeReact.attr === 'light', JSON.stringify(beforeReact));

// System follows the machine, and an explicit choice ignores it. This is the
// pair of cases the :not() guard in the CSS exists for.
await setTheme('System');
await context.close();

const lightMachine = await browser.newContext({
  viewport: { width: 1440, height: 1000 },
  colorScheme: 'light',
  storageState: { cookies: [], origins: [] },
});
const p2 = await lightMachine.newPage();
await p2.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' });

const resolvedFor = async (setting) => {
  await p2.evaluate((s) => localStorage.setItem('stopply.theme', s), setting);
  await p2.reload({ waitUntil: 'domcontentloaded' });
  await p2.waitForTimeout(400);
  return p2.evaluate(() => ({
    attr: document.documentElement.getAttribute('data-theme'),
    // The ground actually painted, which is what the media query decides.
    bg: getComputedStyle(document.body).backgroundColor,
  }));
};

const systemOnLight = await resolvedFor('system');
const darkOnLight = await resolvedFor('dark');
check(
  'system on a light machine paints light',
  systemOnLight.attr === 'system' && systemOnLight.bg !== darkOnLight.bg,
  `system ${systemOnLight.bg} vs dark ${darkOnLight.bg}`
);
// Against the system-light ground rather than a colour literal: the palette
// is written in oklch and getComputedStyle returns it verbatim, so asserting
// an rgb() string only tests how the browser serialises.
check(
  'an explicit dark choice is not overridden by a light machine',
  darkOnLight.attr === 'dark' && darkOnLight.bg !== systemOnLight.bg,
  `dark ${darkOnLight.bg} vs system ${systemOnLight.bg}`
);
await p2.screenshot({ path: `${SHOTS}/40-system-on-light-machine.png` });
await lightMachine.close();

const EXPECTED = [
  /401 \(Unauthorized\)/,
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
