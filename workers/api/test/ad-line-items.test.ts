// Ad line item breakdown, end to end through the real pipeline: CSV
// parser, the import route, and the months endpoint's status
// classification (top performer / watch / underperforming by cost per
// lead relative to the campaign average). Numbers mirror the Be Clinical
// June 2026 look-and-feel mockup the client signed off on.

import { describe, it, expect, beforeEach } from 'vitest';
import { app } from '../src/index';
import { FakeD1, makeEnv } from './helpers';
import { SqliteTenantD1 } from './sqliteTenant';
import { clearResolverCache } from '../src/tenantResolver';
import { createSession } from '../src/session';
import type { Env } from '../src/env';

const TENANT_ROW = {
  id: 't_beclinical',
  slug: 'beclinical',
  name: 'Be Clinical',
  status: 'active',
  plan: 'whitelabel',
  timezone: 'America/Los_Angeles',
  d1_database_id: 'db-beclinical',
  d1_database_name: 'lbi-tenant-beclinical',
  schema_version: 2,
  theme_json: null,
  layout_json: null,
  custom_hostname: 'bi.beclinical.com',
  hostname_status: 'active',
  footer_credit: 1,
  funnel_labels_json: null,
  created_at: '2026-01-01T00:00:00Z',
};

const MONTH = '2026-06';

const META_AD_CSV = [
  'Campaign name,Ad set name,Ad name,Ad ID,Creative type,Amount spent (USD),Results',
  'Filler Intro — June,Filler Intro,Before / After — Filler,120001,Carousel,"2,450.00",31',
  'Filler Intro — June,Filler Intro,Patient Story — Laser,120002,UGC,"1,900.00",14',
  'Filler Intro — June,Filler Intro,$99 Filler Intro Offer,120003,Static,"1,850.00",13',
].join('\n');

const GOOGLE_AD_CSV = [
  'Campaign,Ad,Ad type,Cost,Conversions',
  'Brand Search,Book a consult today,Responsive search ad,"1,200.00",22',
  'Brand Search,Free consult this week,Responsive search ad,"800.00",4',
  'Total: Account,,,"2,000.00",26',
].join('\n');

describe('ad line items', () => {
  let env: ReturnType<typeof makeEnv>;
  let tenantDb: SqliteTenantD1;
  let headers: Record<string, string>;

  beforeEach(async () => {
    clearResolverCache();
    tenantDb = new SqliteTenantD1();
    env = makeEnv({ __tenantD1: tenantDb, CSV_BUCKET: { put: async () => undefined } });
    (env.CONTROL_DB as FakeD1).on(/FROM tenants WHERE custom_hostname = \?/, (params) => ({
      first: params[0] === 'bi.beclinical.com' ? TENANT_ROW : null,
    }));
    (env.CONTROL_DB as FakeD1).on(/INSERT INTO audit_log/, () => ({}));
    await tenantDb.query(
      'db-beclinical',
      `INSERT INTO sources (key, name, kind, connector_type) VALUES
       ('meta-ads-csv', 'Meta Ads CSV (by ad)', 'csv', 'meta-ad-lineitem'),
       ('google-ads-csv', 'Google Ads CSV (by ad)', 'csv', 'google-ad-lineitem')`
    );
    const { token, csrf } = await createSession(env as unknown as Env, {
      userType: 'tenant',
      userId: 'u_admin',
      role: 'account_admin',
      tenantId: 't_beclinical',
      assignedTenants: null,
    });
    headers = {
      cookie: `lbi_session=${token}`,
      'x-csrf-token': csrf,
      'content-type': 'application/json',
    };
  });

  function post(path: string, body: unknown) {
    return app.request(
      `https://bi.beclinical.com${path}`,
      { method: 'POST', headers, body: JSON.stringify(body) },
      env as unknown as Env
    );
  }

  function patch(path: string, body: unknown) {
    return app.request(
      `https://bi.beclinical.com${path}`,
      { method: 'PATCH', headers, body: JSON.stringify(body) },
      env as unknown as Env
    );
  }

  function getMonth() {
    return app.request(`https://bi.beclinical.com/api/tenant/months/${MONTH}`, { headers }, env as unknown as Env);
  }

  it('imports ad level CSVs from both platforms into one table', async () => {
    await post('/api/imports', { sourceKey: 'meta-ads-csv', month: MONTH, csv: META_AD_CSV });
    await post('/api/imports', { sourceKey: 'google-ads-csv', month: MONTH, csv: GOOGLE_AD_CSV });
    const rows = await tenantDb.query('db-beclinical', `SELECT * FROM ad_line_items ORDER BY channel, spend DESC`);
    expect(rows.results).toHaveLength(5);
    expect(rows.results.every((r) => (r as Record<string, unknown>).creative_type_source === 'auto')).toBe(true);
    // The Google "Total: Account" row has no ad name and is dropped.
    expect(rows.results.some((r) => (r as Record<string, unknown>).ad_name === '')).toBe(false);
  });

  it('classifies status by cost per lead relative to the campaign average', async () => {
    await post('/api/imports', { sourceKey: 'meta-ads-csv', month: MONTH, csv: META_AD_CSV });
    await post('/api/imports', { sourceKey: 'google-ads-csv', month: MONTH, csv: GOOGLE_AD_CSV });
    const res = await getMonth();
    expect(res.status).toBe(200);
    const body = await res.json();
    const byAd = Object.fromEntries(body.adLineItems.map((r: Record<string, unknown>) => [r.ad_name, r]));

    // Filler Intro campaign average cost/lead is 6200/58 ≈ 106.90.
    expect(byAd['Before / After — Filler'].cost_per_lead).toBeCloseTo(79.03, 1);
    expect(byAd['Before / After — Filler'].status).toBe('top');
    expect(byAd['Patient Story — Laser'].status).toBe('watch');
    expect(byAd['$99 Filler Intro Offer'].status).toBe('under');

    // Brand Search campaign average cost/lead is 2000/26 ≈ 76.92.
    expect(byAd['Book a consult today'].status).toBe('top');
    expect(byAd['Free consult this week'].status).toBe('under');

    expect(body.adLineItems).toHaveLength(5);
  });

  it('lets staff correct a creative type, flagging it manual', async () => {
    await post('/api/imports', { sourceKey: 'meta-ads-csv', month: MONTH, csv: META_AD_CSV });
    const patchRes = await patch('/api/tenant/ad-line-items/creative-type', {
      periodMonth: MONTH,
      channel: 'Meta',
      campaign: 'Filler Intro — June',
      adName: 'Patient Story — Laser',
      creativeType: 'Video',
    });
    expect(patchRes.status).toBe(200);
    const res = await getMonth();
    const body = await res.json();
    const patched = body.adLineItems.find((r: Record<string, unknown>) => r.ad_name === 'Patient Story — Laser');
    expect(patched.creative_type).toBe('Video');
    expect(patched.creative_type_source).toBe('manual');
  });

  it('re importing the same source replaces its rows for the month', async () => {
    await post('/api/imports', { sourceKey: 'meta-ads-csv', month: MONTH, csv: META_AD_CSV });
    const smaller = 'Campaign name,Ad name,Amount spent (USD),Results\nFiller Intro — June,Solo ad,"500.00",5\n';
    await post('/api/imports', { sourceKey: 'meta-ads-csv', month: MONTH, csv: smaller });
    const rows = await tenantDb.query('db-beclinical', `SELECT * FROM ad_line_items WHERE channel = 'Meta'`);
    expect(rows.results).toHaveLength(1);
  });

  it('403s a viewer on the creative type patch', async () => {
    const { token, csrf } = await createSession(env as unknown as Env, {
      userType: 'tenant',
      userId: 'u_viewer',
      role: 'viewer',
      tenantId: 't_beclinical',
      assignedTenants: null,
    });
    const res = await app.request(
      'https://bi.beclinical.com/api/tenant/ad-line-items/creative-type',
      {
        method: 'PATCH',
        headers: { cookie: `lbi_session=${token}`, 'x-csrf-token': csrf, 'content-type': 'application/json' },
        body: JSON.stringify({
          periodMonth: MONTH,
          channel: 'Meta',
          campaign: 'Filler Intro — June',
          adName: 'Patient Story — Laser',
          creativeType: 'Video',
        }),
      },
      env as unknown as Env
    );
    expect(res.status).toBe(403);
  });
});
