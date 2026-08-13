// The rep app's API, and above all the wall between it and the dashboard.
//
// That wall is the reason this file exists separately. A rep's credential must
// not reach a client's reporting, and a manager's must not reach the field
// routes, and both directions have to be checked because each fails silently
// in its own way.

const BASE = process.env.API_BASE ?? 'http://127.0.0.1:8801';
const REP_PASSWORD = process.env.REP_PASSWORD ?? 'test1234';
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

const anon = await call('/api/field/doors');
check('a rep must sign in to see doors', anon.status === 401, `got ${anon.status}`);

const noToken = await call('/api/field/login', {
  method: 'POST',
  body: { email: 'marcus@allstar.example.invalid', password: REP_PASSWORD },
});
check('rep sign-in is behind the challenge too', noToken.status === 403, `got ${noToken.status}`);

const wrong = await call('/api/field/login', {
  method: 'POST',
  body: { email: 'marcus@allstar.example.invalid', password: 'nope', turnstileToken: TOKEN },
});
const unknown = await call('/api/field/login', {
  method: 'POST',
  body: { email: 'nobody@allstar.example.invalid', password: REP_PASSWORD, turnstileToken: TOKEN },
});
check(
  'a wrong password and an unknown rep are indistinguishable',
  wrong.status === 401 && unknown.status === 401 &&
    wrong.json?.error?.message === unknown.json?.error?.message
);

const login = await call('/api/field/login', {
  method: 'POST',
  body: { email: 'marcus@allstar.example.invalid', password: REP_PASSWORD, turnstileToken: TOKEN },
});
check('a rep signs in', login.status === 200, `got ${login.status} ${login.text.slice(0, 100)}`);

const setCookie = login.headers.get('set-cookie') ?? '';
check(
  'the field cookie is separate from the dashboard cookie',
  setCookie.includes('stopply_field=') && !setCookie.includes('stopply_session='),
  setCookie.split(';')[0]?.replace(/=.*/, '=***')
);
check(
  'the field cookie is HttpOnly, Secure, SameSite=Lax and long-lived',
  /HttpOnly/i.test(setCookie) && /Secure/i.test(setCookie) && /SameSite=Lax/i.test(setCookie) &&
    Number(/Max-Age=(\d+)/.exec(setCookie)?.[1] ?? 0) > 7 * 86400
);

const repCookie = setCookie.split(';')[0];

// Deliberately not a hardcoded territory name. This asserted 'East Mesa North'
// and failed when the market moved to California, which is a harness breaking
// on a data change rather than on a defect. What has to hold is that the rep
// gets a named territory of their own; the next check is the one that proves
// it is only theirs.
check(
  'signing in returns the rep their own territory',
  login.json?.session?.repName === 'Marcus Webb' &&
    typeof login.json?.session?.territoryName === 'string' &&
    login.json.session.territoryName.length > 0,
  `${login.json?.session?.territoryName}, ${login.json?.properties?.length} doors`
);

// The rep sees their territory, not the whole client.
const doors = await call('/api/field/doors', { cookie: repCookie });
const territories = new Set((doors.json?.properties ?? []).map((p) => p.territoryId));
check(
  'a rep sees only their own territory',
  territories.size === 1 && territories.has('ter_as_1'),
  `${doors.json?.properties?.length} doors across ${territories.size} territory`
);
check(
  "a rep sees only their own knocks",
  (doors.json?.visits ?? []).every((v) => v.repId === 'rep_as_1'),
  `${doors.json?.visits?.length} visits`
);

// The wall, in both directions.
const reach = await Promise.all([
  call('/api/clients', { cookie: repCookie }),
  call('/api/audit', { cookie: repCookie }),
  call('/api/credentials', { cookie: repCookie }),
  call('/api/clients/cl_allstar/field-sales/data', { cookie: repCookie }),
]);
check(
  'a rep credential reaches no dashboard route',
  reach.every((r) => r.status === 401 || r.status === 403),
  reach.map((r) => r.status).join(', ')
);

const admin = await call('/api/auth/login', {
  method: 'POST',
  body: {
    email: 'admin@letlois.example.invalid',
    password: process.env.SEED_PASSWORD ?? 'stopply-demo-password',
    turnstileToken: TOKEN,
  },
});
const adminCookie = (admin.headers.get('set-cookie') ?? '').split(';')[0];
const adminOnField = await call('/api/field/doors', { cookie: adminCookie });
check(
  'a dashboard credential reaches no field route',
  adminOnField.status === 401,
  `got ${adminOnField.status}`
);

// Knocking.
const target = doors.json?.properties?.[0];
const deviceVisitId = `dev_fieldqa_${Date.now().toString(36)}`;
const knock = {
  deviceVisitId,
  propertyId: target?.id,
  disposition: 'interested',
  notes: 'Wants a quote next week',
  occurredAt: new Date().toISOString(),
};

const logged = await call('/api/field/visits', { method: 'POST', cookie: repCookie, body: knock });
check('a rep logs a knock', logged.status === 200 && logged.json?.duplicate === false, `${logged.status}`);
check(
  'the knock is attributed to the signed-in rep, not to the body',
  logged.json?.visit?.repId === 'rep_as_1',
  logged.json?.visit?.repId
);

// A phone must not be able to log as a colleague.
const spoof = await call('/api/field/visits', {
  method: 'POST',
  cookie: repCookie,
  body: { ...knock, deviceVisitId: `${deviceVisitId}_s`, repId: 'rep_as_2' },
});
check(
  'a rep cannot attribute a knock to a colleague',
  spoof.json?.visit?.repId === 'rep_as_1',
  spoof.json?.visit?.repId
);

const resent = await call('/api/field/visits', { method: 'POST', cookie: repCookie, body: knock });
check(
  'a resent knock is 200 with duplicate:true, so the outbox drains',
  resent.status === 200 && resent.json?.duplicate === true,
  `${resent.status} duplicate=${resent.json?.duplicate}`
);

// A door in the other rep's territory.
const foreign = await call('/api/field/visits', {
  method: 'POST',
  cookie: repCookie,
  body: { ...knock, deviceVisitId: `${deviceVisitId}_f`, propertyId: 'prp_as_001' },
});
check(
  'a rep cannot knock a door outside their territory',
  foreign.status === 404,
  `got ${foreign.status}`
);

const after = await call('/api/field/doors', { cookie: repCookie });
check(
  "the door's outcome reflects the knock",
  after.json?.properties?.find((p) => p.id === target?.id)?.disposition === 'interested'
);

// A car on the drive. Three-valued end to end: the column, the contract and
// the phone all have to keep "did not look" distinct from "no car", and the
// place that breaks is a boolean cast somewhere in the middle turning one into
// the other.
const carDoor = doors.json?.properties?.[1];
const carKnock = {
  deviceVisitId: `dev_fieldqa_car_${Date.now().toString(36)}`,
  propertyId: carDoor?.id,
  disposition: 'no_answer',
  notes: null,
  vehiclePresent: true,
  occurredAt: new Date().toISOString(),
};
const carLogged = await call('/api/field/visits', { method: 'POST', cookie: repCookie, body: carKnock });
check(
  'a knock records a car on the drive',
  carLogged.status === 200 && carLogged.json?.visit?.vehiclePresent === true,
  `${carLogged.status} vehiclePresent=${carLogged.json?.visit?.vehiclePresent}`
);

// The knock further up sent no vehiclePresent at all.
check(
  'a knock that did not say reads back as null, not false',
  logged.json?.visit?.vehiclePresent === null,
  `got ${JSON.stringify(logged.json?.visit?.vehiclePresent)}`
);

const withCar = await call('/api/field/doors', { cookie: repCookie });
const carVisit = (withCar.json?.visits ?? []).find(
  (v) => v.id === carLogged.json?.visit?.id
);
check(
  'the car survives a round trip through the database',
  carVisit?.vehiclePresent === true,
  `got ${JSON.stringify(carVisit?.vehiclePresent)}`
);

// The stages that made the booked-to-showed gap visible. A CHECK constraint
// that was never widened would reject these at the database rather than at the
// contract, which is a 500 rather than a 400 and is worth catching here.
const showDoor = doors.json?.properties?.[2];
const showKnock = {
  deviceVisitId: `dev_fieldqa_kept_${Date.now().toString(36)}`,
  propertyId: showDoor?.id,
  disposition: 'appointment_kept',
  notes: null,
  vehiclePresent: false,
  occurredAt: new Date().toISOString(),
};
const showLogged = await call('/api/field/visits', { method: 'POST', cookie: repCookie, body: showKnock });
check(
  'a kept appointment is accepted by the database, not just by the contract',
  showLogged.status === 200 && showLogged.json?.visit?.disposition === 'appointment_kept',
  `${showLogged.status} ${showLogged.json?.error?.message ?? ''}`
);
check(
  'and "no car" is stored as false rather than collapsing to null',
  showLogged.json?.visit?.vehiclePresent === false,
  `got ${JSON.stringify(showLogged.json?.visit?.vehiclePresent)}`
);

const missed = await call('/api/field/visits', {
  method: 'POST',
  cookie: repCookie,
  body: {
    ...showKnock,
    deviceVisitId: `${showKnock.deviceVisitId}_m`,
    disposition: 'appointment_missed',
  },
});
check(
  'so is a missed one',
  missed.status === 200 && missed.json?.visit?.disposition === 'appointment_missed',
  `${missed.status} ${missed.json?.error?.message ?? ''}`
);

// Do not knock is still sticky, whatever arrives afterwards.
const dnkDoor = doors.json?.properties?.[3];
const stamp = Date.now().toString(36);
await call('/api/field/visits', {
  method: 'POST',
  cookie: repCookie,
  body: {
    deviceVisitId: `dev_fieldqa_dnk_${stamp}`,
    propertyId: dnkDoor?.id,
    disposition: 'do_not_knock',
    notes: null,
    occurredAt: new Date().toISOString(),
  },
});
await call('/api/field/visits', {
  method: 'POST',
  cookie: repCookie,
  body: {
    deviceVisitId: `dev_fieldqa_dnk_${stamp}_after`,
    propertyId: dnkDoor?.id,
    disposition: 'appointment_kept',
    notes: null,
    occurredAt: new Date().toISOString(),
  },
});
const sticky = await call('/api/field/doors', { cookie: repCookie });
check(
  'do not knock survives a later knock arriving out of order',
  sticky.json?.properties?.find((p) => p.id === dnkDoor?.id)?.disposition === 'do_not_knock',
  sticky.json?.properties?.find((p) => p.id === dnkDoor?.id)?.disposition
);

const out = await call('/api/field/logout', { method: 'POST', cookie: repCookie });
const afterOut = await call('/api/field/doors', { cookie: repCookie });
check('signing out kills the session server-side', out.status === 200 && afterOut.status === 401);

const failed = results.filter((r) => !r.passed);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length > 0 ? 1 : 0);
