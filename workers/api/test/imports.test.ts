import { describe, it, expect, beforeEach } from 'vitest';
import { app } from '../src/index';
import { FakeD1, makeEnv } from './helpers';
import { SqliteTenantD1 } from './sqliteTenant';
import { clearResolverCache } from '../src/tenantResolver';
import { createSession } from '../src/session';
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
  custom_hostname: 'bi.acme.com',
  hostname_status: 'active',
  footer_credit: 1,
  funnel_labels_json: null,
  created_at: '2026-01-01T00:00:00Z',
};

class FakeR2 {
  objects = new Map<string, string>();
  async put(key: string, value: string) {
    this.objects.set(key, value);
  }
  async get(key: string) {
    const v = this.objects.get(key);
    return v === undefined ? null : { text: async () => v };
  }
}

describe('csv imports', () => {
  let env: ReturnType<typeof makeEnv>;
  let tenantDb: SqliteTenantD1;
  let r2: FakeR2;
  let headers: Record<string, string>;

  beforeEach(async () => {
    clearResolverCache();
    tenantDb = new SqliteTenantD1();
    r2 = new FakeR2();
    env = makeEnv({ __tenantD1: tenantDb, CSV_BUCKET: r2 });
    (env.CONTROL_DB as FakeD1).on(/FROM tenants WHERE custom_hostname = \?/, (params) => ({
      first: params[0] === 'bi.acme.com' ? TENANT_ROW : null,
    }));
    (env.CONTROL_DB as FakeD1).on(/INSERT INTO audit_log/, () => ({}));
    await tenantDb.query(
      'db-acme',
      `INSERT INTO sources (key, name, kind, connector_type) VALUES
       ('meta-csv', 'Meta Ads CSV', 'csv', 'meta-campaign'),
       ('ghl-csv', 'GHL Contacts CSV', 'csv', 'ghl-contacts')`
    );
    const { token, csrf } = await createSession(env as unknown as Env, {
      userType: 'tenant',
      userId: 'u_admin',
      role: 'account_admin',
      tenantId: 't_acme',
      assignedTenants: null,
    });
    headers = {
      cookie: `lbi_session=${token}`,
      'x-csrf-token': csrf,
      'content-type': 'application/json',
    };
  });

  function post(body: unknown) {
    return app.request(
      'https://bi.acme.com/api/imports',
      { method: 'POST', headers, body: JSON.stringify(body) },
      env as unknown as Env
    );
  }

  const META_CSV_V1 = 'Campaign name,Amount spent (USD),Results\nSpring,1000.00,10\nBrand,500.00,5\n';
  const META_CSV_V2 = 'Campaign name,Amount spent (USD),Results\nSpring,1100.00,12\n';

  it('imports ad spend, stores the raw CSV in R2, and records the import', async () => {
    const res = await post({ sourceKey: 'meta-csv', month: '2026-05', csv: META_CSV_V1 });
    expect(res.status).toBe(201);
    const spend = await tenantDb.query('db-acme', `SELECT * FROM raw_ad_spend ORDER BY campaign`);
    expect(spend.results).toHaveLength(2);
    expect((spend.results[1] as Record<string, unknown>).spend).toBe(1000);
    expect([...r2.objects.keys()][0]).toMatch(/^raw\/acme\/meta-csv\/2026-05\//);
    const imports = await tenantDb.query('db-acme', `SELECT * FROM csv_imports`);
    expect(imports.results).toHaveLength(1);
  });

  it('re uploading a month replaces the period rows and resets verification', async () => {
    await post({ sourceKey: 'meta-csv', month: '2026-05', csv: META_CSV_V1 });
    await tenantDb.query(
      'db-acme',
      `UPDATE sources SET verified_by = 'u_x', verified_at = '2026-05-20T00:00:00Z' WHERE key = 'meta-csv'`
    );
    const res = await post({ sourceKey: 'meta-csv', month: '2026-05', csv: META_CSV_V2 });
    expect(res.status).toBe(201);
    const spend = await tenantDb.query('db-acme', `SELECT * FROM raw_ad_spend`);
    expect(spend.results).toHaveLength(1);
    expect((spend.results[0] as Record<string, unknown>).spend).toBe(1100);
    const source = (await tenantDb.query('db-acme', `SELECT * FROM sources WHERE key = 'meta-csv'`))
      .results[0] as Record<string, unknown>;
    expect(source.verified_by).toBeNull();
    expect(source.verified_at).toBeNull();
  });

  it('imports GHL contacts into contacts, events, and lead stage events idempotently', async () => {
    const csv = [
      'Contact Id,First Name,Last Name,Email,Phone,Created,Tags',
      'c1,Jane,Doe,jane@x.com,602-555-0101,5/03/2026,google lead',
      'c2,Bob,Ray,bob@x.com,602-555-0102,5/10/2026,facebook lead',
    ].join('\n');
    await post({ sourceKey: 'ghl-csv', month: '2026-05', csv });
    await post({ sourceKey: 'ghl-csv', month: '2026-05', csv });
    const contacts = await tenantDb.query('db-acme', `SELECT * FROM contacts`);
    expect(contacts.results).toHaveLength(2);
    const leads = await tenantDb.query('db-acme', `SELECT * FROM stage_events WHERE stage = 'lead'`);
    expect(leads.results).toHaveLength(2);
    const events = await tenantDb.query('db-acme', `SELECT * FROM events`);
    expect(events.results).toHaveLength(2);
  });

  it('403s a viewer', async () => {
    const { token, csrf } = await createSession(env as unknown as Env, {
      userType: 'tenant',
      userId: 'u_viewer',
      role: 'viewer',
      tenantId: 't_acme',
      assignedTenants: null,
    });
    const res = await app.request(
      'https://bi.acme.com/api/imports',
      {
        method: 'POST',
        headers: { cookie: `lbi_session=${token}`, 'x-csrf-token': csrf, 'content-type': 'application/json' },
        body: JSON.stringify({ sourceKey: 'meta-csv', month: '2026-05', csv: META_CSV_V1 }),
      },
      env as unknown as Env
    );
    expect(res.status).toBe(403);
  });
});
