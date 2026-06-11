import { Hono } from 'hono';
import { z } from 'zod';
import type { AgencyUserRow, TenantRow } from '@letlois/db';
import type { AppContext } from '../env';
import { agencyOnly, requireRole, agencyCanAccess } from '../middleware';
import { provisionTenant } from '../provisioning';
import { hashPassword, randomToken } from '../crypto';
import { writeAudit } from '../audit';

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
    `SELECT id, slug, name, status, plan, timezone, custom_hostname, hostname_status, schema_version, footer_credit, created_at
     FROM tenants ORDER BY name`
  ).all<Partial<TenantRow>>();
  const visible =
    session.role === 'agency_admin'
      ? results
      : results.filter((t) => agencyCanAccess(session.role, session.assignedTenants, t.id as string));
  return c.json({ tenants: visible });
});

// Agency overview grid from agency_rollup snapshots.
agencyRoutes.get('/overview', async (c) => {
  const session = c.get('session')!;
  const month = new Date().toISOString().slice(0, 7);
  const { results } = await c.env.CONTROL_DB.prepare(
    `SELECT t.id, t.slug, t.name, t.plan, r.leads, r.scheduled, r.completed, r.purchases, r.revenue, r.spend, r.pulled_at
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

const agencyUserSchema = z
  .object({
    email: z.string().email().max(254),
    name: z.string().min(1).max(120),
    role: z.enum(['agency_admin', 'agency_staff']),
    assignedTenants: z.array(z.string()).max(200).optional(),
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
    `SELECT id, email, name, role, assigned_tenants_json, active, created_at FROM agency_users ORDER BY name`
  ).all<Omit<AgencyUserRow, 'password_hash'>>();
  return c.json({ users: results });
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
