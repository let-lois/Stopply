import { Hono } from 'hono';
import type { AppContext, Env } from './env';
import { contextMiddleware, csrfMiddleware } from './middleware';
import { fieldCors } from './cors';
import { authRoutes } from './routes/auth';
import { agencyRoutes } from './routes/agency';
import { tenantRoutes } from './routes/tenant';
import { ingestRoutes } from './routes/ingest';
import { importRoutes } from './routes/imports';
import { integrationRoutes } from './routes/integrations';
import { settingsRoutes } from './routes/settings';
import { chatRoutes, helpRoutes } from './routes/chat';
import { fieldRoutes } from './routes/field';
import { fieldAdminRoutes } from './routes/fieldAdmin';
import { buildTrackingScript } from './tjs';
import { getTenantBySlug } from './tenantResolver';
import { tenantD1Client } from './provisioning';

const app = new Hono<AppContext>();

// Security headers on every response.
app.use('*', async (c, next) => {
  await next();
  c.header(
    'content-security-policy',
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'"
  );
  c.header('strict-transport-security', 'max-age=63072000; includeSubDomains');
  c.header('x-content-type-options', 'nosniff');
  c.header('referrer-policy', 'strict-origin-when-cross-origin');
});

// Before host resolution, so a preflight from the standalone field app is
// answered without depending on a session the browser has not sent yet.
app.use('*', fieldCors);
app.use('*', contextMiddleware);
app.use('*', csrfMiddleware);

app.route('/api/auth', authRoutes);
app.route('/api/agency', agencyRoutes);
app.route('/api/tenant', tenantRoutes);
app.route('/api/imports', importRoutes);
app.route('/api/tenant/integrations', integrationRoutes);
app.route('/api/tenant/settings', settingsRoutes);
// Door to door field tracking: /api/field is the reps' phones, and
// /api/tenant/field is the reporting and roster the client sees.
app.route('/api/tenant/field', fieldAdminRoutes);
app.route('/api/field', fieldRoutes);
app.route('/api/help', helpRoutes);
app.route('/api/chat', chatRoutes);
app.route('/ingest', ingestRoutes);

// Per tenant first party tracking script. On a tenant hostname /t.js
// serves that tenant's script; /t/{slug}.js works on the agency host for
// pre domain setups.
async function serveTrackingScript(
  c: import('hono').Context<AppContext>,
  slug: string,
  origin: string
): Promise<Response> {
  const tenant = await getTenantBySlug(c.env, slug);
  if (!tenant?.d1_database_id) return c.json({ error: 'not found' }, 404);
  let formSelector = 'form[data-lbi]';
  try {
    const d1 = tenantD1Client(c.env);
    const { results } = await d1.query<{ value_json: string }>(
      tenant.d1_database_id,
      `SELECT value_json FROM settings WHERE key = 'tracking_form_selector'`
    );
    if (results[0]) formSelector = JSON.parse(results[0].value_json);
  } catch {
    // default selector stands when settings are unreachable
  }
  const script = buildTrackingScript({ slug, origin, formSelector });
  return c.body(script, 200, {
    'content-type': 'application/javascript; charset=utf-8',
    'cache-control': 'public, max-age=300',
  });
}

app.get('/t.js', async (c) => {
  const tenant = c.get('tenant');
  if (c.get('hostContext') !== 'tenant' || !tenant) return c.json({ error: 'not found' }, 404);
  return serveTrackingScript(c, tenant.slug, new URL(c.req.url).origin);
});

app.get('/t/:file', async (c) => {
  if (c.get('hostContext') !== 'agency') return c.json({ error: 'not found' }, 404);
  const file = c.req.param('file') ?? '';
  if (!file.endsWith('.js')) return c.json({ error: 'not found' }, 404);
  return serveTrackingScript(c, file.slice(0, -3), new URL(c.req.url).origin);
});

app.get('/api/health', (c) => c.json({ ok: true }));

app.notFound((c) => c.json({ error: 'not found' }, 404));
app.onError((err, c) => {
  console.error('unhandled error', err.message);
  return c.json({ error: 'internal error' }, 500);
});

export default app satisfies { fetch: (req: Request, env: Env, ctx: ExecutionContext) => Response | Promise<Response> };
export { app };
