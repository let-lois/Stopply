// Campaign type tagging: the manual objective tag stored in campaign_meta
// (migration 0003), joined into the months payload, surviving rollup
// recomputes (campaign_metrics itself is deleted and reinserted every
// rollup, which is exactly why the tag lives in its own table).

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
  schema_version: 3,
  theme_json: null,
  layout_json: null,
  custom_hostname: 'bi.beclinical.com',
  hostname_status: 'active',
  footer_credit: 1,
  funnel_labels_json: null,
  created_at: '2026-01-01T00:00:00Z',
};

const MONTH = '2026-06';

describe('campaign type tagging', () => {
  let env: ReturnType<typeof makeEnv>;
  let tenantDb: SqliteTenantD1;
  let headers: Record<string, string>;

  beforeEach(async () => {
    clearResolverCache();
    tenantDb = new SqliteTenantD1();
    env = makeEnv({ __tenantD1: tenantDb });
    (env.CONTROL_DB as FakeD1).on(/FROM tenants WHERE custom_hostname = \?/, (params) => ({
      first: params[0] === 'bi.beclinical.com' ? TENANT_ROW : null,
    }));
    (env.CONTROL_DB as FakeD1).on(/INSERT INTO audit_log/, () => ({}));
    await tenantDb.query(
      'db-beclinical',
      `INSERT INTO campaign_metrics (period_month, channel, campaign, spend, leads, completed, revenue)
       VALUES ('${MONTH}', 'Meta', 'Filler Intro — June', 6200, 58, 21, 15400),
              ('${MONTH}', 'Google', 'Brand Search', 2000, 26, 12, 9100)`
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

  function patch(body: unknown) {
    return app.request(
      'https://bi.beclinical.com/api/tenant/campaigns/type',
      { method: 'PATCH', headers, body: JSON.stringify(body) },
      env as unknown as Env
    );
  }

  function getMonth() {
    return app.request(`https://bi.beclinical.com/api/tenant/months/${MONTH}`, { headers }, env as unknown as Env);
  }

  it('defaults campaign_type to null in the months payload', async () => {
    const res = await getMonth();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.campaigns).toHaveLength(2);
    expect(body.campaigns.every((r: Record<string, unknown>) => r.campaign_type === null)).toBe(true);
  });

  it('tags a campaign and returns the type on every month it appears in', async () => {
    const patchRes = await patch({ channel: 'Meta', campaign: 'Filler Intro — June', campaignType: 'Lead Generation' });
    expect(patchRes.status).toBe(200);
    const body = await (await getMonth()).json();
    const byCampaign = Object.fromEntries(body.campaigns.map((r: Record<string, unknown>) => [r.campaign, r]));
    expect(byCampaign['Filler Intro — June'].campaign_type).toBe('Lead Generation');
    expect(byCampaign['Brand Search'].campaign_type).toBeNull();
  });

  it('survives a campaign_metrics recompute (delete and reinsert)', async () => {
    await patch({ channel: 'Google', campaign: 'Brand Search', campaignType: 'Search' });
    await tenantDb.query('db-beclinical', `DELETE FROM campaign_metrics`);
    await tenantDb.query(
      'db-beclinical',
      `INSERT INTO campaign_metrics (period_month, channel, campaign, spend, leads, completed, revenue)
       VALUES ('${MONTH}', 'Google', 'Brand Search', 2100, 30, 14, 9900)`
    );
    const body = await (await getMonth()).json();
    expect(body.campaigns[0].campaign_type).toBe('Search');
  });

  it('re-tagging overwrites the previous type', async () => {
    await patch({ channel: 'Meta', campaign: 'Filler Intro — June', campaignType: 'Awareness' });
    await patch({ channel: 'Meta', campaign: 'Filler Intro — June', campaignType: 'Lead Generation' });
    const rows = await tenantDb.query('db-beclinical', `SELECT * FROM campaign_meta`);
    expect(rows.results).toHaveLength(1);
    expect((rows.results[0] as Record<string, unknown>).campaign_type).toBe('Lead Generation');
  });

  it('403s a viewer on the campaign type patch', async () => {
    const viewer = await createSession(env as unknown as Env, {
      userType: 'tenant',
      userId: 'u_viewer',
      role: 'viewer',
      tenantId: 't_beclinical',
      assignedTenants: null,
    });
    const res = await app.request(
      'https://bi.beclinical.com/api/tenant/campaigns/type',
      {
        method: 'PATCH',
        headers: {
          cookie: `lbi_session=${viewer.token}`,
          'x-csrf-token': viewer.csrf,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ channel: 'Meta', campaign: 'Filler Intro — June', campaignType: 'Awareness' }),
      },
      env as unknown as Env
    );
    expect(res.status).toBe(403);
  });
});
