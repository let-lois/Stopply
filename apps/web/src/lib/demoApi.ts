// Routes a request path/method to a canned demo response instead of ever
// hitting the network. Only called when isDemoMode() (demoMode.ts) is
// true. GET reads that drive the main dashboard views are modeled with
// realistic fake data; everything else (every mutation, and any GET not
// explicitly listed) gets a harmless generic stub so nothing throws, but
// nothing simulates a real write either, this is a read-only preview.

import {
  DEMO_ME,
  getDemoAgencyOverview,
  getDemoAgencyUsers,
  getDemoMonthData,
  getDemoMonthsResponse,
  getDemoProfile,
  getDemoSettings,
  getDemoSources,
  getDemoTeamUsers,
  setActiveDemoClient,
} from './demoData';

const GENERIC_STUB = { ok: true };

export function getDemoResponse(path: string, method: string, body?: unknown): unknown {
  const [pathname] = path.split('?');

  if (method === 'POST' && pathname === '/api/auth/switch-tenant') {
    const tenantId = (body as { tenantId?: string } | undefined)?.tenantId;
    const client = tenantId ? setActiveDemoClient(tenantId) : null;
    if (!client) return { error: 'not found' };
    return { ok: true, csrf: DEMO_ME.csrf, tenant: { id: client.id, slug: client.slug, name: client.name } };
  }

  if (method === 'GET') {
    if (pathname === '/api/auth/me') return DEMO_ME;
    if (pathname === '/api/auth/profile') return getDemoProfile();
    if (pathname === '/api/tenant/settings') return getDemoSettings();
    if (pathname === '/api/tenant/sources') return { sources: getDemoSources() };
    if (pathname === '/api/tenant/months') return getDemoMonthsResponse();
    if (pathname === '/api/tenant/settings/custom-domain') return { hostname: null };
    if (pathname === '/api/tenant/users') return { users: getDemoTeamUsers() };
    if (pathname === '/api/tenant/integrations') return { integrations: [], requirements: {} };
    if (pathname === '/api/imports') return { imports: [] };
    if (pathname === '/api/agency/overview') return getDemoAgencyOverview();
    if (pathname === '/api/agency/users') return { users: getDemoAgencyUsers() };
    if (pathname === '/api/agency/tenants') {
      return { tenants: getDemoAgencyOverview().tenants.map((t) => ({ id: t.id, name: t.name })) };
    }
    if (pathname.startsWith('/api/help/search')) return { articles: [] };
    if (pathname.startsWith('/api/help/articles/')) return { article: { title: '', body_md: '' } };

    const monthMatch = pathname.match(/^\/api\/tenant\/months\/([^/]+)\/leads$/);
    if (monthMatch) return { leads: [] };

    const targetsMatch = pathname.match(/^\/api\/tenant\/targets\/([^/]+)$/);
    if (targetsMatch) return { targets: [] };

    const singleMonthMatch = pathname.match(/^\/api\/tenant\/months\/([^/]+)$/);
    if (singleMonthMatch) return getDemoMonthData(decodeURIComponent(singleMonthMatch[1]));
  }

  return GENERIC_STUB;
}
