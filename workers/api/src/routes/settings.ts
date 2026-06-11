import { Hono } from 'hono';
import { z } from 'zod';
import type { AppContext } from '../env';
import { tenantScope, tenantWrite } from '../middleware';
import { writeAudit } from '../audit';
import { clearResolverCache } from '../tenantResolver';
import { LIMITS, rateLimit } from '../ratelimit';

export const settingsRoutes = new Hono<AppContext>();
settingsRoutes.use('*', tenantScope);

const HEX = /^#[0-9a-fA-F]{6}$/;
const themeSchema = z
  .object({
    paper: z.string().regex(HEX),
    card: z.string().regex(HEX),
    ink: z.string().regex(HEX),
    inkSoft: z.string().regex(HEX),
    hairline: z.string().regex(HEX),
    accent: z.string().regex(HEX),
    accentSoft: z.string().regex(HEX),
    positive: z.string().regex(HEX),
    negative: z.string().regex(HEX),
    amber: z.string().regex(HEX),
    verifiedGreen: z.string().regex(HEX),
    grayCheck: z.string().regex(HEX),
    redCheck: z.string().regex(HEX),
    channelGoogle: z.string().regex(HEX),
    channelMeta: z.string().regex(HEX),
    channelWebsite: z.string().regex(HEX),
    fontDisplay: z.string().max(60),
    fontBody: z.string().max(60),
    fontMono: z.string().max(60),
    customCss: z.string().max(20000).optional(),
    wordmark: z.string().max(60).optional(),
  })
  .strict();

// Custom CSS is sanitized and scoped to the tenant app container client
// side; server side we strip the constructs that could escape scoping or
// exfiltrate data.
export function sanitizeCss(css: string): string {
  return css
    .replace(/<\s*\/?\s*style/gi, '')
    .replace(/@import[^;]+;?/gi, '')
    .replace(/javascript\s*:/gi, '')
    .replace(/expression\s*\(/gi, '')
    .replace(/url\s*\(\s*['"]?(?!data:image)/gi, 'url(blocked-');
}

settingsRoutes.put('/theme', tenantWrite, async (c) => {
  const tenant = c.get('tenant')!;
  const session = c.get('session')!;
  const body = themeSchema.safeParse(await c.req.json().catch(() => null));
  if (!body.success) return c.json({ error: 'invalid theme', details: body.error.flatten() }, 400);
  const theme = { ...body.data, customCss: body.data.customCss ? sanitizeCss(body.data.customCss) : undefined };
  await c.env.CONTROL_DB.prepare(`UPDATE tenants SET theme_json = ? WHERE id = ?`)
    .bind(JSON.stringify(theme), tenant.id)
    .run();
  clearResolverCache();
  await writeAudit(c.env, {
    actorType: session.userType,
    actorId: session.userId,
    tenantId: tenant.id,
    action: 'theme.update',
    before: tenant.theme_json ? JSON.parse(tenant.theme_json) : null,
    after: theme,
  });
  return c.json({ ok: true, theme });
});

const labelsSchema = z
  .object({
    lead: z.string().min(1).max(40),
    scheduled: z.string().min(1).max(40),
    completed: z.string().min(1).max(40),
    purchase: z.string().min(1).max(40),
  })
  .strict();

settingsRoutes.put('/funnel-labels', tenantWrite, async (c) => {
  const tenant = c.get('tenant')!;
  const session = c.get('session')!;
  const body = labelsSchema.safeParse(await c.req.json().catch(() => null));
  if (!body.success) return c.json({ error: 'invalid labels' }, 400);
  await c.env.CONTROL_DB.prepare(`UPDATE tenants SET funnel_labels_json = ? WHERE id = ?`)
    .bind(JSON.stringify(body.data), tenant.id)
    .run();
  clearResolverCache();
  await writeAudit(c.env, {
    actorType: session.userType,
    actorId: session.userId,
    tenantId: tenant.id,
    action: 'funnel_labels.update',
    before: tenant.funnel_labels_json ? JSON.parse(tenant.funnel_labels_json) : null,
    after: body.data,
  });
  return c.json({ ok: true });
});

// Logo upload to R2. The body is the raw image; content type restricted.
settingsRoutes.put('/logo', tenantWrite, async (c) => {
  const tenant = c.get('tenant')!;
  const session = c.get('session')!;
  const contentType = c.req.header('content-type') ?? '';
  if (!/^image\/(png|jpeg|svg\+xml|webp)$/.test(contentType)) {
    return c.json({ error: 'unsupported image type' }, 415);
  }
  const body = await c.req.arrayBuffer();
  if (body.byteLength > 1024 * 1024) return c.json({ error: 'logo too large (1MB max)' }, 413);
  const key = `logos/${tenant.id}`;
  await c.env.ASSETS.put(key, body, { httpMetadata: { contentType } });
  await writeAudit(c.env, {
    actorType: session.userType,
    actorId: session.userId,
    tenantId: tenant.id,
    action: 'logo.upload',
    after: { bytes: body.byteLength, contentType },
  });
  return c.json({ ok: true, url: '/api/tenant/logo' });
});

settingsRoutes.get('/logo', async (c) => {
  const tenant = c.get('tenant')!;
  const object = await c.env.ASSETS.get(`logos/${tenant.id}`);
  if (!object) return c.json({ error: 'no logo' }, 404);
  return c.body(object.body as ReadableStream, 200, {
    'content-type': object.httpMetadata?.contentType ?? 'image/png',
    'cache-control': 'public, max-age=300',
  });
});

// Footer credit toggle, agency roles only.
const footerSchema = z.object({ footerCredit: z.boolean() }).strict();

settingsRoutes.put('/footer-credit', async (c) => {
  const tenant = c.get('tenant')!;
  const session = c.get('session')!;
  if (session.userType !== 'agency') return c.json({ error: 'forbidden' }, 403);
  const body = footerSchema.safeParse(await c.req.json().catch(() => null));
  if (!body.success) return c.json({ error: 'invalid request' }, 400);
  await c.env.CONTROL_DB.prepare(`UPDATE tenants SET footer_credit = ? WHERE id = ?`)
    .bind(body.data.footerCredit ? 1 : 0, tenant.id)
    .run();
  clearResolverCache();
  await writeAudit(c.env, {
    actorType: 'agency',
    actorId: session.userId,
    tenantId: tenant.id,
    action: 'footer_credit.toggle',
    after: body.data,
  });
  return c.json({ ok: true });
});

// Custom domain self serve via Cloudflare for SaaS custom hostnames.
// Gated behind plan = whitelabel. Agency admins can run it on a tenant's
// behalf from the agency view through the same tenant scoped route.
const domainSchema = z
  .object({ hostname: z.string().min(4).max(253).regex(/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/i) })
  .strict();

settingsRoutes.post('/custom-domain', tenantWrite, async (c) => {
  const tenant = c.get('tenant')!;
  const session = c.get('session')!;
  if (tenant.plan !== 'whitelabel') {
    return c.json({ error: 'custom domains require the whitelabel plan' }, 403);
  }
  const body = domainSchema.safeParse(await c.req.json().catch(() => null));
  if (!body.success) return c.json({ error: 'invalid hostname' }, 400);
  const hostname = body.data.hostname.toLowerCase();

  if (!(await rateLimit(c.env, LIMITS.cfApi, 'global'))) {
    return c.json({ error: 'rate limited, try again shortly' }, 429);
  }

  const res = await fetch(
    `https://api.cloudflare.com/client/v4/zones/${c.env.CF_ZONE_ID}/custom_hostnames`,
    {
      method: 'POST',
      headers: { authorization: `Bearer ${c.env.CF_API_TOKEN}`, 'content-type': 'application/json' },
      body: JSON.stringify({ hostname, ssl: { method: 'http', type: 'dv' } }),
    }
  );
  const json = (await res.json()) as {
    success: boolean;
    result?: {
      id: string;
      status: string;
      ownership_verification?: { name?: string; value?: string };
    };
    errors?: Array<{ message: string }>;
  };
  if (!json.success || !json.result) {
    return c.json({ error: json.errors?.[0]?.message ?? 'Cloudflare rejected the hostname' }, 502);
  }

  await c.env.CONTROL_DB.prepare(
    `INSERT INTO custom_hostnames (id, tenant_id, hostname, cf_hostname_id, status, cname_target, txt_name, txt_value)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (hostname) DO UPDATE SET cf_hostname_id = excluded.cf_hostname_id, status = excluded.status`
  )
    .bind(
      `ch_${json.result.id.slice(0, 12)}`,
      tenant.id,
      hostname,
      json.result.id,
      json.result.status ?? 'pending_validation',
      c.env.AGENCY_HOST,
      json.result.ownership_verification?.name ?? null,
      json.result.ownership_verification?.value ?? null
    )
    .run();
  await c.env.CONTROL_DB.prepare(`UPDATE tenants SET custom_hostname = ?, hostname_status = ? WHERE id = ?`)
    .bind(hostname, json.result.status ?? 'pending_validation', tenant.id)
    .run();
  clearResolverCache();
  await writeAudit(c.env, {
    actorType: session.userType,
    actorId: session.userId,
    tenantId: tenant.id,
    action: 'custom_domain.create',
    target: hostname,
  });
  return c.json({
    ok: true,
    hostname,
    status: json.result.status ?? 'pending_validation',
    cnameTarget: c.env.AGENCY_HOST,
    txt: json.result.ownership_verification ?? null,
  });
});

// Status polling. When Cloudflare reports active, routing activates
// automatically because the resolver reads tenants.custom_hostname.
settingsRoutes.get('/custom-domain', async (c) => {
  const tenant = c.get('tenant')!;
  const record = await c.env.CONTROL_DB.prepare(
    `SELECT * FROM custom_hostnames WHERE tenant_id = ? ORDER BY created_at DESC LIMIT 1`
  )
    .bind(tenant.id)
    .first<{ hostname: string; cf_hostname_id: string; status: string; cname_target: string; txt_name: string | null; txt_value: string | null }>();
  if (!record) return c.json({ hostname: null });

  if (record.status !== 'active' && (await rateLimit(c.env, LIMITS.cfApi, 'global'))) {
    const res = await fetch(
      `https://api.cloudflare.com/client/v4/zones/${c.env.CF_ZONE_ID}/custom_hostnames/${record.cf_hostname_id}`,
      { headers: { authorization: `Bearer ${c.env.CF_API_TOKEN}` } }
    );
    const json = (await res.json()) as { success: boolean; result?: { status: string; ssl?: { status?: string } } };
    if (json.success && json.result) {
      const status =
        json.result.status === 'active' && json.result.ssl?.status && json.result.ssl.status !== 'active'
          ? 'pending_ssl'
          : json.result.status;
      if (status !== record.status) {
        await c.env.CONTROL_DB.prepare(`UPDATE custom_hostnames SET status = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE cf_hostname_id = ?`)
          .bind(status, record.cf_hostname_id)
          .run();
        await c.env.CONTROL_DB.prepare(`UPDATE tenants SET hostname_status = ? WHERE id = ?`)
          .bind(status, tenant.id)
          .run();
        clearResolverCache();
        record.status = status;
      }
    }
  }
  return c.json({
    hostname: record.hostname,
    status: record.status,
    cnameTarget: record.cname_target,
    txt: record.txt_name ? { name: record.txt_name, value: record.txt_value } : null,
  });
});
