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
  plan: 'pro',
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

describe('integrations vault and routes', () => {
  let env: ReturnType<typeof makeEnv>;
  let tenantDb: SqliteTenantD1;
  let headers: Record<string, string>;

  beforeEach(async () => {
    clearResolverCache();
    tenantDb = new SqliteTenantD1();
    env = makeEnv({ __tenantD1: tenantDb });
    (env.CONTROL_DB as FakeD1).on(/FROM tenants WHERE custom_hostname = \?/, (params) => ({
      first: params[0] === 'bi.acme.com' ? TENANT_ROW : null,
    }));
    (env.CONTROL_DB as FakeD1).on(/INSERT INTO audit_log/, () => ({}));
    const { token, csrf } = await createSession(env as unknown as Env, {
      userType: 'tenant',
      userId: 'u_admin',
      role: 'account_admin',
      tenantId: 't_acme',
      assignedTenants: null,
    });
    headers = { cookie: `lbi_session=${token}`, 'x-csrf-token': csrf, 'content-type': 'application/json' };
  });

  function call(path: string, init: RequestInit = {}) {
    return app.request(`https://bi.acme.com${path}`, { ...init, headers: { ...headers, ...(init.headers ?? {}) } }, env as unknown as Env);
  }

  it('stores credentials encrypted and never returns them in any response', async () => {
    const res = await call('/api/tenant/integrations/boulevard/credentials', {
      method: 'PUT',
      body: JSON.stringify({
        provider: 'boulevard',
        credentials: { apiKey: 'blvd_secret_key_123', businessId: 'biz-1' },
      }),
    });
    expect(res.status).toBe(200);
    const saveBody = await res.text();
    expect(saveBody).not.toContain('blvd_secret_key_123');

    // Ciphertext at rest, not plaintext.
    const row = (await tenantDb.query('db-acme', `SELECT * FROM integrations WHERE key = 'boulevard'`))
      .results[0] as Record<string, unknown>;
    expect(String(row.credentials_ciphertext)).not.toContain('blvd_secret_key_123');
    expect(row.credentials_iv).toBeTruthy();

    // The list endpoint exposes only the public shape.
    const list = await call('/api/tenant/integrations');
    const listBody = await list.text();
    expect(listBody).not.toContain('blvd_secret_key_123');
    expect(listBody).not.toContain('ciphertext');
    expect(listBody).not.toContain(String(row.credentials_ciphertext));
  });

  it('seeds default stage mappings on credential save', async () => {
    await call('/api/tenant/integrations/boulevard/credentials', {
      method: 'PUT',
      body: JSON.stringify({ provider: 'boulevard', credentials: { apiKey: 'k', businessId: 'b' } }),
    });
    const maps = await tenantDb.query('db-acme', `SELECT * FROM funnel_stage_map WHERE integration_key = 'boulevard'`);
    expect(maps.results.length).toBeGreaterThanOrEqual(4);
  });

  it('viewers get 403 on credential writes', async () => {
    const { token, csrf } = await createSession(env as unknown as Env, {
      userType: 'tenant',
      userId: 'u_viewer',
      role: 'viewer',
      tenantId: 't_acme',
      assignedTenants: null,
    });
    const res = await app.request(
      'https://bi.acme.com/api/tenant/integrations/boulevard/credentials',
      {
        method: 'PUT',
        headers: { cookie: `lbi_session=${token}`, 'x-csrf-token': csrf, 'content-type': 'application/json' },
        body: JSON.stringify({ provider: 'boulevard', credentials: { apiKey: 'k', businessId: 'b' } }),
      },
      env as unknown as Env
    );
    expect(res.status).toBe(403);
  });

  it('replaces the stage map atomically', async () => {
    await call('/api/tenant/integrations/boulevard/credentials', {
      method: 'PUT',
      body: JSON.stringify({ provider: 'boulevard', credentials: { apiKey: 'k', businessId: 'b' } }),
    });
    const res = await call('/api/tenant/integrations/boulevard/stage-map', {
      method: 'PUT',
      body: JSON.stringify({ mappings: [{ externalEvent: 'appointment.final', stage: 'purchase' }] }),
    });
    expect(res.status).toBe(200);
    const maps = await tenantDb.query('db-acme', `SELECT * FROM funnel_stage_map WHERE integration_key = 'boulevard'`);
    expect(maps.results).toHaveLength(1);
    expect((maps.results[0] as Record<string, unknown>).stage).toBe('purchase');
  });

  it('syncs meta-ads end to end: credentials save, test, then sync writes ad-spend and ad-line-item rows', async () => {
    const originalFetch = global.fetch;
    global.fetch = (async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/insights') && url.includes('level=campaign')) {
        return new Response(
          JSON.stringify({ data: [{ campaign_name: 'MAG | Lead Generation', spend: '100', actions: [{ action_type: 'lead', value: '5' }] }] }),
          { status: 200 }
        );
      }
      if (url.includes('/insights') && url.includes('level=ad')) {
        return new Response(
          JSON.stringify({
            data: [{ campaign_name: 'MAG | Lead Generation', ad_id: 'ad1', ad_name: 'Video Ad 1', spend: '60', actions: [{ action_type: 'lead', value: '3' }] }],
          }),
          { status: 200 }
        );
      }
      return new Response(JSON.stringify({ name: 'Be CLINICAL San Ramon' }), { status: 200 });
    }) as typeof fetch;

    try {
      await call('/api/tenant/integrations/meta-ads/credentials', {
        method: 'PUT',
        body: JSON.stringify({ provider: 'meta-ads', credentials: { accessToken: 'tok', adAccountId: '4048063365418328' } }),
      });

      const testRes = await call('/api/tenant/integrations/meta-ads/test', { method: 'POST', body: '{}' });
      expect(testRes.status).toBe(200);
      expect(await testRes.json()).toMatchObject({ ok: true, connectedAs: 'Be CLINICAL San Ramon' });

      const syncRes = await call('/api/tenant/integrations/meta-ads/sync', {
        method: 'POST',
        body: JSON.stringify({ month: '2026-06' }),
      });
      expect(syncRes.status).toBe(200);
      expect(await syncRes.json()).toMatchObject({ ok: true, stats: { adSpendRows: 1, adLineItemRows: 1 } });

      const spend = await tenantDb.query('db-acme', `SELECT * FROM raw_ad_spend WHERE period_month = '2026-06'`);
      expect(spend.results).toEqual([
        expect.objectContaining({ channel: 'Meta', campaign: 'MAG | Lead Generation', spend: 100, leads_reported: 5 }),
      ]);
      const lineItems = await tenantDb.query('db-acme', `SELECT * FROM ad_line_items WHERE period_month = '2026-06'`);
      expect(lineItems.results).toEqual([
        expect.objectContaining({ channel: 'Meta', campaign: 'MAG | Lead Generation', ad_name: 'Video Ad 1', spend: 60, leads_reported: 3 }),
      ]);
    } finally {
      global.fetch = originalFetch;
    }
  });
});
