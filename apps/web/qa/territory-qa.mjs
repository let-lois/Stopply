// Drawing territories and assigning reps.
//
// The check that matters is the last one: redrawing a boundary has to change
// what a rep's phone actually offers them. A territory that looks right on a
// manager's map and hands a rep the wrong streets is worse than no territory.

const BASE = process.env.API_BASE ?? 'http://127.0.0.1:8808';
const TOKEN = 'XXXX.DUMMY.TOKEN.XXXX';

const results = [];
const check = (name, passed, detail = '') => {
  results.push({ name, passed });
  console.log(`${passed ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
};

async function call(path, { method = 'GET', body, cookie } = {}) {
  const r = await fetch(`${BASE}${path}`, {
    method,
    headers: { ...(body ? { 'content-type': 'application/json' } : {}), ...(cookie ? { cookie } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const text = await r.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* not json */ }
  return { status: r.status, json, text, headers: r.headers };
}

const admin = await call('/api/auth/login', {
  method: 'POST',
  body: {
    email: 'admin@letlois.example.invalid',
    password: process.env.SEED_PASSWORD ?? 'stopply-demo-password',
    turnstileToken: TOKEN,
  },
});
const cookie = (admin.headers.get('set-cookie') ?? '').split(';')[0];
check('signed in as a manager', admin.status === 200);

const initial = await call('/api/clients/cl_allstar/territories', { cookie });
check(
  'territories carry the shape they were drawn as',
  initial.status === 200 && initial.json.territories.every((t) => Array.isArray(t.boundary) && t.boundary.length >= 3),
  `${initial.json?.territories?.length} territories`
);
check(
  'every rep on a territory is listed, not just one',
  initial.json.territories.every((t) => Array.isArray(t.repIds)),
  JSON.stringify(initial.json.territories.map((t) => t.repIds))
);
check(
  'door counts come back with them',
  Object.values(initial.json.doorCounts ?? {}).reduce((a, b) => a + b, 0) === 96,
  JSON.stringify(initial.json.doorCounts)
);

// A rep cannot draw territories.
const rep = await call('/api/field/login', {
  method: 'POST',
  body: { email: 'marcus@allstar.example.invalid', password: process.env.REP_PASSWORD ?? 'test1234', turnstileToken: TOKEN },
});
const repCookie = (rep.headers.get('set-cookie') ?? '').split(';')[0];
const repDraw = await call('/api/clients/cl_allstar/territories', {
  method: 'POST',
  cookie: repCookie,
  body: { name: 'Mine now', boundary: [[-117.42, 33.9], [-117.36, 33.9], [-117.36, 33.99]] },
});
check('a rep cannot draw a territory', repDraw.status === 401 || repDraw.status === 403, `got ${repDraw.status}`);

// Draw a new one over the western half of whatever the client actually holds.
//
// Derived from the doors rather than written down. This harness carried a box
// around Mesa, Arizona, so when the market moved to California it drew a
// territory over open desert, claimed nothing, and reported five failures that
// were all one stale constant. A box computed from the data is right wherever
// the client is.
const allDoors = await call('/api/clients/cl_allstar/field-sales/data', { cookie });
const coords = allDoors.json.properties.map((p) => [p.lng, p.lat]);
const lngs = coords.map((c) => c[0]);
const lats = coords.map((c) => c[1]);
const minLng = Math.min(...lngs);
const maxLng = Math.max(...lngs);
const minLat = Math.min(...lats) - 0.01;
const maxLat = Math.max(...lats) + 0.01;
// Half way across, padded out top and bottom, so the strip certainly contains
// some doors and certainly does not contain all of them.
const midLng = (minLng + maxLng) / 2;
const west = [
  [minLng - 0.01, minLat],
  [midLng, minLat],
  [midLng, maxLat],
  [minLng - 0.01, maxLat],
];
const created = await call('/api/clients/cl_allstar/territories', {
  method: 'POST',
  cookie,
  body: { name: 'West Strip', boundary: west },
});
check('a manager draws a territory', created.status === 201, `got ${created.status} ${created.text.slice(0, 100)}`);

// By id-diff against what was there before, not by name. Finding by name
// picked up a leftover 'West Strip' from an earlier interrupted run and then
// measured the wrong territory, which read as a routing bug and was a harness
// bug. The id the server just minted is unambiguous.
const before = new Set(initial.json.territories.map((t) => t.id));
const strip = created.json?.territories?.find((t) => !before.has(t.id));
check('it comes back with a bounding box derived from the shape',
  strip?.bounds?.west === minLng - 0.01 && strip?.bounds?.east === midLng,
  JSON.stringify(strip?.bounds));

const stripDoors = created.json?.doorCounts?.[strip?.id] ?? 0;
check('drawing it claimed the doors inside it', stripDoors > 0, `${stripDoors} doors`);

// The total never changes: doors move between territories, they are never lost.
const total = Object.values(created.json.doorCounts).reduce((a, b) => a + b, 0);
check('no door was orphaned by the redraw', total === 96, `${total} doors across all territories`);

// Bad shapes are refused.
const tooFew = await call('/api/clients/cl_allstar/territories', {
  method: 'POST',
  cookie,
  body: { name: 'Line', boundary: [[-111.66, 33.4], [-111.6, 33.4]] },
});
check('a shape with under three points is refused', tooFew.status === 400, `got ${tooFew.status}`);

const offEarth = await call('/api/clients/cl_allstar/territories', {
  method: 'POST',
  cookie,
  body: { name: 'Nowhere', boundary: [[33.4, -111.66], [33.4, -111.6], [33.44, -111.6]] },
});
check('transposed coordinates are refused', offEarth.status === 400, `got ${offEarth.status}`);

// Assign a rep, and check their phone follows.
const assigned = await call(`/api/clients/cl_allstar/reps/rep_as_1`, {
  method: 'PATCH',
  cookie,
  body: { territoryId: strip.id },
});
check('a rep is assigned to a territory', assigned.status === 200, `got ${assigned.status}`);
check(
  'the territory lists them',
  assigned.json?.territories?.find((t) => t.id === strip.id)?.repIds?.includes('rep_as_1')
);

const foreign = await call(`/api/clients/cl_allstar/reps/rep_as_1`, {
  method: 'PATCH',
  cookie,
  body: { territoryId: 'ter_not_ours' },
});
check('a territory from another workspace is refused', foreign.status === 404, `got ${foreign.status}`);

// The payoff: the rep's own app now offers the new streets.
const repDoors = await call('/api/field/doors', { cookie: repCookie });
const repTerritories = new Set(repDoors.json?.properties?.map((p) => p.territoryId));
check(
  "the rep's phone follows the assignment",
  repTerritories.size === 1 && repTerritories.has(strip.id),
  `${repDoors.json?.properties?.length} doors in ${[...repTerritories].join(', ')}`
);
check(
  'and it matches what the manager was shown',
  repDoors.json?.properties?.length === stripDoors,
  `${repDoors.json?.properties?.length} vs ${stripDoors}`
);

// Deleting a territory that still holds doors would orphan them.
const busyDelete = await call(`/api/clients/cl_allstar/territories/${strip.id}`, { method: 'DELETE', cookie });
check('a territory holding doors cannot be deleted', busyDelete.status === 400, `got ${busyDelete.status}`);

// Put the rep back and clean up: restore the original over the strip.
//
// Restored from the shape read at the top of this run, not from a shape
// written down here. The hardcoded version put the territory back as a box in
// Arizona with an Arizona name, so every run of this harness moved the seed a
// little further from the data it was seeded with, and the damage outlived the
// run. A harness that leaves the database different from how it found it is
// worse than no harness.
await call(`/api/clients/cl_allstar/reps/rep_as_1`, { method: 'PATCH', cookie, body: { territoryId: 'ter_as_1' } });
// Every territory, not just the one the strip overlapped most. The strip cuts
// across the client's whole extent, so restoring only the first left the
// southern doors inside it and the delete below then failed on a territory
// that was supposed to be empty.
for (const original of initial.json.territories) {
  await call(`/api/clients/cl_allstar/territories/${original.id}`, {
    method: 'PATCH',
    cookie,
    body: { name: original.name, boundary: original.boundary },
  });
}
const emptied = await call(`/api/clients/cl_allstar/territories/${strip.id}`, { method: 'DELETE', cookie });
check('an empty territory can be removed', emptied.status === 200, `got ${emptied.status}`);

const finalTotal = Object.values(emptied.json?.doorCounts ?? {}).reduce((a, b) => a + b, 0);
check('every door survived the whole exercise', finalTotal === 96, `${finalTotal} doors`);

const failed = results.filter((r) => !r.passed);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length > 0 ? 1 : 0);
