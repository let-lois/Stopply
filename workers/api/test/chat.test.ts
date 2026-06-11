import { describe, it, expect, beforeEach } from 'vitest';
import { app } from '../src/index';
import { FakeD1, makeEnv } from './helpers';
import { SqliteTenantD1 } from './sqliteTenant';
import { clearResolverCache } from '../src/tenantResolver';
import { createSession } from '../src/session';
import { canUseTool, toolsForSession } from '../src/chat/tools';
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
  theme_json: JSON.stringify({ accent: '#3F5A52' }),
  layout_json: null,
  custom_hostname: 'bi.acme.com',
  hostname_status: 'active',
  footer_credit: 1,
  funnel_labels_json: null,
  created_at: '2026-01-01T00:00:00Z',
};

describe('tool role scoping', () => {
  it('viewers get no tools at all', () => {
    expect(toolsForSession('viewer', false)).toHaveLength(0);
    expect(toolsForSession('viewer', true)).toHaveLength(0);
  });

  it('account_admin gets the account tool set but never code mode tools', () => {
    const names = toolsForSession('account_admin', true).map((t) => t.name);
    expect(names).toContain('update_targets');
    expect(names).toContain('invite_user');
    expect(names).toContain('verify_source');
    expect(names).toContain('set_funnel_labels');
    expect(names).not.toContain('edit_layout_json');
    expect(names).not.toContain('edit_custom_css');
  });

  it('agency_admin gets code mode tools only when code mode is on', () => {
    const off = toolsForSession('agency_admin', false).map((t) => t.name);
    const on = toolsForSession('agency_admin', true).map((t) => t.name);
    expect(off).not.toContain('edit_layout_json');
    expect(on).toContain('edit_layout_json');
    expect(on).toContain('edit_custom_css');
  });

  it('canUseTool rejects forged code mode for lesser roles', () => {
    expect(canUseTool('account_admin', 'edit_layout_json', true)).toBe(false);
    expect(canUseTool('agency_staff', 'edit_custom_css', true)).toBe(false);
    expect(canUseTool('viewer', 'update_targets', false)).toBe(false);
    expect(canUseTool('agency_admin', 'edit_layout_json', true)).toBe(true);
  });

  it('propose_code_change is unreachable', () => {
    expect(canUseTool('agency_admin', 'propose_code_change', true)).toBe(false);
    expect(toolsForSession('agency_admin', true).map((t) => t.name)).not.toContain('propose_code_change');
  });
});

describe('chat execute and revert', () => {
  let env: ReturnType<typeof makeEnv>;
  let tenantDb: SqliteTenantD1;
  let auditRows: unknown[][];
  let chatLogRows: Map<string, Record<string, unknown>>;

  function headersFor(token: string, csrf: string) {
    return { cookie: `lbi_session=${token}`, 'x-csrf-token': csrf, 'content-type': 'application/json' };
  }

  beforeEach(async () => {
    clearResolverCache();
    tenantDb = new SqliteTenantD1();
    auditRows = [];
    chatLogRows = new Map();
    env = makeEnv({ __tenantD1: tenantDb });
    const control = env.CONTROL_DB as FakeD1;
    control.on(/FROM tenants WHERE custom_hostname = \?/, (params) => ({
      first: params[0] === 'bi.acme.com' ? TENANT_ROW : null,
    }));
    control.on(/INSERT INTO audit_log/, (params) => {
      auditRows.push(params);
      return {};
    });
    control.on(/INSERT INTO chat_tool_log/, (params) => {
      chatLogRows.set(String(params[0]), {
        id: params[0],
        tenant_id: params[1],
        user_id: params[2],
        role: params[3],
        tool_name: params[4],
        input_json: params[5],
        result: params[6],
        reverted: 0,
      });
      return {};
    });
    control.on(/FROM chat_tool_log WHERE id = \?/, (params) => {
      const row = chatLogRows.get(String(params[0]));
      return { first: row && row.reverted === 0 ? row : null };
    });
    control.on(/UPDATE chat_tool_log SET reverted = 1/, (params) => {
      const row = chatLogRows.get(String(params[0]));
      if (row) row.reverted = 1;
      return {};
    });
    control.on(/SELECT before_json FROM audit_log/, () => {
      // The most recent chat audit row's before payload.
      const last = auditRows[auditRows.length - 1];
      return { first: { before_json: (last?.[7] as string) ?? null } };
    });
  });

  async function login(role: string, userType: 'agency' | 'tenant') {
    const { token, csrf } = await createSession(env as unknown as Env, {
      userType,
      userId: 'u_chat',
      role: role as never,
      tenantId: 't_acme',
      assignedTenants: userType === 'agency' ? ['t_acme'] : null,
    });
    return headersFor(token, csrf);
  }

  function execute(headers: Record<string, string>, body: unknown) {
    return app.request(
      'https://bi.acme.com/api/chat/execute',
      { method: 'POST', headers, body: JSON.stringify(body) },
      env as unknown as Env
    );
  }

  it('account_admin updates targets through chat with audit and chat log rows', async () => {
    const headers = await login('account_admin', 'tenant');
    const res = await execute(headers, {
      toolName: 'update_targets',
      input: { month: '2026-06', targets: { completed: 40, revenue: 60000 } },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { logId: string; before: unknown; after: unknown };
    expect(body.logId).toBeTruthy();
    const targets = await tenantDb.query('db-acme', `SELECT * FROM targets ORDER BY metric`);
    expect(targets.results).toHaveLength(2);
    expect(auditRows.length).toBeGreaterThan(0);
    expect(chatLogRows.size).toBe(1);
  });

  it('revert restores the previous targets', async () => {
    const headers = await login('account_admin', 'tenant');
    await tenantDb.query('db-acme', `INSERT INTO targets (period_month, metric, value) VALUES ('2026-06', 'completed', 10)`);
    const res = await execute(headers, {
      toolName: 'update_targets',
      input: { month: '2026-06', targets: { completed: 99 } },
    });
    const { logId } = (await res.json()) as { logId: string };
    let value = (await tenantDb.query<{ value: number }>('db-acme', `SELECT value FROM targets WHERE metric = 'completed'`)).results[0];
    expect(value?.value).toBe(99);

    const revertRes = await app.request(
      'https://bi.acme.com/api/chat/revert',
      { method: 'POST', headers, body: JSON.stringify({ logId }) },
      env as unknown as Env
    );
    expect(revertRes.status).toBe(200);
    value = (await tenantDb.query<{ value: number }>('db-acme', `SELECT value FROM targets WHERE metric = 'completed'`)).results[0];
    expect(value?.value).toBe(10);
  });

  it('a viewer is refused tool execution with 403', async () => {
    const headers = await login('viewer', 'tenant');
    const res = await execute(headers, {
      toolName: 'update_targets',
      input: { month: '2026-06', targets: { completed: 1 } },
    });
    expect(res.status).toBe(403);
  });

  it('a forged code mode call from account_admin returns 403 server side', async () => {
    const headers = await login('account_admin', 'tenant');
    const res = await execute(headers, {
      toolName: 'edit_custom_css',
      input: { css: '.x { color: red; }' },
      codeMode: true,
    });
    expect(res.status).toBe(403);
  });

  it('agency_admin in code mode edits layout json with schema validation', async () => {
    const headers = await login('agency_admin', 'agency');
    const bad = await execute(headers, {
      toolName: 'edit_layout_json',
      input: { layout: { cards: [{ id: 'x', type: 'not-a-type', visible: true }] } },
      codeMode: true,
    });
    expect(bad.status).toBe(422);

    const good = await execute(headers, {
      toolName: 'edit_layout_json',
      input: { layout: { cards: [{ id: 'topline', type: 'kpi', visible: false }] } },
      codeMode: true,
    });
    expect(good.status).toBe(200);
  });

  it('custom css is sanitized on apply', async () => {
    const headers = await login('agency_admin', 'agency');
    const res = await execute(headers, {
      toolName: 'edit_custom_css',
      input: { css: '@import url(evil.com); .a { background: url(http://x) } .b { color: blue; }' },
      codeMode: true,
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { after: string };
    expect(body.after).not.toContain('@import');
    expect(body.after).toContain('color: blue');
  });
});

describe('help search', () => {
  it('returns seeded published articles', async () => {
    clearResolverCache();
    const env = makeEnv();
    const control = env.CONTROL_DB as FakeD1;
    control.on(/FROM help_articles\s+WHERE published = 1 AND/, () => ({
      results: [{ slug: 'upload-csv', title: 'Uploading CSV files', tags: 'csv' }],
    }));
    const { token } = await createSession(env as unknown as Env, {
      userType: 'agency',
      userId: 'u_x',
      role: 'agency_admin',
      tenantId: null,
      assignedTenants: null,
    });
    const res = await app.request(
      'https://bi.letlois.com/api/help/search?q=csv',
      { headers: { cookie: `lbi_session=${token}` } },
      env as unknown as Env
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { articles: Array<{ slug: string }> };
    expect(body.articles[0]?.slug).toBe('upload-csv');
  });
});
