import { Hono } from 'hono';
import type { Context } from 'hono';
import { z } from 'zod';
import type { SourceRow, TenantUserRow } from '@letlois/db';
import { isDefaultTheme, parseSections, sourceFreshness } from '@letlois/db';
import type { AppContext } from '../env';
import { tenantScope, tenantWrite } from '../middleware';
import { tenantD1Client, rotateSourceSecret } from '../provisioning';
import { randomToken } from '../crypto';
import { writeAudit } from '../audit';
import { monthAllowed, parseViewConfig, sanitizeViewConfig } from '../viewConfig';
import { monthPayload } from '../monthPayload';
import { createTenantUser, resetTenantUserPassword } from '../tenantUsers';

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
  // Provisioning used to stamp the light default theme onto every tenant,
  // so most tenants carry a theme they never chose. Report those as having
  // no theme: the shell then uses the app palette and dark mode renders
  // correctly. A tenant that actually branded itself still gets its theme.
  const storedTheme = tenant.theme_json ? JSON.parse(tenant.theme_json) : null;
  return c.json({
    tenant: {
      id: tenant.id,
      slug: tenant.slug,
      name: tenant.name,
      timezone: tenant.timezone,
      plan: tenant.plan,
      theme: isDefaultTheme(storedTheme) ? null : storedTheme,
      layout: tenant.layout_json ? JSON.parse(tenant.layout_json) : null,
      funnelLabels: tenant.funnel_labels_json ? JSON.parse(tenant.funnel_labels_json) : null,
      sections: parseSections(tenant.sections_json),
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

  return c.json(await monthPayload(c.env, dbId(c), month.data, basis, config));
});

// Manual creative type correction for a single ad line item. Staff use
// this when the export did not report a creative type, or reported it
// wrong; the row is flagged 'manual' so future re-imports of the same
// source do not silently look auto-tagged.
const creativeTypeSchema = z
  .object({
    periodMonth: z.string().regex(/^\d{4}-\d{2}$/),
    channel: z.string().min(1).max(40),
    campaign: z.string().min(1).max(200),
    adName: z.string().min(1).max(200),
    creativeType: z.string().min(1).max(40),
  })
  .strict();

tenantRoutes.patch('/ad-line-items/creative-type', tenantWrite, async (c) => {
  const session = c.get('session')!;
  const tenant = c.get('tenant')!;
  const body = creativeTypeSchema.safeParse(await c.req.json().catch(() => null));
  if (!body.success) return c.json({ error: 'invalid request', details: body.error.flatten() }, 400);
  const d1 = tenantD1Client(c.env);
  await d1.query(
    dbId(c),
    `UPDATE ad_line_items SET creative_type = ?, creative_type_source = 'manual'
     WHERE period_month = ? AND channel = ? AND campaign = ? AND ad_name = ?`,
    [body.data.creativeType, body.data.periodMonth, body.data.channel, body.data.campaign, body.data.adName]
  );
  await writeAudit(c.env, {
    actorType: session.userType,
    actorId: session.userId,
    tenantId: tenant.id,
    action: 'ad_line_item.creative_type.update',
    target: `${body.data.channel}/${body.data.campaign}/${body.data.adName}`,
    after: { creativeType: body.data.creativeType },
  });
  return c.json({ ok: true });
});

// Manual campaign type tag, e.g. "Lead Generation" or "Search". Stored in
// campaign_meta, which survives rollups and re-imports (campaign_metrics
// itself is recomputed wholesale every rollup).
const campaignTypeSchema = z
  .object({
    channel: z.string().min(1).max(40),
    campaign: z.string().min(1).max(200),
    campaignType: z.string().min(1).max(60).nullable(),
  })
  .strict();

tenantRoutes.patch('/campaigns/type', tenantWrite, async (c) => {
  const session = c.get('session')!;
  const tenant = c.get('tenant')!;
  const body = campaignTypeSchema.safeParse(await c.req.json().catch(() => null));
  if (!body.success) return c.json({ error: 'invalid request', details: body.error.flatten() }, 400);
  const d1 = tenantD1Client(c.env);
  await d1.query(
    dbId(c),
    `INSERT INTO campaign_meta (channel, campaign, campaign_type) VALUES (?, ?, ?)
     ON CONFLICT (channel, campaign) DO UPDATE SET
       campaign_type = excluded.campaign_type,
       updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')`,
    [body.data.channel, body.data.campaign, body.data.campaignType]
  );
  await writeAudit(c.env, {
    actorType: session.userType,
    actorId: session.userId,
    tenantId: tenant.id,
    action: 'campaign.type.update',
    target: `${body.data.channel}/${body.data.campaign}`,
    after: { campaignType: body.data.campaignType },
  });
  return c.json({ ok: true });
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

// Create a source. Custom CSV sources need nothing but a name of where the
// data comes from; the connector type may be a known parser or 'auto' to
// let the AI detector pick a parser at import time.
const KNOWN_PARSERS = [
  'auto',
  'meta-campaign',
  'google-campaign',
  'meta-ad-lineitem',
  'google-ad-lineitem',
  'ghl-contacts',
  'ghl-website',
  'blvd-appointments',
  'blvd-line-items',
  'blvd-clients',
  'd2d-accounts',
] as const;

const createSourceSchema = z
  .object({
    name: z.string().min(1).max(80),
    connectorType: z.enum(KNOWN_PARSERS).default('auto'),
    howTo: z.string().max(2000).optional(),
    platformLink: z.string().url().max(500).optional(),
  })
  .strict();

function slugifyKey(name: string): string {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
  return `${base || 'source'}-${randomToken(2)}`;
}

tenantRoutes.post('/sources', tenantWrite, async (c) => {
  const session = c.get('session')!;
  const tenant = c.get('tenant')!;
  const body = createSourceSchema.safeParse(await c.req.json().catch(() => null));
  if (!body.success) return c.json({ error: 'invalid request', details: body.error.flatten() }, 400);
  const d1 = tenantD1Client(c.env);
  const key = slugifyKey(body.data.name);
  // 'auto' is stored as NULL connector_type; the importer resolves a parser
  // via the AI detector when a source has no fixed parser.
  const connectorType = body.data.connectorType === 'auto' ? null : body.data.connectorType;
  await d1.query(
    dbId(c),
    `INSERT INTO sources (key, name, kind, connector_type, cadence, platform_link, how_to)
     VALUES (?, ?, 'csv', ?, 7, ?, ?)`,
    [key, body.data.name, connectorType, body.data.platformLink ?? null, body.data.howTo ?? null]
  );
  await writeAudit(c.env, {
    actorType: session.userType,
    actorId: session.userId,
    tenantId: tenant.id,
    action: 'source.create',
    target: key,
    after: { name: body.data.name, connectorType: body.data.connectorType },
  });
  return c.json({ ok: true, key }, 201);
});

const updateSourceSchema = z
  .object({
    name: z.string().min(1).max(80).optional(),
    connectorType: z.enum(KNOWN_PARSERS).optional(),
    howTo: z.string().max(2000).optional(),
    platformLink: z.string().url().max(500).optional().or(z.literal('')),
  })
  .strict();

tenantRoutes.patch('/sources/:key', tenantWrite, async (c) => {
  const session = c.get('session')!;
  const tenant = c.get('tenant')!;
  const key = c.req.param('key');
  const body = updateSourceSchema.safeParse(await c.req.json().catch(() => null));
  if (!body.success) return c.json({ error: 'invalid request' }, 400);
  const sets: string[] = [];
  const params: unknown[] = [];
  if (body.data.name !== undefined) (sets.push('name = ?'), params.push(body.data.name));
  if (body.data.connectorType !== undefined)
    (sets.push('connector_type = ?'), params.push(body.data.connectorType === 'auto' ? null : body.data.connectorType));
  if (body.data.howTo !== undefined) (sets.push('how_to = ?'), params.push(body.data.howTo));
  if (body.data.platformLink !== undefined)
    (sets.push('platform_link = ?'), params.push(body.data.platformLink || null));
  if (sets.length === 0) return c.json({ error: 'nothing to update' }, 400);
  const d1 = tenantD1Client(c.env);
  await d1.query(dbId(c), `UPDATE sources SET ${sets.join(', ')} WHERE key = ?`, [...params, key]);
  await writeAudit(c.env, {
    actorType: session.userType,
    actorId: session.userId,
    tenantId: tenant.id,
    action: 'source.update',
    target: key,
  });
  return c.json({ ok: true });
});

// Remove a source. The immutable event and stage rows it produced are left
// intact; only the source definition and its future imports are removed.
tenantRoutes.delete('/sources/:key', tenantWrite, async (c) => {
  const session = c.get('session')!;
  const tenant = c.get('tenant')!;
  const key = c.req.param('key');
  const d1 = tenantD1Client(c.env);
  await d1.query(dbId(c), `DELETE FROM sources WHERE key = ?`, [key]);
  await writeAudit(c.env, {
    actorType: session.userType,
    actorId: session.userId,
    tenantId: tenant.id,
    action: 'source.delete',
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
  const created = await createTenantUser(c.env, { id: tenant.id, d1_database_id: dbId(c) }, body.data);
  if (!created.ok) return c.json({ error: 'email already exists' }, 409);
  const { id, email, tempPassword } = created;
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

// Admin driven password reset for a tenant user. No email provider is
// bound to this Worker (see Env), so there is no self service reset link;
// an account_admin (or an agency user switched into this client) resets on
// their behalf and passes the new temp password on out of band. Returned
// once, only the hash is stored, matching the invite route above.
//
// Does NOT end sessions the user already holds: sessions are keyed by token
// alone in KV with no per user index (session.ts), so an existing sign in
// lasts until its TTL. Use deactivation to actually cut off access.
tenantRoutes.post('/users/:id/reset-password', tenantWrite, async (c) => {
  const tenant = c.get('tenant')!;
  const session = c.get('session')!;
  const id = c.req.param('id') ?? '';
  const reset = await resetTenantUserPassword(c.env, dbId(c), id);
  if (!reset.ok) return c.json({ error: 'not found' }, 404);
  const user = { email: reset.email };
  const tempPassword = reset.tempPassword;
  await writeAudit(c.env, {
    actorType: session.userType,
    actorId: session.userId,
    tenantId: tenant.id,
    action: 'tenant_user.password_reset',
    target: user.email,
  });
  return c.json({ id, email: user.email, tempPassword });
});

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
