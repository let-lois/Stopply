import { Hono } from 'hono';
import type { Context } from 'hono';
import { z } from 'zod';
import type { SourceRow, TenantUserRow } from '@letlois/db';
import { sourceFreshness } from '@letlois/db';
import type { AppContext } from '../env';
import { tenantScope, tenantWrite } from '../middleware';
import { tenantD1Client, rotateSourceSecret } from '../provisioning';
import { hashPassword, randomToken } from '../crypto';
import { writeAudit } from '../audit';
import { monthAllowed, channelAllowed, parseViewConfig, sanitizeViewConfig } from '../viewConfig';

export const tenantRoutes = new Hono<AppContext>();
tenantRoutes.use('*', tenantScope);

function dbId(c: { get: (k: 'tenant') => { d1_database_id: string | null } | null }): string {
  const tenant = c.get('tenant');
  if (!tenant?.d1_database_id) throw new Error('tenant database missing');
  return tenant.d1_database_id;
}

async function viewerConfig(c: Context<AppContext>): Promise<ReturnType<typeof parseViewConfig>> {
  const session = c.get('session')!;
  if (session.role !== 'viewer') return null;
  const d1 = tenantD1Client(c.env);
  const { results } = await d1.query<{ view_config_json: string | null }>(
    dbId(c),
    `SELECT view_config_json FROM users WHERE id = ?`,
    [session.userId]
  );
  return parseViewConfig(results[0]?.view_config_json ?? null) ?? sanitizeViewConfig(null);
}

// Tenant settings the dashboard shell needs: theme, labels, layout, plan.
tenantRoutes.get('/settings', async (c) => {
  const tenant = c.get('tenant')!;
  const session = c.get('session')!;
  const config = await viewerConfig(c);
  return c.json({
    tenant: {
      id: tenant.id,
      slug: tenant.slug,
      name: tenant.name,
      timezone: tenant.timezone,
      plan: tenant.plan,
      theme: tenant.theme_json ? JSON.parse(tenant.theme_json) : null,
      layout: tenant.layout_json ? JSON.parse(tenant.layout_json) : null,
      funnelLabels: tenant.funnel_labels_json ? JSON.parse(tenant.funnel_labels_json) : null,
      footerCredit: tenant.footer_credit === 1,
      customHostname: tenant.custom_hostname,
      hostnameStatus: tenant.hostname_status,
    },
    role: session.role,
    viewConfig: config,
  });
});

// Months list and per month dashboard payload, filtered server side for
// restricted viewers so direct API calls never leak disallowed data.
tenantRoutes.get('/months', async (c) => {
  const d1 = tenantD1Client(c.env);
  const config = await viewerConfig(c);
  const { results } = await d1.query<{ period_month: string }>(
    dbId(c),
    `SELECT DISTINCT period_month FROM monthly_metrics ORDER BY period_month DESC`
  );
  const months = results.map((r) => r.period_month).filter((m) => monthAllowed(config, m));
  return c.json({ months });
});

const monthParam = z.string().regex(/^\d{4}-\d{2}$/);

tenantRoutes.get('/months/:month', async (c) => {
  const month = monthParam.safeParse(c.req.param('month'));
  if (!month.success) return c.json({ error: 'invalid month' }, 400);
  const config = await viewerConfig(c);
  if (!monthAllowed(config, month.data)) return c.json({ error: 'forbidden' }, 403);
  const basis = c.req.query('basis') === 'latest' ? 'latest' : 'first';

  const d1 = tenantD1Client(c.env);
  const database = dbId(c);
  const [metrics, campaigns, cohort, quality, targets] = await Promise.all([
    d1.query(database, `SELECT * FROM monthly_metrics WHERE period_month = ? AND attribution_basis = ?`, [
      month.data,
      basis,
    ]),
    d1.query(database, `SELECT * FROM campaign_metrics WHERE period_month = ? ORDER BY spend DESC`, [
      month.data,
    ]),
    d1.query(database, `SELECT * FROM lead_cohort WHERE period_month = ?`, [month.data]),
    d1.query(database, `SELECT * FROM month_quality WHERE period_month = ?`, [month.data]),
    d1.query(database, `SELECT * FROM targets WHERE period_month = ?`, [month.data]),
  ]);

  const filterChannel = <T extends { channel?: unknown }>(rows: T[]): T[] =>
    rows.filter((r) => channelAllowed(config, String(r.channel ?? '')));

  return c.json({
    month: month.data,
    basis,
    channels: filterChannel(metrics.results as Array<{ channel?: unknown }>),
    campaigns: filterChannel(campaigns.results as Array<{ channel?: unknown }>),
    cohort: filterChannel(cohort.results as Array<{ channel?: unknown }>),
    quality: quality.results[0] ?? null,
    targets: targets.results,
  });
});

// Lead level drill down. Admin and agency only: viewers never receive it.
tenantRoutes.get('/months/:month/leads', tenantWrite, async (c) => {
  const month = monthParam.safeParse(c.req.param('month'));
  if (!month.success) return c.json({ error: 'invalid month' }, 400);
  const d1 = tenantD1Client(c.env);
  const { results } = await d1.query(
    dbId(c),
    `SELECT * FROM lead_attribution WHERE created_at >= ? AND created_at < ?
     ORDER BY created_at DESC LIMIT 1000`,
    [`${month.data}-01`, nextMonth(month.data)]
  );
  return c.json({ leads: results });
});

function nextMonth(m: string): string {
  const [y, mo] = m.split('-').map((n) => Number(n));
  const d = new Date(Date.UTC(y ?? 2000, (mo ?? 1), 1));
  return d.toISOString().slice(0, 7) + '-01';
}

// Sources with freshness state for the check icons.
tenantRoutes.get('/sources', async (c) => {
  const d1 = tenantD1Client(c.env);
  const { results } = await d1.query<SourceRow>(
    dbId(c),
    `SELECT key, name, kind, connector_type, cadence, platform_link, how_to, verified_by, verified_at,
       records_through, last_import_at, created_at FROM sources ORDER BY name`
  );
  return c.json({
    sources: results.map((s) => ({ ...s, freshness: sourceFreshness(s) })),
  });
});

tenantRoutes.post('/sources/:key/verify', tenantWrite, async (c) => {
  const session = c.get('session')!;
  const key = c.req.param('key');
  const d1 = tenantD1Client(c.env);
  await d1.query(
    dbId(c),
    `UPDATE sources SET verified_by = ?, verified_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE key = ?`,
    [session.userId, key]
  );
  await writeAudit(c.env, {
    actorType: session.userType,
    actorId: session.userId,
    tenantId: c.get('tenant')!.id,
    action: 'source.verify',
    target: key,
  });
  return c.json({ ok: true });
});

// Rotate or create the signing secret for a webhook source. Plaintext is
// returned exactly once.
tenantRoutes.post('/sources/:key/secret', tenantWrite, async (c) => {
  const tenant = c.get('tenant')!;
  const session = c.get('session')!;
  const secret = await rotateSourceSecret(c.env, tenant.id, dbId(c), c.req.param('key') ?? '');
  await writeAudit(c.env, {
    actorType: session.userType,
    actorId: session.userId,
    tenantId: tenant.id,
    action: 'source.secret.rotate',
    target: c.req.param('key'),
  });
  return c.json({ secret });
});

// Team management.
tenantRoutes.get('/users', async (c) => {
  const session = c.get('session')!;
  if (session.role === 'viewer') return c.json({ error: 'forbidden' }, 403);
  const d1 = tenantD1Client(c.env);
  const { results } = await d1.query<Omit<TenantUserRow, 'password_hash'>>(
    dbId(c),
    `SELECT id, email, name, role, view_config_json, active, created_at FROM users ORDER BY name`
  );
  return c.json({ users: results });
});

const inviteSchema = z
  .object({
    email: z.string().email().max(254),
    name: z.string().min(1).max(120),
    role: z.enum(['account_admin', 'viewer']),
    viewConfig: z.unknown().optional(),
  })
  .strict();

tenantRoutes.post('/users', tenantWrite, async (c) => {
  const tenant = c.get('tenant')!;
  const session = c.get('session')!;
  const body = inviteSchema.safeParse(await c.req.json().catch(() => null));
  if (!body.success) return c.json({ error: 'invalid request' }, 400);
  const email = body.data.email.toLowerCase().trim();
  const d1 = tenantD1Client(c.env);
  const existing = await d1.query(dbId(c), `SELECT id FROM users WHERE email = ?`, [email]);
  if (existing.results.length > 0) return c.json({ error: 'email already exists' }, 409);

  const tempPassword = randomToken(9);
  const id = `u_${randomToken(8)}`;
  const viewConfigJson =
    body.data.role === 'viewer' ? JSON.stringify(sanitizeViewConfig(body.data.viewConfig)) : null;
  await d1.query(
    dbId(c),
    `INSERT INTO users (id, email, name, role, password_hash, view_config_json, active) VALUES (?, ?, ?, ?, ?, ?, 1)`,
    [id, email, body.data.name, body.data.role, await hashPassword(tempPassword), viewConfigJson]
  );
  await c.env.CONTROL_DB.prepare(`INSERT OR IGNORE INTO tenant_directory (email, tenant_id) VALUES (?, ?)`)
    .bind(email, tenant.id)
    .run();
  await writeAudit(c.env, {
    actorType: session.userType,
    actorId: session.userId,
    tenantId: tenant.id,
    action: 'tenant_user.create',
    target: email,
    after: { id, role: body.data.role },
  });
  return c.json({ id, email, tempPassword }, 201);
});

const viewConfigSchema = z.object({ viewConfig: z.unknown() }).strict();

tenantRoutes.put('/users/:id/view-config', tenantWrite, async (c) => {
  const tenant = c.get('tenant')!;
  const session = c.get('session')!;
  const body = viewConfigSchema.safeParse(await c.req.json().catch(() => null));
  if (!body.success) return c.json({ error: 'invalid request' }, 400);
  const sanitized = sanitizeViewConfig(body.data.viewConfig);
  const d1 = tenantD1Client(c.env);
  const before = await d1.query(dbId(c), `SELECT view_config_json FROM users WHERE id = ?`, [
    c.req.param('id'),
  ]);
  await d1.query(dbId(c), `UPDATE users SET view_config_json = ? WHERE id = ? AND role = 'viewer'`, [
    JSON.stringify(sanitized),
    c.req.param('id'),
  ]);
  await writeAudit(c.env, {
    actorType: session.userType,
    actorId: session.userId,
    tenantId: tenant.id,
    action: 'tenant_user.view_config',
    target: c.req.param('id'),
    before: before.results[0] ?? null,
    after: sanitized,
  });
  return c.json({ ok: true, viewConfig: sanitized });
});

// Targets editor.
const targetsSchema = z
  .object({
    month: z.string().regex(/^\d{4}-\d{2}$/),
    targets: z.record(z.string().max(40), z.number().finite()).refine((t) => Object.keys(t).length <= 20),
  })
  .strict();

tenantRoutes.put('/targets', tenantWrite, async (c) => {
  const tenant = c.get('tenant')!;
  const session = c.get('session')!;
  const body = targetsSchema.safeParse(await c.req.json().catch(() => null));
  if (!body.success) return c.json({ error: 'invalid request' }, 400);
  const d1 = tenantD1Client(c.env);
  const before = await d1.query(dbId(c), `SELECT * FROM targets WHERE period_month = ?`, [
    body.data.month,
  ]);
  for (const [metric, value] of Object.entries(body.data.targets)) {
    await d1.query(
      dbId(c),
      `INSERT INTO targets (period_month, metric, value) VALUES (?, ?, ?)
       ON CONFLICT (period_month, metric) DO UPDATE SET value = excluded.value`,
      [body.data.month, metric, value]
    );
  }
  await writeAudit(c.env, {
    actorType: session.userType,
    actorId: session.userId,
    tenantId: tenant.id,
    action: 'targets.update',
    target: body.data.month,
    before: before.results,
    after: body.data.targets,
  });
  return c.json({ ok: true });
});

// Manual rollup recompute for a month, admin and agency only.
tenantRoutes.post('/rollup/:month', tenantWrite, async (c) => {
  const month = monthParam.safeParse(c.req.param('month'));
  if (!month.success) return c.json({ error: 'invalid month' }, 400);
  const tenant = c.get('tenant')!;
  const session = c.get('session')!;
  const { runTenantRollup } = await import('../rollup');
  const outputs = await runTenantRollup(c.env, dbId(c), month.data);
  await writeAudit(c.env, {
    actorType: session.userType,
    actorId: session.userId,
    tenantId: tenant.id,
    action: 'rollup.run',
    target: month.data,
  });
  return c.json({ ok: true, channels: outputs.monthlyMetrics.length });
});

tenantRoutes.get('/targets/:month', async (c) => {
  const month = monthParam.safeParse(c.req.param('month'));
  if (!month.success) return c.json({ error: 'invalid month' }, 400);
  const config = await viewerConfig(c);
  if (!monthAllowed(config, month.data)) return c.json({ error: 'forbidden' }, 403);
  const d1 = tenantD1Client(c.env);
  const { results } = await d1.query(dbId(c), `SELECT metric, value FROM targets WHERE period_month = ?`, [
    month.data,
  ]);
  return c.json({ targets: results });
});
