// The server half of the QA list, run against a real workerd.
//
// Everything here is a property that cannot be checked by reading the code:
// that the cookie really is HttpOnly on the wire, that a tokenless POST really
// is refused, that one tenant really cannot read another's doors. Unit tests
// cover the pieces; this covers the assembled thing.
//
// Run:
//   npx wrangler pages dev dist --port 8788 &
//   node qa/api-qa.mjs

const BASE = process.env.API_BASE ?? 'http://127.0.0.1:8788';
const PASSWORD = process.env.SEED_PASSWORD ?? 'stopply-demo-password';
// Cloudflare's published dummy token. The always-passes secret in .dev.vars
// accepts any value, but sending a realistic one keeps the request honest.
const TOKEN = 'XXXX.DUMMY.TOKEN.XXXX';

const results = [];
function check(name, passed, detail = '') {
  results.push({ name, passed });
  console.log(`${passed ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
}

async function call(path, { method = 'GET', body, cookie, headers = {} } = {}) {
  const response = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      ...(body ? { 'content-type': 'application/json' } : {}),
      ...(cookie ? { cookie } : {}),
      ...headers,
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
    redirect: 'manual',
  });
  const text = await response.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = null;
  }
  return { status: response.status, json, text, headers: response.headers };
}

// ---------------------------------------------------------------------------
// Unauthenticated surface
// ---------------------------------------------------------------------------

const anonSession = await call('/api/auth/session');
check('an anonymous caller is not signed in', anonSession.status === 401, `got ${anonSession.status}`);

const anonClients = await call('/api/clients');
check('the client list requires a session', anonClients.status === 401, `got ${anonClients.status}`);

const unknown = await call('/api/nope');
check('an unknown endpoint is a 404', unknown.status === 404, `got ${unknown.status}`);

const wrongVerb = await call('/api/auth/session', { method: 'DELETE' });
check(
  'a known path with the wrong verb is a 405 naming what it allows',
  wrongVerb.status === 405 && /GET/.test(wrongVerb.json?.error?.message ?? ''),
  wrongVerb.json?.error?.message
);

// §11.8, the explicit verification the spec asks for.
const tokenless = await call('/api/auth/login', {
  method: 'POST',
  body: { email: 'admin@letlois.example.invalid', password: PASSWORD },
});
check(
  'a tokenless login POST is refused with 403',
  tokenless.status === 403 && tokenless.json?.error?.code === 'challenge_failed',
  `${tokenless.status} ${tokenless.json?.error?.code}`
);

const emptyToken = await call('/api/auth/login', {
  method: 'POST',
  body: { email: 'admin@letlois.example.invalid', password: PASSWORD, turnstileToken: '' },
});
check('an empty challenge token is refused too', emptyToken.status === 403, `got ${emptyToken.status}`);

const badJson = await call('/api/auth/login', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: undefined,
});
check('a body-less POST is a 400, not a crash', badJson.status === 400, `got ${badJson.status}`);

// ---------------------------------------------------------------------------
// Sign in
// ---------------------------------------------------------------------------

const wrongPassword = await call('/api/auth/login', {
  method: 'POST',
  body: { email: 'admin@letlois.example.invalid', password: 'not the password', turnstileToken: TOKEN },
});
const unknownEmail = await call('/api/auth/login', {
  method: 'POST',
  body: { email: 'nobody@example.invalid', password: PASSWORD, turnstileToken: TOKEN },
});
check(
  'a wrong password and an unknown account are indistinguishable',
  wrongPassword.status === 401 &&
    unknownEmail.status === 401 &&
    wrongPassword.json?.error?.message === unknownEmail.json?.error?.message,
  wrongPassword.json?.error?.message
);

const login = await call('/api/auth/login', {
  method: 'POST',
  body: { email: 'admin@letlois.example.invalid', password: PASSWORD, turnstileToken: TOKEN },
});
check('a correct password signs in', login.status === 200, `got ${login.status} ${login.text.slice(0, 120)}`);

const setCookie = login.headers.get('set-cookie') ?? '';
check(
  'the session cookie is HttpOnly, Secure and SameSite=Lax',
  /HttpOnly/i.test(setCookie) && /Secure/i.test(setCookie) && /SameSite=Lax/i.test(setCookie),
  setCookie.replace(/=[^;]+/, '=***')
);
check(
  'no token is returned in the body for a script to store',
  !/token/i.test(login.text),
  login.text.slice(0, 120)
);

const adminCookie = setCookie.split(';')[0];

const session = await call('/api/auth/session', { cookie: adminCookie });
check(
  'the session identifies the signed-in user',
  session.status === 200 && session.json?.user?.email === 'admin@letlois.example.invalid',
  session.json?.user?.role
);
check('a super admin is scoped to every client', session.json?.clientIds === null);

// ---------------------------------------------------------------------------
// Tenant scoping
// ---------------------------------------------------------------------------

const allClients = await call('/api/clients', { cookie: adminCookie });
check(
  'a super admin sees every workspace',
  allClients.status === 200 && allClients.json?.clients?.length === 4,
  `${allClients.json?.clients?.length} clients`
);

const tenantLogin = await call('/api/auth/login', {
  method: 'POST',
  body: { email: 'admin@allstar.example.invalid', password: PASSWORD, turnstileToken: TOKEN },
});
const tenantCookie = (tenantLogin.headers.get('set-cookie') ?? '').split(';')[0];
check('a client admin can sign in', tenantLogin.status === 200, `got ${tenantLogin.status}`);

const tenantClients = await call('/api/clients', { cookie: tenantCookie });
check(
  'a client admin sees only their own workspace',
  tenantClients.json?.clients?.length === 1 && tenantClients.json.clients[0].id === 'cl_allstar',
  JSON.stringify(tenantClients.json?.clients?.map((c) => c.id))
);

// The heart of §11.3: a client id in the URL is a hint, not an instruction.
const crossTenant = await call('/api/clients/cl_roguesolar/field-sales/data', {
  cookie: tenantCookie,
});
check(
  "another tenant's data reads as absent, not forbidden",
  crossTenant.status === 404,
  `got ${crossTenant.status} ${crossTenant.json?.error?.code}`
);

const ownData = await call('/api/clients/cl_allstar/field-sales/data', { cookie: tenantCookie });
check(
  'a tenant can read their own field data',
  ownData.status === 200 && ownData.json?.properties?.length === 96,
  `${ownData.json?.properties?.length} properties, ${ownData.json?.visits?.length} visits`
);

// §11.4: entitlement re-checked server-side, whatever the browser drew.
const notEntitled = await call('/api/clients/cl_bluecactus/field-sales/data', {
  cookie: adminCookie,
});
check(
  'a module the client has not bought is refused to a super admin too',
  notEntitled.status === 403 && notEntitled.json?.error?.code === 'forbidden',
  `${notEntitled.status} ${notEntitled.json?.error?.message}`
);

// ---------------------------------------------------------------------------
// Writing a visit
// ---------------------------------------------------------------------------

const firstProperty = ownData.json?.properties?.[0];
const firstRep = ownData.json?.reps?.[0];
const deviceVisitId = `dev_qa_${Date.now().toString(36)}`;
const visitBody = {
  deviceVisitId,
  propertyId: firstProperty?.id,
  repId: firstRep?.id,
  disposition: 'appointment_set',
  notes: null,
  occurredAt: new Date().toISOString(),
};

const logged = await call('/api/clients/cl_allstar/field-sales/visits', {
  method: 'POST',
  cookie: tenantCookie,
  body: visitBody,
});
check(
  'a knock is recorded',
  logged.status === 200 && logged.json?.duplicate === false,
  `${logged.status} ${JSON.stringify(logged.json?.visit?.disposition)}`
);

const resent = await call('/api/clients/cl_allstar/field-sales/visits', {
  method: 'POST',
  cookie: tenantCookie,
  body: visitBody,
});
check(
  'a resent knock is a 200 with duplicate:true, never an error',
  resent.status === 200 && resent.json?.duplicate === true,
  `${resent.status} duplicate=${resent.json?.duplicate}`
);

const afterWrite = await call('/api/clients/cl_allstar/field-sales/data', { cookie: tenantCookie });
const updated = afterWrite.json?.properties?.find((p) => p.id === firstProperty?.id);
check(
  "the door's status reflects the knock",
  updated?.disposition === 'appointment_set',
  updated?.disposition
);

// A knock on another tenant's door, sent with our own workspace in the path.
const foreignDoor = await call('/api/clients/cl_allstar/field-sales/visits', {
  method: 'POST',
  cookie: tenantCookie,
  body: { ...visitBody, deviceVisitId: `${deviceVisitId}_x`, propertyId: 'prp_not_ours' },
});
check(
  'a knock cannot be attached to a property outside the workspace',
  foreignDoor.status === 404,
  `got ${foreignDoor.status}`
);

// ---------------------------------------------------------------------------
// Audit
// ---------------------------------------------------------------------------

const audit = await call('/api/audit', { cookie: tenantCookie });
const visitEntry = audit.json?.entries?.find((e) => e.action === 'LOG_VISIT');
check('the knock is on the audit trail', Boolean(visitEntry), visitEntry?.details);
check(
  'the trail records who did it, server-side',
  visitEntry?.userName === 'Dana Fields' && visitEntry?.userId === 'usr_allstar',
  visitEntry?.userName
);
check(
  'the audit trail is scoped like everything else',
  (audit.json?.entries ?? []).every((e) => !e.clientId || e.clientId === 'cl_allstar'),
  `${audit.json?.entries?.length} entries`
);

// ---------------------------------------------------------------------------
// Credentials
// ---------------------------------------------------------------------------

const credTokenless = await call('/api/credentials', {
  method: 'POST',
  cookie: adminCookie,
  body: { clientId: 'cl_allstar', provider: 'meta', keyName: 'Ads token', value: 'sk_live_abcd1234' },
});
check(
  'storing a credential without a challenge token is 403',
  credTokenless.status === 403,
  `got ${credTokenless.status}`
);

const created = await call('/api/credentials', {
  method: 'POST',
  cookie: adminCookie,
  body: {
    clientId: 'cl_allstar',
    provider: 'meta',
    keyName: `Ads token ${Date.now()}`,
    value: 'sk_live_supersecret_9999',
    turnstileToken: TOKEN,
  },
});
check('a credential can be stored', created.status === 201, `got ${created.status} ${created.text.slice(0, 120)}`);
check(
  'the response carries a reference, not the value',
  created.json?.credential?.last4 === '9999' && !created.text.includes('supersecret'),
  created.text.slice(0, 160)
);

const creds = await call('/api/credentials', { cookie: adminCookie });
check(
  'listing credentials never returns a value',
  creds.status === 200 && !creds.text.includes('supersecret') && !/"value"/.test(creds.text),
  `${creds.json?.credentials?.length} credentials`
);

// There is no GET that returns a secret. Prove the obvious guesses 404 rather
// than merely asserting the route table looks right.
const guesses = await Promise.all(
  [
    `/api/credentials/${created.json?.credential?.id}`,
    `/api/credentials/${created.json?.credential?.id}/value`,
    `/api/credentials/${created.json?.credential?.id}/reveal`,
  ].map((p) => call(p, { cookie: adminCookie }))
);
check(
  'no endpoint reveals a stored secret',
  guesses.every((g) => g.status === 404 || g.status === 405),
  guesses.map((g) => g.status).join(', ')
);

const duplicate = await call('/api/credentials', {
  method: 'POST',
  cookie: adminCookie,
  body: {
    clientId: 'cl_allstar',
    provider: 'meta',
    keyName: created.json?.credential?.keyName,
    value: 'sk_live_another_8888',
    turnstileToken: TOKEN,
  },
});
check(
  'rotation is delete-and-recreate: overwriting is refused',
  duplicate.status === 409,
  `got ${duplicate.status}`
);

const removed = await call(`/api/credentials/${created.json?.credential?.id}`, {
  method: 'DELETE',
  cookie: adminCookie,
});
check('a credential can be removed', removed.status === 200, `got ${removed.status}`);

// ---------------------------------------------------------------------------
// Sign out
// ---------------------------------------------------------------------------

const loggedOut = await call('/api/auth/logout', { method: 'POST', cookie: adminCookie });
check('signing out succeeds', loggedOut.status === 200);

const afterLogout = await call('/api/auth/session', { cookie: adminCookie });
check(
  'the old cookie is dead server-side, not merely cleared in the browser',
  afterLogout.status === 401,
  `got ${afterLogout.status}`
);

const failed = results.filter((r) => !r.passed);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length > 0 ? 1 : 0);
