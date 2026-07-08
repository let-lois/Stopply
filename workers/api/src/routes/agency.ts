import { Hono } from 'hono';
import { z } from 'zod';
import type { AgencyUserRow, TenantRow } from '@letlois/db';
import type { AppContext } from '../env';
import { agencyOnly, requireRole, agencyCanAccess } from '../middleware';
import { provisionTenant } from '../provisioning';
import { hashPassword, randomToken } from '../crypto';
import { writeAudit } from '../audit';
import { listAgencySettings, setAgencySetting, isManagedKey, canManageSecrets } from '../agencySettings';

export const agencyRoutes = new Hono<AppContext>();
agencyRoutes.use('*', agencyOnly);

const provisionSchema = z
  .object({
    slug: z.string().min(2).max(40).regex(/^[a-z0-9-]+$/),
    name: z.string().min(1).max(120),
    timezone: z.string().max(64).optional(),
    plan: z.enum(['starter', 'pro', 'whitelabel']).optional(),
    adminEmail: z.string().email().max(254),
    adminName: z.string().min(1).max(120),
    funnelLabels: z
      .object({
        lead: z.string().min(1).max(40),
        scheduled: z.string().min(1).max(40),
        completed: z.string().min(1).max(40),
        purchase: z.string().min(1).max(40),
      })
      .strict()
      .optional(),
    monthlyAdSpendBudget: z.number().min(0).max(10_000_000).optional(),
    adPlatforms: z.array(z.enum(['meta', 'google'])).max(2).optional(),
    platformBudgets: z
      .object({
        meta: z.number().min(0).max(10_000_000).optional(),
        google: z.number().min(0).max(10_000_000).optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

agencyRoutes.post('/tenants', requireRole('agency_admin'), async (c) => {
  const session = c.get('session')!;
  const body = provisionSchema.safeParse(await c.req.json().catch(() => null));
  if (!body.success) return c.json({ error: 'invalid request', details: body.error.flatten() }, 400);
  try {
    const result = await provisionTenant(c.env, {
      ...body.data,
      actor: { id: session.userId, name: session.userId },
    });
    return c.json(result, result.resumed ? 200 : 201);
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : 'provisioning failed' }, 500);
  }
});

agencyRoutes.get('/tenants', async (c) => {
  const session = c.get('session')!;
  const { results } = await c.env.CONTROL_DB.prepare(
    `SELECT id, slug, name, status, plan, timezone, custom_hostname, hostname_status, schema_version, footer_credit,
       monthly_ad_spend_budget, ad_platforms_json, ad_platform_budget_json, created_at
     FROM tenants ORDER BY name`
  ).all<Partial<TenantRow>>();
  const visible =
    session.role === 'agency_admin'
      ? results
      : results.filter((t) => agencyCanAccess(session.role, session.assignedTenants, t.id as string));
  return c.json({ tenants: visible });
});

// Edit a client's committed monthly ad spend and platform mix after
// provisioning, without re-running the full provisioning flow.
const budgetSchema = z
  .object({
    monthlyAdSpendBudget: z.number().min(0).max(10_000_000).nullable(),
    adPlatforms: z.array(z.enum(['meta', 'google'])).max(2),
    platformBudgets: z
      .object({
        meta: z.number().min(0).max(10_000_000).optional(),
        google: z.number().min(0).max(10_000_000).optional(),
      })
      .strict()
      .nullable()
      .optional(),
  })
  .strict();

agencyRoutes.put('/tenants/:id/budget', requireRole('agency_admin'), async (c) => {
  const session = c.get('session')!;
  const id = c.req.param('id');
  const body = budgetSchema.safeParse(await c.req.json().catch(() => null));
  if (!body.success) return c.json({ error: 'invalid request', details: body.error.flatten() }, 400);
  const existing = await c.env.CONTROL_DB.prepare(`SELECT id FROM tenants WHERE id = ?`).bind(id).first();
  if (!existing) return c.json({ error: 'not found' }, 404);
  await c.env.CONTROL_DB.prepare(
    `UPDATE tenants SET monthly_ad_spend_budget = ?, ad_platforms_json = ?, ad_platform_budget_json = ? WHERE id = ?`
  )
    .bind(
      body.data.monthlyAdSpendBudget,
      JSON.stringify(body.data.adPlatforms),
      body.data.platformBudgets ? JSON.stringify(body.data.platformBudgets) : null,
      id
    )
    .run();
  await writeAudit(c.env, {
    actorType: 'agency',
    actorId: session.userId,
    tenantId: id,
    action: 'tenant.budget.update',
    target: id,
    after: body.data,
  });
  return c.json({ ok: true });
});

// Agency overview grid from agency_rollup snapshots.
agencyRoutes.get('/overview', async (c) => {
  const session = c.get('session')!;
  const month = new Date().toISOString().slice(0, 7);
  const { results } = await c.env.CONTROL_DB.prepare(
    `SELECT t.id, t.slug, t.name, t.plan, t.monthly_ad_spend_budget, t.ad_platforms_json, t.ad_platform_budget_json,
       r.leads, r.scheduled, r.completed, r.purchases, r.revenue, r.spend, r.pulled_at
     FROM tenants t LEFT JOIN agency_rollup r ON r.tenant_id = t.id AND r.period_month = ?
     WHERE t.status = 'active' ORDER BY t.name`
  )
    .bind(month)
    .all<Record<string, unknown>>();
  const visible =
    session.role === 'agency_admin'
      ? results
      : results.filter((t) => agencyCanAccess(session.role, session.assignedTenants, t.id as string));
  return c.json({ month, tenants: visible });
});

const permissionsSchema = z.object({ manageSecrets: z.boolean() }).strict();

const agencyUserSchema = z
  .object({
    email: z.string().email().max(254),
    name: z.string().min(1).max(120),
    role: z.enum(['agency_admin', 'agency_staff']),
    assignedTenants: z.array(z.string()).max(200).optional(),
    permissions: permissionsSchema.optional(),
  })
  .strict();

agencyRoutes.post('/users', requireRole('agency_admin'), async (c) => {
  const session = c.get('session')!;
  const body = agencyUserSchema.safeParse(await c.req.json().catch(() => null));
  if (!body.success) return c.json({ error: 'invalid request' }, 400);
  const email = body.data.email.toLowerCase().trim();
  const existing = await c.env.CONTROL_DB.prepare(`SELECT id FROM agency_users WHERE email = ?`)
    .bind(email)
    .first();
  if (existing) return c.json({ error: 'email already exists' }, 409);
  const tempPassword = randomToken(9);
  const id = `au_${randomToken(8)}`;
  await c.env.CONTROL_DB.prepare(
    `INSERT INTO agency_users (id, email, name, role, password_hash, assigned_tenants_json, active)
     VALUES (?, ?, ?, ?, ?, ?, 1)`
  )
    .bind(
      id,
      email,
      body.data.name,
      body.data.role,
      await hashPassword(tempPassword),
      body.data.assignedTenants ? JSON.stringify(body.data.assignedTenants) : null
    )
    .run();
  if (body.data.permissions) {
    await c.env.CONTROL_DB.prepare(
      `INSERT INTO agency_user_permissions (user_id, permissions_json) VALUES (?, ?)
       ON CONFLICT (user_id) DO UPDATE SET permissions_json = excluded.permissions_json`
    )
      .bind(id, JSON.stringify(body.data.permissions))
      .run();
  }
  await writeAudit(c.env, {
    actorType: 'agency',
    actorId: session.userId,
    action: 'agency_user.create',
    target: email,
    after: { id, role: body.data.role },
  });
  return c.json({ id, email, tempPassword }, 201);
});

agencyRoutes.get('/users', requireRole('agency_admin'), async (c) => {
  const { results } = await c.env.CONTROL_DB.prepare(
    `SELECT u.id, u.email, u.name, u.role, u.assigned_tenants_json, p.permissions_json, u.active, u.created_at
     FROM agency_users u LEFT JOIN agency_user_permissions p ON p.user_id = u.id ORDER BY u.name`
  ).all<Omit<AgencyUserRow, 'password_hash'> & { permissions_json: string | null }>();
  return c.json({ users: results });
});

// Update an existing member's role, assignments, and permission flags.
const agencyUserPatchSchema = z
  .object({
    role: z.enum(['agency_admin', 'agency_staff']).optional(),
    assignedTenants: z.array(z.string()).max(200).optional(),
    permissions: permissionsSchema.optional(),
  })
  .strict();

agencyRoutes.patch('/users/:id', requireRole('agency_admin'), async (c) => {
  const session = c.get('session')!;
  const id = c.req.param('id');
  const body = agencyUserPatchSchema.safeParse(await c.req.json().catch(() => null));
  if (!body.success) return c.json({ error: 'invalid request' }, 400);
  const sets: string[] = [];
  const params: unknown[] = [];
  if (body.data.role !== undefined) {
    if (id === session.userId && body.data.role !== 'agency_admin') {
      return c.json({ error: 'cannot demote yourself' }, 400);
    }
    sets.push('role = ?');
    params.push(body.data.role);
  }
  if (body.data.assignedTenants !== undefined) {
    sets.push('assigned_tenants_json = ?');
    params.push(JSON.stringify(body.data.assignedTenants));
  }
  if (sets.length > 0) {
    await c.env.CONTROL_DB.prepare(`UPDATE agency_users SET ${sets.join(', ')} WHERE id = ?`)
      .bind(...params, id)
      .run();
  }
  if (body.data.permissions !== undefined) {
    await c.env.CONTROL_DB.prepare(
      `INSERT INTO agency_user_permissions (user_id, permissions_json) VALUES (?, ?)
       ON CONFLICT (user_id) DO UPDATE SET permissions_json = excluded.permissions_json`
    )
      .bind(id, JSON.stringify(body.data.permissions))
      .run();
  }
  if (sets.length === 0 && body.data.permissions === undefined) {
    return c.json({ error: 'nothing to update' }, 400);
  }
  await writeAudit(c.env, {
    actorType: 'agency',
    actorId: session.userId,
    action: 'agency_user.update',
    target: id,
    after: body.data as Record<string, unknown>,
  });
  return c.json({ ok: true });
});

// Agency managed keys and secrets. Admins always; staff with the
// manageSecrets permission. Plaintext is never returned, only status.
agencyRoutes.get('/secrets', async (c) => {
  const session = c.get('session')!;
  const perms = await c.env.CONTROL_DB.prepare(
    `SELECT permissions_json FROM agency_user_permissions WHERE user_id = ?`
  )
    .bind(session.userId)
    .first<{ permissions_json: string | null }>();
  if (!canManageSecrets(session.role, perms?.permissions_json ?? null)) {
    return c.json({ error: 'forbidden' }, 403);
  }
  const settings = await listAgencySettings(c.env);
  return c.json({ settings });
});

const secretSchema = z.object({ value: z.string().min(1).max(8192) }).strict();

agencyRoutes.put('/secrets/:key', async (c) => {
  const session = c.get('session')!;
  const key = c.req.param('key');
  const perms = await c.env.CONTROL_DB.prepare(
    `SELECT permissions_json FROM agency_user_permissions WHERE user_id = ?`
  )
    .bind(session.userId)
    .first<{ permissions_json: string | null }>();
  if (!canManageSecrets(session.role, perms?.permissions_json ?? null)) {
    return c.json({ error: 'forbidden' }, 403);
  }
  if (!isManagedKey(key)) return c.json({ error: 'unknown setting' }, 404);
  const body = secretSchema.safeParse(await c.req.json().catch(() => null));
  if (!body.success) return c.json({ error: 'invalid request' }, 400);
  await setAgencySetting(c.env, key, body.data.value, session.userId);
  await writeAudit(c.env, {
    actorType: 'agency',
    actorId: session.userId,
    action: 'agency_setting.update',
    target: key,
  });
  return c.json({ ok: true });
});

// User deletion is agency_admin only; agency_staff explicitly cannot.
agencyRoutes.delete('/users/:id', requireRole('agency_admin'), async (c) => {
  const session = c.get('session')!;
  const id = c.req.param('id');
  if (id === session.userId) return c.json({ error: 'cannot delete yourself' }, 400);
  await c.env.CONTROL_DB.prepare(`UPDATE agency_users SET active = 0 WHERE id = ?`).bind(id).run();
  await writeAudit(c.env, {
    actorType: 'agency',
    actorId: session.userId,
    action: 'agency_user.deactivate',
    target: id,
  });
  return c.json({ ok: true });
});

// Audit viewer with filters by tenant, actor, action, and date range.
const auditQuerySchema = z.object({
  tenantId: z.string().max(64).optional(),
  actor: z.string().max(64).optional(),
  action: z.string().max(120).optional(),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}/).optional(),
  limit: z.coerce.number().int().min(1).max(500).default(100),
});

agencyRoutes.get('/audit', requireRole('agency_admin'), async (c) => {
  const parsed = auditQuerySchema.safeParse(Object.fromEntries(new URL(c.req.url).searchParams));
  if (!parsed.success) return c.json({ error: 'invalid query' }, 400);
  const q = parsed.data;
  const where: string[] = [];
  const params: unknown[] = [];
  if (q.tenantId) (where.push('tenant_id = ?'), params.push(q.tenantId));
  if (q.actor) (where.push('actor_id = ?'), params.push(q.actor));
  if (q.action) (where.push('action LIKE ?'), params.push(q.action + '%'));
  if (q.from) (where.push('created_at >= ?'), params.push(q.from));
  if (q.to) (where.push('created_at <= ?'), params.push(q.to + 'T23:59:59Z'));
  const sql = `SELECT * FROM audit_log ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY created_at DESC LIMIT ?`;
  const { results } = await c.env.CONTROL_DB.prepare(sql)
    .bind(...params, q.limit)
    .all();
  return c.json({ entries: results });
});

// Help article management, agency_admin only.
const articleSchema = z
  .object({
    slug: z.string().min(1).max(80).regex(/^[a-z0-9-]+$/),
    title: z.string().min(1).max(200),
    bodyMd: z.string().min(1).max(50000),
    tags: z.string().max(400).optional(),
    published: z.boolean().default(false),
  })
  .strict();

agencyRoutes.put('/help/:slug', requireRole('agency_admin'), async (c) => {
  const session = c.get('session')!;
  const body = articleSchema.safeParse(await c.req.json().catch(() => null));
  if (!body.success) return c.json({ error: 'invalid request' }, 400);
  if (body.data.slug !== c.req.param('slug')) return c.json({ error: 'slug mismatch' }, 400);
  await c.env.CONTROL_DB.prepare(
    `INSERT INTO help_articles (id, slug, title, body_md, tags, published, updated_by, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
     ON CONFLICT (slug) DO UPDATE SET title = excluded.title, body_md = excluded.body_md,
       tags = excluded.tags, published = excluded.published, updated_by = excluded.updated_by,
       updated_at = excluded.updated_at`
  )
    .bind(
      `ha_${randomToken(8)}`,
      body.data.slug,
      body.data.title,
      body.data.bodyMd,
      body.data.tags ?? null,
      body.data.published ? 1 : 0,
      session.userId
    )
    .run();
  await writeAudit(c.env, {
    actorType: 'agency',
    actorId: session.userId,
    action: 'help_article.upsert',
    target: body.data.slug,
  });
  return c.json({ ok: true });
});
