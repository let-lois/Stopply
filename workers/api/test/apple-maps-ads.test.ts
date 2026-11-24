// Apple Maps Ads through the real routes, against the real tenant schema in
// SQLite and MOCK Apple Ads Platform API responses. No live Apple account.
//
// What is pinned: connect, test and sync write daily, location and
// placement rows exactly once; spend joins the monthly rollup under the
// Apple Maps channel with no invented leads; re-syncing never duplicates;
// the report's totals come from one cut only; unavailable ratios are null;
// failures land as states an administrator can act on; disabling stops
// syncs; disconnect forgets credentials; every change is audited; one
// client can never read another's report; nothing calls Apple except to read.

import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';
import { app } from '../src/index';
import { FakeD1, makeEnv } from './helpers';
import { SqliteTenantD1 } from './sqliteTenant';
import { clearResolverCache } from '../src/tenantResolver';
import { createSession } from '../src/session';
import type { Env } from '../src/env';
import { MOCK, appleAdsMock, mockCredentials, mockSigningKeys, type AppleMockOptions } from '../../../packages/connectors/test/fixtures/apple-maps-ads';

function tenantRow(id: string, slug: string, host: string, dbId: string) {
  return {
    id,
    slug,
    name: slug,
    status: 'active',
    plan: 'pro',
    timezone: 'America/Phoenix',
    d1_database_id: dbId,
    d1_database_name: `lbi-tenant-${slug}`,
    schema_version: 8,
    theme_json: null,
    layout_json: null,
    custom_hostname: host,
    hostname_status: 'active',
    footer_credit: 1,
    funnel_labels_json: null,
    created_at: '2026-01-01T00:00:00Z',
  };
}

const ACME = tenantRow('t_acme', 'acme', 'bi.acme.test', 'db-acme');
const RIVAL = tenantRow('t_rival', 'rival', 'bi.rival.test', 'db-rival');
const TOKEN = 'o'.repeat(48);

// One real database per tenant, so a read of the wrong one shows up.
// Foreign keys on, as D1 enforces them, so write order is tested too.
class PerTenantD1 {
  dbs = new Map<string, SqliteTenantD1>();
  of(id: string) {
    if (!this.dbs.has(id)) {
      const db = new SqliteTenantD1();
      db.db.pragma('foreign_keys = ON');
      this.dbs.set(id, db);
    }
    return this.dbs.get(id)!;
  }
  async query(id: string, sql: string, params: unknown[] = []) {
    return this.of(id).query(id, sql, params);
  }
  async batch(id: string, statements: Array<{ sql: string; params?: unknown[] }>) {
    return this.of(id).batch(id, statements);
  }
}

let privateKey = '';
beforeAll(async () => {
  privateKey = (await mockSigningKeys()).sec1.privateKey;
});

describe('Apple Maps Ads integration', () => {
  let env: ReturnType<typeof makeEnv>;
  let dbs: PerTenantD1;
  let audit: unknown[][];
  let admin: Record<string, string>;
  let viewer: Record<string, string>;
  let mock: ReturnType<typeof appleAdsMock>;
  const originalFetch = global.fetch;

  const useApple = (options: AppleMockOptions = {}) => {
    mock = appleAdsMock(options);
    global.fetch = mock.fetchImpl;
  };

  beforeEach(async () => {
    clearResolverCache();
    dbs = new PerTenantD1();
    audit = [];
    env = makeEnv({ __tenantD1: dbs, OPERATIONS_API_TOKEN: TOKEN });
    const control = env.CONTROL_DB as FakeD1;
    control.on(/FROM tenants WHERE custom_hostname = \?/, (p) => ({ first: p[0] === ACME.custom_hostname ? ACME : p[0] === RIVAL.custom_hostname ? RIVAL : null }));
    control.on(/FROM tenants WHERE id = \?/, (p) => ({ first: p[0] === ACME.id ? ACME : p[0] === RIVAL.id ? RIVAL : null }));
    control.on(/INSERT INTO audit_log/, (p) => {
      audit.push(p);
      return {};
    });
    const session = async (userId: string, role: 'account_admin' | 'viewer', tenantId = ACME.id) => {
      const { token, csrf } = await createSession(env as unknown as Env, { userType: 'tenant', userId, role, tenantId, assignedTenants: null });
      return { cookie: `lbi_session=${token}`, 'x-csrf-token': csrf, 'content-type': 'application/json' };
    };
    admin = await session('u_admin', 'account_admin');
    viewer = await session('u_viewer', 'viewer');
    useApple();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  const call = (path: string, init: RequestInit = {}, headers = admin, host = ACME.custom_hostname) =>
    app.request(`https://${host}${path}`, { ...init, headers: { ...headers, ...(init.headers ?? {}) } }, env as unknown as Env);
  const rows = async (sql: string, db = 'db-acme') => (await dbs.of(db).query(db, sql)).results as Array<Record<string, unknown>>;
  const actions = () => audit.map((p) => p.find((v) => typeof v === 'string' && v.startsWith('integration.')));

  async function connect(extra: Record<string, string> = {}) {
    const save = await call('/api/tenant/integrations/apple-maps/credentials', {
      method: 'PUT',
      body: JSON.stringify({ provider: 'apple-maps-ads', credentials: mockCredentials(privateKey, extra) }),
    });
    expect(save.status).toBe(200);
    return call('/api/tenant/integrations/apple-maps/test', { method: 'POST', body: '{}' });
  }
  const sync = (month = '2026-10') => call('/api/tenant/integrations/apple-maps/sync', { method: 'POST', body: JSON.stringify({ month }) });
  const integration = async () => {
    const res = await call('/api/tenant/integrations');
    const body = (await res.json()) as { integrations: Array<Record<string, unknown>> };
    return body.integrations.find((i) => i.key === 'apple-maps')!;
  };

  it('connects, tests and syncs a month into every table, once', async () => {
    const test = await connect();
    expect(await test.json()).toMatchObject({ ok: true, connectedAs: `[MOCK] Demo Brand Maps (${MOCK.mapsAccountId})` });
    expect(await integration()).toMatchObject({ state: 'connected', stateLabel: 'Connected' });

    const res = await sync();
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      ok: true,
      stats: { campaigns: 2, dailyRows: 12, locations: 2, adSpendRows: 2, adLineItemRows: 2, unifiedSpend: true, currency: 'USD', range: { from: '2026-10-01', to: '2026-10-31' } },
    });

    const campaigns = await rows(`SELECT campaign_id, name, status, daily_budget, promoted_object_id FROM ad_platform_campaigns ORDER BY campaign_id`);
    expect(campaigns).toEqual([
      { campaign_id: String(MOCK.campaignDowntown), name: '[MOCK] Maps Search Downtown', status: 'ENABLED', daily_budget: 50, promoted_object_id: MOCK.brandId },
      { campaign_id: String(MOCK.campaignHome), name: '[MOCK] Maps Home Brand', status: 'PAUSED', daily_budget: 20, promoted_object_id: MOCK.brandId },
    ]);
    // The App Store row in the fixture never lands.
    expect(await rows(`SELECT * FROM ad_platform_daily WHERE campaign_id = '${MOCK.campaignAppStore}'`)).toEqual([]);
    expect(await rows(`SELECT breakdown, COUNT(*) AS n, SUM(spend) AS spend FROM ad_platform_daily GROUP BY breakdown ORDER BY breakdown`)).toEqual([
      { breakdown: 'campaign', n: 3, spend: 60 },
      { breakdown: 'location', n: 5, spend: 60 },
      { breakdown: 'placement', n: 4, spend: 60 },
    ]);
    expect(await rows(`SELECT location_id, name, locality FROM ad_platform_locations ORDER BY location_id`)).toEqual([
      { location_id: MOCK.locationDowntown, name: '[MOCK] Demo Brand Downtown', locality: 'Phoenix' },
      { location_id: MOCK.locationUptown, name: '[MOCK] Demo Brand Uptown', locality: 'Phoenix' },
    ]);

    // Spend joins the existing monthly pipeline, with no leads invented.
    expect(await rows(`SELECT channel, campaign, spend, leads_reported FROM raw_ad_spend WHERE period_month = '2026-10' ORDER BY campaign`)).toEqual([
      { channel: 'Apple Maps', campaign: '[MOCK] Maps Home Brand', spend: 10, leads_reported: null },
      { channel: 'Apple Maps', campaign: '[MOCK] Maps Search Downtown', spend: 50, leads_reported: null },
    ]);
    expect(await rows(`SELECT channel, spend, leads FROM monthly_metrics WHERE period_month = '2026-10' AND attribution_basis = 'first'`)).toEqual([
      { channel: 'Apple Maps', spend: 60, leads: 0 },
    ]);
    expect(await rows(`SELECT channel, ad_name, spend FROM ad_line_items WHERE period_month = '2026-10' ORDER BY ad_name`)).toEqual([
      { channel: 'Apple Maps', ad_name: '[MOCK] Downtown creative A', spend: 50 },
      { channel: 'Apple Maps', ad_name: '[MOCK] Home creative', spend: 10 },
    ]);

    expect(await rows(`SELECT status, campaigns, rows_written, range_from, range_to FROM ad_platform_sync_runs`)).toEqual([
      { status: 'succeeded', campaigns: 2, rows_written: 12, range_from: '2026-10-01', range_to: '2026-10-31' },
    ]);
    expect(await integration()).toMatchObject({ state: 'synced', stateLabel: 'Successfully synced' });
    expect(actions()).toEqual(['integration.credentials.set', 'integration.test', 'integration.sync']);
  });

  it('only ever reads from Apple: GET, and POST to /query endpoints', async () => {
    await connect();
    await sync();
    const apple = mock.requests.filter((r) => r.url.startsWith('https://api.ads.apple.com'));
    expect(apple.length).toBeGreaterThan(0);
    for (const r of apple) {
      expect(['GET', 'POST']).toContain(r.method);
      if (r.method === 'POST') expect(r.url).toMatch(/\/query$/);
      // Business brand (Apple Maps) reports only, never the App Store ones.
      expect(r.url).not.toContain('/reports/apps/');
    }
  });

  it('re-syncing the same month replaces rows instead of adding to them', async () => {
    await connect();
    await sync();
    await sync();
    expect(await rows(`SELECT COUNT(*) AS n FROM ad_platform_daily`)).toEqual([{ n: 12 }]);
    expect(await rows(`SELECT COUNT(*) AS n FROM raw_ad_spend WHERE channel = 'Apple Maps'`)).toEqual([{ n: 2 }]);
    expect(await rows(`SELECT SUM(spend) AS s FROM ad_platform_daily WHERE breakdown = 'campaign'`)).toEqual([{ s: 60 }]);
  });

  it('reports totals from one cut, ratios from sums, and N/A where there is nothing to divide by', async () => {
    await connect();
    await sync();
    const res = await call('/api/tenant/ad-platforms/apple_maps?from=2026-10-01&to=2026-10-31', {}, viewer);
    expect(res.status).toBe(200);
    const report = (await res.json()) as Record<string, any>;
    expect(report.totals).toEqual({ spend: 60, impressions: 2500, clicks: 100, ctr: 0.04, cpc: 0.6, conversions: 15, costPerConversion: 4 });
    expect(report.actions).toMatchObject({ getDirections: 9, call: 5, tapURL: 1, share: null });
    expect(report.previousRange).toEqual({ from: '2026-08-31', to: '2026-09-30' });
    expect(report.previous).toMatchObject({ spend: 0, ctr: null, cpc: null, conversions: null });

    const home = report.campaigns.find((c: { campaignId: string }) => c.campaignId === String(MOCK.campaignHome));
    expect(home).toMatchObject({ spend: 10, impressions: 0, ctr: null, cpc: null, conversions: null, costPerConversion: null, status: 'PAUSED', dailyBudget: 20 });

    // Each cut adds up to the same total; the report never adds the cuts.
    const sum = (list: Array<{ spend: number }>) => list.reduce((n, r) => n + r.spend, 0);
    expect(sum(report.campaigns)).toBe(60);
    expect(sum(report.locations)).toBe(60);
    expect(sum(report.placements)).toBe(60);
    expect(report.locations.map((l: { label: string }) => l.label)).toContain('[MOCK] Demo Brand Downtown, Phoenix, Arizona');
    expect(report.placements.map((p: { label: string }) => p.label).sort()).toEqual(['Search home', 'Search home', 'Search results']);
    expect(report.daily.map((d: { date: string }) => d.date)).toEqual(['2026-10-01', '2026-10-02']);
    expect(report.connection).toMatchObject({ state: 'synced', enabled: true });
    expect(report.labels).toMatchObject({ clicks: 'Taps', clickRate: 'TTR', costPerClick: 'Avg. CPT' });
  });

  it('answers a client with nothing connected with an empty report, not an error', async () => {
    const res = await call('/api/tenant/ad-platforms/apple_maps?from=2026-10-01&to=2026-10-31');
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ connection: null, campaigns: [], totals: { spend: 0, ctr: null, conversions: null } });
    expect((await call('/api/tenant/ad-platforms/tiktok')).status).toBe(404);
    expect((await call('/api/tenant/ad-platforms/apple_maps?from=2026-10-31&to=2026-10-01')).status).toBe(400);
  });

  it('keeps a non USD account out of the combined USD totals and says so', async () => {
    useApple({ currency: 'EUR' });
    await connect();
    const res = await sync();
    const body = (await res.json()) as { stats: { unifiedSpend: boolean; warnings: string[] } };
    expect(body.stats.unifiedSpend).toBe(false);
    expect(body.stats.warnings.join(' ')).toContain('EUR');
    expect(await rows(`SELECT * FROM raw_ad_spend WHERE channel = 'Apple Maps'`)).toEqual([]);
    expect(await rows(`SELECT COUNT(*) AS n FROM ad_platform_daily`)).toEqual([{ n: 12 }]);
  });

  it('says no campaigns were found when the account had none', async () => {
    useApple({ noCampaigns: true });
    await connect();
    await sync();
    expect(await integration()).toMatchObject({ state: 'no_campaigns', stateLabel: 'No campaigns found' });
    expect(await rows(`SELECT status FROM ad_platform_sync_runs`)).toEqual([{ status: 'no_campaigns' }]);
  });

  it('turns a lost permission into Permission required, logged without any secret', async () => {
    await connect();
    useApple({ override: { campaigns: { status: 403, body: { error: { code: 'FORBIDDEN', message: 'Role revoked' } } } } });
    const res = await sync();
    expect(res.status).toBe(502);
    expect(await integration()).toMatchObject({ state: 'permission_required' });
    const [run] = await rows(`SELECT status, failure, error FROM ad_platform_sync_runs`);
    expect(run).toMatchObject({ status: 'failed', failure: 'permission' });
    expect(String(run!.error)).toContain('FORBIDDEN');
    expect(String(run!.error)).not.toContain(MOCK.token);
    expect(String(run!.error)).not.toContain('PRIVATE KEY');
    expect(actions()).toContain('integration.sync_failed');
  });

  it('turns refused credentials into Authentication expired', async () => {
    await connect();
    useApple({ override: { token: { status: 401, body: { error: 'invalid_client' } } } });
    await sync();
    expect(await integration()).toMatchObject({ state: 'auth_expired', stateLabel: 'Authentication expired' });
  });

  it('asks for an ad account to be chosen rather than choosing one', async () => {
    const test = await connect({ adAccountId: '' });
    expect(await test.json()).toMatchObject({ ok: false, planCheck: { failureKind: 'select_account' } });
    expect(await integration()).toMatchObject({ state: 'pending' });
    expect((await sync()).status).toBe(502);
    expect(await rows(`SELECT * FROM ad_platform_campaigns`)).toEqual([]);
  });

  it('disables, re-enables and disconnects, auditing each and keeping history', async () => {
    await connect();
    await sync();
    expect((await call('/api/tenant/integrations/apple-maps/disable', { method: 'POST', body: '{}' })).status).toBe(200);
    expect(await integration()).toMatchObject({ state: 'disabled', enabled: false });
    expect((await sync()).status).toBe(409);

    expect((await call('/api/tenant/integrations/apple-maps/enable', { method: 'POST', body: '{}' })).status).toBe(200);
    expect(await integration()).toMatchObject({ state: 'pending', enabled: true });

    expect((await call('/api/tenant/integrations/apple-maps/disconnect', { method: 'POST', body: '{}' })).status).toBe(200);
    const [row] = await rows(`SELECT status, credentials_ciphertext, credentials_iv FROM integrations WHERE key = 'apple-maps'`);
    expect(row).toEqual({ status: 'disconnected', credentials_ciphertext: null, credentials_iv: null });
    expect(await integration()).toMatchObject({ state: 'not_connected' });
    // Synced figures are the client's history and stay.
    expect(await rows(`SELECT COUNT(*) AS n FROM ad_platform_daily`)).toEqual([{ n: 12 }]);
    expect(actions()).toEqual(
      expect.arrayContaining(['integration.disable', 'integration.enable', 'integration.disconnect'])
    );
  });

  it('never returns the private key or a token in any response', async () => {
    await connect();
    await sync();
    for (const path of ['/api/tenant/integrations', '/api/tenant/ad-platforms/apple_maps?from=2026-10-01&to=2026-10-31']) {
      const text = await (await call(path)).text();
      expect(text).not.toContain('PRIVATE KEY');
      expect(text).not.toContain(privateKey.split('\n')[1]!);
      expect(text).not.toContain(MOCK.token);
      expect(text).not.toContain('ciphertext');
    }
  });

  it('lets a viewer read the report but not manage the integration', async () => {
    await connect();
    for (const action of ['sync', 'disable', 'disconnect']) {
      const res = await call(`/api/tenant/integrations/apple-maps/${action}`, { method: 'POST', body: JSON.stringify({ month: '2026-10' }) }, viewer);
      expect(res.status).toBe(403);
    }
    expect((await call('/api/tenant/ad-platforms/apple_maps', {}, viewer)).status).toBe(200);
  });

  it('keeps each client’s report to its own database', async () => {
    await connect();
    await sync();
    // Another client's session on this client's host is refused outright.
    const { token, csrf } = await createSession(env as unknown as Env, { userType: 'tenant', userId: 'u_rival', role: 'account_admin', tenantId: RIVAL.id, assignedTenants: null });
    const rival = { cookie: `lbi_session=${token}`, 'x-csrf-token': csrf };
    expect((await call('/api/tenant/ad-platforms/apple_maps?from=2026-10-01&to=2026-10-31', {}, rival)).status).toBe(403);
    // On its own host it sees its own, empty, database.
    const own = await call('/api/tenant/ad-platforms/apple_maps?from=2026-10-01&to=2026-10-31', {}, rival, RIVAL.custom_hostname);
    expect(await own.json()).toMatchObject({ campaigns: [], totals: { spend: 0 } });
  });

  it('serves the same report to Operations Center by tenant id, behind the service token', async () => {
    await connect();
    await sync();
    const svc = (path: string, init: RequestInit = {}) => app.request(`https://bi.letlois.com/api/service${path}`, init, env as unknown as Env);
    const auth = { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' };
    const report = await svc(`/tenants/${ACME.id}/ad-platforms/apple_maps?from=2026-10-01&to=2026-10-31`, { headers: auth });
    expect(report.status).toBe(200);
    expect(await report.json()).toMatchObject({ totals: { spend: 60 } });
    const other = await svc(`/tenants/${RIVAL.id}/ad-platforms/apple_maps?from=2026-10-01&to=2026-10-31`, { headers: auth });
    expect(await other.json()).toMatchObject({ totals: { spend: 0 }, campaigns: [] });
    expect((await svc(`/tenants/${ACME.id}/ad-platforms/apple_maps`)).status).toBe(401);

    const actor = { id: 'ops-1', name: 'Ops Person' };
    const disabled = await svc(`/tenants/${ACME.id}/integrations/apple-maps/disable`, { method: 'POST', headers: auth, body: JSON.stringify({ actor }) });
    expect(disabled.status).toBe(200);
    expect(await integration()).toMatchObject({ state: 'disabled' });
  });
});

describe('migration 0008', () => {
  it('keeps every existing integration row and switches them all on', async () => {
    const Database = (await import('better-sqlite3')).default;
    const { TENANT_MIGRATIONS, splitStatements } = await import('@letlois/db/migrations');
    const db = new Database(':memory:');
    const before = TENANT_MIGRATIONS.filter((m) => m.version < 8);
    for (const m of before) for (const s of splitStatements(m.sql)) db.exec(s);
    db.prepare(
      `INSERT INTO integrations (key, provider, status, credentials_ciphertext, credentials_iv, last_sync_result) VALUES ('meta', 'meta-ads', 'connected', 'CT', 'IV', '{"ok":true}')`
    ).run();
    const m8 = TENANT_MIGRATIONS.find((m) => m.version === 8)!;
    expect(m8.name).toBe('0008_ad_platforms');
    for (const s of splitStatements(m8.sql)) db.exec(s);
    expect(db.prepare(`SELECT key, provider, status, credentials_ciphertext, enabled FROM integrations`).all()).toEqual([
      { key: 'meta', provider: 'meta-ads', status: 'connected', credentials_ciphertext: 'CT', enabled: 1 },
    ]);
    expect(() => db.prepare(`INSERT INTO integrations (key, provider) VALUES ('apple', 'apple-maps-ads')`).run()).not.toThrow();
    expect(() => db.prepare(`INSERT INTO integrations (key, provider) VALUES ('x', 'tiktok-ads')`).run()).toThrow(/CHECK/);
  });
});

describe('first sync backfill', () => {
  it('covers every month the backfill window touches', async () => {
    const { monthsCovering } = await import('../../sync/src/index');
    const now = Date.parse('2026-11-24T12:00:00Z');
    expect(monthsCovering(90, now)).toEqual(['2026-11', '2026-10', '2026-09', '2026-08']);
    expect(monthsCovering(1, now)).toEqual(['2026-11']);
  });
});

describe('migration 0008 rerun', () => {
  it('can run twice without losing an integration', async () => {
    const Database = (await import('better-sqlite3')).default;
    const { TENANT_MIGRATIONS, splitStatements } = await import('@letlois/db/migrations');
    const db = new Database(':memory:');
    for (const m of TENANT_MIGRATIONS) for (const s of splitStatements(m.sql)) db.exec(s);
    db.prepare(`INSERT INTO integrations (key, provider, status) VALUES ('apple', 'apple-maps-ads', 'connected')`).run();
    const m8 = TENANT_MIGRATIONS.find((m) => m.version === 8)!;
    for (const s of splitStatements(m8.sql)) db.exec(s);
    expect(db.prepare(`SELECT key, provider, status FROM integrations`).all()).toEqual([{ key: 'apple', provider: 'apple-maps-ads', status: 'connected' }]);
  });
});
