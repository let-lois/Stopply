import { describe, it, expect, beforeEach } from 'vitest';
import { app } from '../src/index';
import { FakeD1, makeEnv } from './helpers';
import { SqliteTenantD1 } from './sqliteTenant';
import { clearResolverCache } from '../src/tenantResolver';
import { deriveSourceSecret } from '../src/provisioning';
import { hmacSha256Hex, sha256Hex } from '../src/crypto';
import type { Env } from '../src/env';

const TENANT_ROW = {
  id: 't_acme',
  slug: 'acme',
  name: 'Acme',
  status: 'active',
  plan: 'starter',
  timezone: 'America/Phoenix',
  d1_database_id: 'db-acme',
  d1_database_name: 'lbi-tenant-acme',
  schema_version: 1,
  theme_json: null,
  layout_json: null,
  custom_hostname: null,
  hostname_status: null,
  footer_credit: 1,
  funnel_labels_json: null,
  created_at: '2026-01-01T00:00:00Z',
};

function setup() {
  clearResolverCache();
  const tenantDb = new SqliteTenantD1();
  const env = makeEnv({ __tenantD1: tenantDb });
  (env.CONTROL_DB as FakeD1).on(/FROM tenants WHERE slug = \?/, (params) => ({
    first: params[0] === 'acme' ? TENANT_ROW : null,
  }));
  (env.CONTROL_DB as FakeD1).on(/INSERT INTO audit_log/, () => ({}));
  return { env, tenantDb };
}

function req(env: ReturnType<typeof makeEnv>, path: string, init: RequestInit = {}) {
  return app.request(`https://bi.letlois.com${path}`, init, env as unknown as Env);
}

async function installSecret(env: ReturnType<typeof makeEnv>, tenantDb: SqliteTenantD1): Promise<string> {
  const nonce = 'abcdef123456';
  const secret = await deriveSourceSecret(env as unknown as Env, 't_acme', 'ghl-webhook', nonce);
  const stored = `v1$${nonce}$${await sha256Hex(secret)}`;
  await tenantDb.query('db-acme', `UPDATE sources SET signing_secret_hash = ? WHERE key = ?`, [
    stored,
    'ghl-webhook',
  ]);
  return secret;
}

async function seedSources(tenantDb: SqliteTenantD1) {
  await tenantDb.query(
    'db-acme',
    `INSERT INTO sources (key, name, kind) VALUES ('ghl-webhook', 'GHL Webhook', 'webhook'), ('website-pixel', 'Website Pixel', 'pixel')`
  );
}

const GHL_PAYLOAD = {
  contact_id: 'ghl-123',
  first_name: 'Jane',
  last_name: 'Doe',
  email: 'jane@example.com',
  phone: '(602) 555-0142',
  date_created: '5/12/2026 3:24 pm',
  followup_stage: 'New Lead',
  treatment_of_interest: 'Botox',
  tags: 'facebook lead',
  campaign_name: 'Spring Promo',
  ad_name: 'Ad A',
  // The lowercase L spelling some GHL exports use. Never renamed.
  clickld: 'gclid-xyz-1',
  utm_source: '',
  utm_medium: '',
};

describe('webhook ingest', () => {
  let env: ReturnType<typeof makeEnv>;
  let tenantDb: SqliteTenantD1;
  let secret: string;

  beforeEach(async () => {
    ({ env, tenantDb } = setup());
    await seedSources(tenantDb);
    secret = await installSecret(env, tenantDb);
  });

  it('rejects an unsigned webhook with 401', async () => {
    const res = await req(env, '/ingest/acme/ghl-webhook', {
      method: 'POST',
      body: JSON.stringify(GHL_PAYLOAD),
    });
    expect(res.status).toBe(401);
  });

  it('rejects a wrong bearer secret with 401', async () => {
    const res = await req(env, '/ingest/acme/ghl-webhook', {
      method: 'POST',
      headers: { authorization: 'Bearer wrong-secret' },
      body: JSON.stringify(GHL_PAYLOAD),
    });
    expect(res.status).toBe(401);
  });

  it('accepts an HMAC signed webhook, creates a contact with frozen first touch and a lead stage event', async () => {
    const body = JSON.stringify(GHL_PAYLOAD);
    const sig = await hmacSha256Hex(secret, body);
    const res = await req(env, '/ingest/acme/ghl-webhook', {
      method: 'POST',
      headers: { 'x-lbi-signature': sig },
      body,
    });
    expect(res.status).toBe(200);

    const contacts = await tenantDb.query('db-acme', `SELECT * FROM contacts`);
    expect(contacts.results).toHaveLength(1);
    const contact = contacts.results[0] as Record<string, unknown>;
    expect(contact.id).toBe('ghl-123');
    expect(contact.email_norm).toBe('jane@example.com');
    expect(contact.phone_last10).toBe('6025550142');
    // clickld presence maps the channel to Google despite the facebook tag.
    expect(contact.first_touch_channel).toBe('Google');
    expect(contact.first_touch_at).toBe('2026-05-12T15:24:00.000Z');

    const stages = await tenantDb.query('db-acme', `SELECT * FROM stage_events WHERE stage = 'lead'`);
    expect(stages.results).toHaveLength(1);

    const touches = await tenantDb.query('db-acme', `SELECT * FROM touchpoints`);
    expect(touches.results).toHaveLength(1);
  });

  it('replaying the same webhook does not duplicate the contact, event, or lead', async () => {
    const body = JSON.stringify(GHL_PAYLOAD);
    for (let i = 0; i < 3; i++) {
      const res = await req(env, '/ingest/acme/ghl-webhook', {
        method: 'POST',
        headers: { authorization: `Bearer ${secret}` },
        body,
      });
      expect(res.status).toBe(200);
    }
    const contacts = await tenantDb.query('db-acme', `SELECT * FROM contacts`);
    expect(contacts.results).toHaveLength(1);
    const events = await tenantDb.query('db-acme', `SELECT * FROM events`);
    expect(events.results).toHaveLength(1);
    const stages = await tenantDb.query('db-acme', `SELECT * FROM stage_events WHERE stage = 'lead'`);
    expect(stages.results).toHaveLength(1);
  });

  it('a later webhook never overwrites the frozen first touch but updates latest touch', async () => {
    const first = JSON.stringify(GHL_PAYLOAD);
    await req(env, '/ingest/acme/ghl-webhook', {
      method: 'POST',
      headers: { authorization: `Bearer ${secret}` },
      body: first,
    });
    const reengagement = JSON.stringify({
      ...GHL_PAYLOAD,
      clickld: '',
      tags: 'google retargeting',
      utm_source: 'facebook',
      campaign_name: 'Retarget Promo',
      date_created: '6/01/2026 9:00 am',
    });
    await req(env, '/ingest/acme/ghl-webhook', {
      method: 'POST',
      headers: { authorization: `Bearer ${secret}` },
      body: reengagement,
    });
    const contact = (await tenantDb.query('db-acme', `SELECT * FROM contacts`)).results[0] as Record<string, unknown>;
    expect(contact.first_touch_channel).toBe('Google');
    expect(contact.first_touch_campaign).toBe('Spring Promo');
    expect(contact.latest_touch_channel).toBe('Meta');
    expect(contact.latest_touch_campaign).toBe('Retarget Promo');
    const touches = await tenantDb.query('db-acme', `SELECT * FROM touchpoints ORDER BY occurred_at`);
    expect(touches.results).toHaveLength(2);
  });

  it('rejects oversized payloads with 413', async () => {
    const res = await req(env, '/ingest/acme/ghl-webhook', {
      method: 'POST',
      headers: { authorization: `Bearer ${secret}` },
      body: JSON.stringify({ ...GHL_PAYLOAD, padding: 'x'.repeat(40000) }),
    });
    expect(res.status).toBe(413);
  });

  it('404s an unknown slug', async () => {
    const res = await req(env, '/ingest/nope/ghl-webhook', {
      method: 'POST',
      body: JSON.stringify(GHL_PAYLOAD),
    });
    expect(res.status).toBe(404);
  });
});

describe('pixel ingest', () => {
  let env: ReturnType<typeof makeEnv>;
  let tenantDb: SqliteTenantD1;

  beforeEach(async () => {
    ({ env, tenantDb } = setup());
    await seedSources(tenantDb);
  });

  const FT = {
    u: 'https://acme.com/?utm_source=google&gclid=abc',
    r: 'https://www.google.com/',
    us: 'google',
    um: 'cpc',
    uc: 'brand',
    ut: null,
    uo: null,
    g: 'abc',
    f: null,
    w: null,
    m: null,
    t: '2026-05-01T10:00:00.000Z',
  };

  function pixelBody(events: unknown[]) {
    return JSON.stringify({ vid: 'a1b2c3d4e5f60718', ft: FT, ev: events });
  }

  it('records page_view, form_partial, and form_submit with first touch context', async () => {
    const res = await req(env, '/ingest/acme/pixel', {
      method: 'POST',
      body: pixelBody([
        { k: 'page_view', t: '2026-05-01T10:00:01.000Z', u: 'https://acme.com/', r: 'https://www.google.com/' },
        { k: 'form_partial', t: '2026-05-01T10:01:00.000Z', fi: 'f1', fd: { name: 'Jane', email: 'jane@example.com' } },
        { k: 'form_submit', t: '2026-05-01T10:02:00.000Z', fi: 'f1', fd: { name: 'Jane', email: 'jane@example.com', phone: '6025550142' } },
      ]),
    });
    expect(res.status).toBe(200);

    const events = await tenantDb.query('db-acme', `SELECT * FROM events ORDER BY occurred_at`);
    expect(events.results.map((e: Record<string, unknown>) => e.event_type)).toEqual([
      'page_view',
      'form_partial',
      'form_submit',
    ]);
    for (const e of events.results as Array<Record<string, unknown>>) {
      expect(e.utm_source).toBe('google');
      expect(e.gclid).toBe('abc');
      expect(e.ip_hash).toMatch(/^[0-9a-f]{64}$/);
    }
    const visitors = await tenantDb.query('db-acme', `SELECT * FROM visitors`);
    expect(visitors.results).toHaveLength(1);
    const v = visitors.results[0] as Record<string, unknown>;
    expect(v.first_landing_page).toContain('utm_source=google');
  });

  it('stitches a visitor to an existing contact on form submit and folds first touch', async () => {
    // Contact created later (e.g. via GHL) with a later first touch.
    await tenantDb.query(
      'db-acme',
      `INSERT INTO contacts (id, email_norm, created_at, first_touch_at, first_touch_channel)
       VALUES ('c1', 'jane@example.com', '2026-05-02T00:00:00.000Z', '2026-05-02T00:00:00.000Z', 'Unknown')`
    );
    await req(env, '/ingest/acme/pixel', {
      method: 'POST',
      body: pixelBody([
        { k: 'form_submit', t: '2026-05-01T10:02:00.000Z', fi: 'f1', fd: { email: 'jane@example.com' } },
      ]),
    });
    const contact = (await tenantDb.query('db-acme', `SELECT * FROM contacts WHERE id = 'c1'`))
      .results[0] as Record<string, unknown>;
    expect(contact.visitor_id).toBe('a1b2c3d4e5f60718');
    // The visitor's earlier first seen folds in as the first touch.
    expect(contact.first_touch_at).toBe('2026-05-01T10:00:00.000Z');
  });

  it('scrubs sensitive fields server side even if a client sends them', async () => {
    await req(env, '/ingest/acme/pixel', {
      method: 'POST',
      body: pixelBody([
        {
          k: 'form_submit',
          t: '2026-05-01T10:02:00.000Z',
          fi: 'f1',
          fd: { email: 'j@x.com', password: 'hunter2', card_number: '4111111111111111', cvv: '123', ssn: '111-22-3333' },
        },
      ]),
    });
    const events = await tenantDb.query('db-acme', `SELECT payload_json FROM events`);
    const payload = JSON.stringify(events.results);
    expect(payload).not.toContain('hunter2');
    expect(payload).not.toContain('4111111111111111');
    expect(payload).not.toContain('111-22-3333');
    expect(payload).toContain('j@x.com');
  });

  it('rejects malformed pixel bodies', async () => {
    const res = await req(env, '/ingest/acme/pixel', { method: 'POST', body: 'not json' });
    expect(res.status).toBe(400);
  });
});

describe('tracking script', () => {
  it('serves the per tenant script under 6KB with the sensitive field guard', async () => {
    const { env } = setup();
    const res = await req(env, '/t/acme.js');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('javascript');
    const body = await res.text();
    expect(body.length).toBeLessThan(6 * 1024);
    expect(body).toContain('_lbi_vid');
    expect(body).toContain('sendBeacon');
    expect(body).toContain('password');
    expect(body).toContain("identify");
    expect(body).toContain('"s":"acme"');
    expect(body).toContain("/ingest/");
  });
});
