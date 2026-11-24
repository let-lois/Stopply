// A client's own ad platform reports, for its dashboard. Tenant scoped: the
// tenant comes from the hostname and the session, never from the request,
// so these routes can only ever read the signed in client's database.

import { Hono } from 'hono';
import type { AppContext } from '../env';
import { tenantScope } from '../middleware';
import { adPlatformReport, parseReportRange } from '../adPlatformReport';

export const adPlatformRoutes = new Hono<AppContext>();
adPlatformRoutes.use('*', tenantScope);

adPlatformRoutes.get('/:platform', async (c) => {
  const tenant = c.get('tenant');
  if (!tenant?.d1_database_id) return c.json({ error: 'not found' }, 404);
  const range = parseReportRange(c.req.query('from'), c.req.query('to'), tenant.timezone || 'UTC');
  if (!range.ok) return c.json({ error: range.error }, 400);
  const result = await adPlatformReport(c.env, tenant.d1_database_id, c.req.param('platform'), range.value);
  if (!result.ok) return c.json({ error: result.error }, result.status);
  return c.json(result.report);
});
