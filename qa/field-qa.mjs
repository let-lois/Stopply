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

check(
  'signing in returns the rep their own territory',
  login.json?.session?.repName === 'Marcus Webb' &&
    login.json?.session?.territoryName === 'East Mesa North',
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

const out = await call('/api/field/logout', { method: 'POST', cookie: repCookie });
const afterOut = await call('/api/field/doors', { cookie: repCookie });
check('signing out kills the session server-side', out.status === 200 && afterOut.status === 401);

const failed = results.filter((r) => !r.passed);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length > 0 ? 1 : 0);
