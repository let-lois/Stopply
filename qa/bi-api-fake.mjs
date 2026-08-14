// A stand-in for the bi.letlois.com API, for building the adapters against.
//
// That platform is unreachable from this sandbox, and pointing the new
// interface at nothing and hoping is how you discover a field name is spelled
// differently the day it goes live. Every shape below was read out of
// workers/api/src of the platform's own repository, not invented, and the
// comments name the file each came from so they can be checked again when
// that code changes.
//
// It is deliberately not a mock framework. It is the smallest server that
// answers the routes the adapters call, with data shaped like the four real
// clients, so the adapters can be exercised end to end before anything is
// pointed at production.
//
// It is also deliberately strict. A permissive fake is worse than none: it
// agrees with whatever the adapter happens to send and the disagreement
// surfaces in production instead. So the three rules the real platform
// enforces are enforced here, because each one already caught a wrong
// assumption in the adapter design:
//
//   1. loginSchema is .strict(). An extra field, such as the turnstileToken
//      this app sends its own server, is a 400 and not an ignored extra.
//   2. Tenant routes on the agency host need a tenant selected server side
//      first, via POST /api/auth/switch-tenant. Without it: 400.
//   3. switch-tenant rotates the session token and mints a new CSRF token.
//      The old CSRF value stops working at that moment.
//
// Run: node qa/bi-api-fake.mjs   (listens on 8790)

import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';

const PORT = Number(process.env.BI_FAKE_PORT ?? 8790);

// session.ts line 14.
const CSRF_HEADER = 'x-csrf-token';

// The agency user signing in on the agency host. Roles come from
// routes/agency.ts: agency_admin is the one that may do everything.
const AGENCY_USER = {
  id: 'au_noah',
  email: 'noah@letlois.com',
  name: 'Noah Rance',
  role: 'agency_admin',
};

// The single server side session, mirroring the SESSIONS KV record. Held as
// one object because the real cookie is one cookie: two browser tabs share
// it, which is exactly the behaviour the adapters have to cope with.
let session = null;

function startSession(tenantId) {
  session = { token: randomUUID(), csrf: randomUUID(), tenantId };
  return session;
}

// tenants, from routes/agency.ts GET /tenants. The column list there is
// explicit, so this is that SELECT verbatim: raw D1 rows, snake_case, JSON
// left as strings, ordered by name as the handler orders them.
const TENANTS = [
  {
    id: 'tn_allstar',
    slug: 'allstar',
    name: 'Allstar',
    status: 'active',
    plan: 'starter',
    timezone: 'America/Los_Angeles',
    custom_hostname: null,
    hostname_status: null,
    schema_version: 7,
    footer_credit: null,
    monthly_ad_spend_budget: null,
    ad_platforms_json: null,
    ad_platform_budget_json: null,
    created_at: '2026-06-01T00:00:00.000Z',
  },
  {
    id: 'tn_beclinical',
    slug: 'beclinical',
    name: 'Be Clinical',
    status: 'active',
    plan: 'starter',
    timezone: 'America/Phoenix',
    custom_hostname: null,
    hostname_status: null,
    schema_version: 7,
    footer_credit: null,
    monthly_ad_spend_budget: 4000,
    ad_platforms_json: '["google","meta"]',
    ad_platform_budget_json: null,
    created_at: '2026-05-01T00:00:00.000Z',
  },
  {
    id: 'tn_bluecactus',
    slug: 'blue-cactus',
    name: 'Blue Cactus Power Washing',
    status: 'active',
    plan: 'starter',
    timezone: 'America/Phoenix',
    custom_hostname: null,
    hostname_status: null,
    schema_version: 7,
    footer_credit: null,
    monthly_ad_spend_budget: null,
    ad_platforms_json: '["meta"]',
    ad_platform_budget_json: null,
    created_at: '2026-04-01T00:00:00.000Z',
  },
  {
    id: 'tn_txdroofing',
    slug: 'txd-roofing',
    name: 'TXD Roofing',
    status: 'active',
    plan: 'starter',
    timezone: 'America/Chicago',
    custom_hostname: null,
    hostname_status: null,
    schema_version: 7,
    footer_credit: null,
    monthly_ad_spend_budget: null,
    ad_platforms_json: null,
    ad_platform_budget_json: null,
    created_at: '2026-03-01T00:00:00.000Z',
  },
];

// The disposition catalog, from packages/field and routes/fieldAdmin.ts.
//
// This is the shape the new interface has to learn to read. The live platform
// lets a client rename or add outcomes, so reporting there aggregates on the
// flags rather than on the key. The new app shipped with a fixed enum, which
// is the single biggest impedance between the two.
const DISPOSITIONS = [
  { key: 'no_answer', label: 'No answer', sort_order: 10, is_contact: 0, is_lead: 0, is_appointment: 0, is_sale: 0, marks_do_not_knock: 0, color: null },
  { key: 'come_back', label: 'Come back', sort_order: 20, is_contact: 0, is_lead: 0, is_appointment: 0, is_sale: 0, marks_do_not_knock: 0, color: null },
  { key: 'not_interested', label: 'Not interested', sort_order: 30, is_contact: 1, is_lead: 0, is_appointment: 0, is_sale: 0, marks_do_not_knock: 0, color: null },
  { key: 'interested', label: 'Interested', sort_order: 40, is_contact: 1, is_lead: 1, is_appointment: 0, is_sale: 0, marks_do_not_knock: 0, color: null },
  { key: 'appointment', label: 'Appointment set', sort_order: 50, is_contact: 1, is_lead: 1, is_appointment: 1, is_sale: 0, marks_do_not_knock: 0, color: null },
  { key: 'sale', label: 'Sold', sort_order: 60, is_contact: 1, is_lead: 1, is_appointment: 1, is_sale: 1, marks_do_not_knock: 0, color: null },
  { key: 'do_not_knock', label: 'Do not knock', sort_order: 70, is_contact: 1, is_lead: 0, is_appointment: 0, is_sale: 0, marks_do_not_knock: 1, color: null },
  // A renamed outcome, present on purpose: the adapter must not assume the
  // catalog is the default one. If anything downstream hardcodes a key, this
  // is the row that exposes it.
  { key: 'quote_left', label: 'Left a quote', sort_order: 45, is_contact: 1, is_lead: 1, is_appointment: 0, is_sale: 0, marks_do_not_knock: 0, color: '#f59e0b' },
];

// Only Allstar runs a field crew. The others answer an empty roster, which is
// what the platform does for a client with no reps: the tables exist in every
// tenant database but stay inert. An adapter that assumes rows are present is
// caught here rather than by Be Clinical's dashboard throwing.
const REPS_BY_TENANT = {
  tn_allstar: [
    { id: 'fr_marcus', email: 'marcus@allstar.example.invalid', name: 'Marcus Webb', phone: null, role: 'rep', team: 'North', active: 1, last_login_at: '2026-08-14T15:00:00.000Z', created_at: '2026-07-01T00:00:00.000Z' },
    { id: 'fr_priya', email: 'priya@allstar.example.invalid', name: 'Priya Anand', phone: null, role: 'rep', team: 'South', active: 1, last_login_at: '2026-08-13T15:00:00.000Z', created_at: '2026-07-01T00:00:00.000Z' },
  ],
};

const ADDRESSES = Array.from({ length: 40 }, (_, i) => ({
  id: `fa_${i}`,
  address: `${1700 + i * 2} Magnolia Ave, Riverside, CA 92503`,
  lat: 33.95 + (i % 8) * 0.002,
  lng: -117.4 + Math.floor(i / 8) * 0.003,
  lastDisposition: i % 5 === 0 ? 'interested' : i % 7 === 0 ? 'sale' : i % 3 === 0 ? 'no_answer' : null,
  lastVisitedAt: i % 3 === 0 ? '2026-08-12T18:00:00.000Z' : null,
  visitCount: i % 3 === 0 ? 1 : 0,
  doNotKnock: i === 11,
}));

const VISITS = ADDRESSES.filter((a) => a.visitCount > 0).map((a, i) => ({
  id: `fv_${i}`,
  repId: i % 2 === 0 ? 'fr_marcus' : 'fr_priya',
  repName: i % 2 === 0 ? 'Marcus Webb' : 'Priya Anand',
  address: a.address,
  lat: a.lat,
  lng: a.lng,
  // One visit carries the renamed outcome, so the catalog row above is not
  // only present in the catalog but actually reachable through reporting.
  disposition: i === 2 ? 'quote_left' : (a.lastDisposition ?? 'no_answer'),
  notes: null,
  contactName: null,
  contactPhone: null,
  contactEmail: null,
  occurredAt: `2026-08-${String(4 + (i % 10)).padStart(2, '0')}T18:00:00.000Z`,
  recordedAt: `2026-08-${String(4 + (i % 10)).padStart(2, '0')}T18:05:00.000Z`,
  followUpAt: null,
  editedAt: null,
  doNotKnock: a.doNotKnock,
}));

function send(res, status, body, extraHeaders = {}) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json',
    'content-length': Buffer.byteLength(payload),
    ...extraHeaders,
  });
  res.end(payload);
}

function readBody(req) {
  return new Promise((resolve) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      try {
        resolve(JSON.parse(raw || 'null'));
      } catch {
        resolve(null);
      }
    });
  });
}

// The cookie the browser would send back. Checked rather than assumed present
// so a rotated token that the adapter failed to follow shows up as a 401.
function sessionFromCookie(req) {
  const cookie = req.headers.cookie ?? '';
  const match = /(?:^|;\s*)lbi_session=([^;]+)/.exec(cookie);
  if (!match || !session) return null;
  return match[1] === session.token ? session : null;
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', `http://localhost:${PORT}`);
  const path = url.pathname;
  const method = req.method ?? 'GET';
  const current = sessionFromCookie(req);

  // middleware.ts csrfMiddleware: every mutating method, once a session
  // exists. Enforced before routing, as it is there.
  if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(method) && current) {
    if (req.headers[CSRF_HEADER] !== current.csrf) {
      return send(res, 403, { error: 'csrf token missing or invalid' });
    }
  }

  // routes/auth.ts POST /login
  if (path === '/api/auth/login' && method === 'POST') {
    const body = await readBody(req);
    const keys = body && typeof body === 'object' ? Object.keys(body) : [];
    // loginSchema is .strict(): email and password, nothing else. This app
    // sends turnstileToken to its own server, and that field would be
    // rejected here rather than ignored.
    const extra = keys.filter((k) => k !== 'email' && k !== 'password');
    if (!body || !body.email || !body.password || extra.length > 0) {
      return send(res, 400, { error: 'invalid request' });
    }
    if (String(body.email).toLowerCase() !== AGENCY_USER.email) {
      // The tenant directory fallback lives on this branch too, and carries a
      // redirectHost alongside the error. Modelled so the adapter has to cope
      // with an error body that has more than one field.
      if (String(body.email).toLowerCase().endsWith('@allstar.example.invalid')) {
        return send(res, 401, {
          error: 'use your own dashboard domain',
          redirectHost: 'allstar.bi.letlois.com',
        });
      }
      return send(res, 401, { error: 'invalid email or password' });
    }
    // An agency user signs in with no tenant selected. This is the state the
    // client list has to work in, and the state every tenant route refuses.
    const fresh = startSession(null);
    return send(res, 200, { ok: true, csrf: fresh.csrf, user: AGENCY_USER }, {
      'set-cookie': `lbi_session=${fresh.token}; Path=/; HttpOnly; SameSite=Lax`,
    });
  }

  if (path === '/api/auth/logout' && method === 'POST') {
    session = null;
    return send(res, 200, { ok: true }, { 'set-cookie': 'lbi_session=; Path=/; Max-Age=0' });
  }

  if (path === '/api/auth/me') {
    if (!current) return send(res, 401, { error: 'unauthorized' });
    return send(res, 200, {
      userType: 'agency',
      userId: AGENCY_USER.id,
      role: AGENCY_USER.role,
      tenantId: current.tenantId,
      csrf: current.csrf,
    });
  }

  if (path === '/api/auth/profile') {
    if (!current) return send(res, 401, { error: 'unauthorized' });
    return send(res, 200, {
      id: AGENCY_USER.id,
      email: AGENCY_USER.email,
      name: AGENCY_USER.name,
      role: AGENCY_USER.role,
    });
  }

  // routes/auth.ts POST /switch-tenant. Rotates the token and mints a new
  // CSRF, which is the part with teeth: an adapter that caches the login's
  // CSRF and keeps using it starts failing here.
  if (path === '/api/auth/switch-tenant' && method === 'POST') {
    if (!current) return send(res, 401, { error: 'unauthorized' });
    const body = await readBody(req);
    if (!body || typeof body.tenantId !== 'string') {
      return send(res, 400, { error: 'invalid request' });
    }
    const tenant = TENANTS.find((t) => t.id === body.tenantId);
    if (!tenant || tenant.status !== 'active') return send(res, 404, { error: 'not found' });
    const fresh = startSession(tenant.id);
    return send(
      res,
      200,
      { ok: true, csrf: fresh.csrf, tenant: { id: tenant.id, slug: tenant.slug, name: tenant.name } },
      { 'set-cookie': `lbi_session=${fresh.token}; Path=/; HttpOnly; SameSite=Lax` }
    );
  }

  if (!current) return send(res, 401, { error: 'unauthorized' });

  // routes/agency.ts. Reachable with no tenant selected: this is the client
  // list's source.
  if (path === '/api/agency/tenants') return send(res, 200, { tenants: TENANTS });

  // routes/fieldAdmin.ts, mounted under /api/tenant. middleware.ts
  // tenantScope: on the agency host the tenant comes from the session, and
  // its absence is a 400, not an empty result.
  if (path.startsWith('/api/tenant/')) {
    if (!current.tenantId) return send(res, 400, { error: 'no tenant selected' });

    if (path === '/api/tenant/field/dispositions') {
      return send(res, 200, { dispositions: DISPOSITIONS });
    }
    if (path === '/api/tenant/field/reps') {
      const reps = REPS_BY_TENANT[current.tenantId] ?? [];
      return send(res, 200, {
        reps,
        ready: true,
        fieldAppUrl: `https://${TENANTS.find((t) => t.id === current.tenantId).slug}.bi.letlois.com/field`,
      });
    }
    if (path === '/api/tenant/field/addresses') {
      const has = (REPS_BY_TENANT[current.tenantId] ?? []).length > 0;
      return send(res, 200, { addresses: has ? ADDRESSES : [] });
    }
    if (path === '/api/tenant/field/visits') {
      const has = (REPS_BY_TENANT[current.tenantId] ?? []).length > 0;
      return send(res, 200, { visits: has ? VISITS : [] });
    }
  }

  send(res, 404, { error: 'not found' });
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`bi.letlois.com fake listening on http://127.0.0.1:${PORT}`);
});
