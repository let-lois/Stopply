import { Hono } from 'hono';
import type { AppContext, Env } from './env';
import { contextMiddleware, csrfMiddleware } from './middleware';
import { authRoutes } from './routes/auth';
import { agencyRoutes } from './routes/agency';
import { tenantRoutes } from './routes/tenant';

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

app.use('*', contextMiddleware);
app.use('*', csrfMiddleware);

app.route('/api/auth', authRoutes);
app.route('/api/agency', agencyRoutes);
app.route('/api/tenant', tenantRoutes);

app.get('/api/health', (c) => c.json({ ok: true }));

app.notFound((c) => c.json({ error: 'not found' }, 404));
app.onError((err, c) => {
  console.error('unhandled error', err.message);
  return c.json({ error: 'internal error' }, 500);
});

export default app satisfies { fetch: (req: Request, env: Env, ctx: ExecutionContext) => Response | Promise<Response> };
export { app };
