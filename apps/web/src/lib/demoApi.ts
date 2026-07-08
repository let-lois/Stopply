// Routes a request path/method to a canned demo response instead of ever
// hitting the network. Only called when isDemoMode() (demoMode.ts) is
// true. GET reads that drive the main dashboard views are modeled with
// realistic fake data; everything else (every mutation, and any GET not
// explicitly listed) gets a harmless generic stub so nothing throws, but
// nothing simulates a real write either, this is a read-only preview.

import {
  DEMO_ME,
  DEMO_MONTHS_RESPONSE,
  DEMO_PROFILE,
  DEMO_SETTINGS,
  DEMO_SOURCES,
  DEMO_TEAM_USERS,
  getDemoMonthData,
} from './demoData';

const GENERIC_STUB = { ok: true };

export function getDemoResponse(path: string, method: string): unknown {
  const [pathname] = path.split('?');

  if (method === 'GET') {
    if (pathname === '/api/auth/me') return DEMO_ME;
    if (pathname === '/api/auth/profile') return DEMO_PROFILE;
    if (pathname === '/api/tenant/settings') return DEMO_SETTINGS;
    if (pathname === '/api/tenant/sources') return { sources: DEMO_SOURCES };
    if (pathname === '/api/tenant/months') return DEMO_MONTHS_RESPONSE;
    if (pathname === '/api/tenant/settings/custom-domain') return { hostname: null };
    if (pathname === '/api/tenant/users') return { users: DEMO_TEAM_USERS };
    if (pathname === '/api/tenant/integrations') return { integrations: [], requirements: {} };
    if (pathname === '/api/imports') return { imports: [] };
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
