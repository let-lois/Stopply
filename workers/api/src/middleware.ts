import type { Context, Next } from 'hono';
import type { Role } from '@letlois/db';
import type { AppContext } from './env';
import { getSession, readSessionToken, checkCsrf } from './session';
import { isAgencyHost, resolveTenantByHost, getTenantById } from './tenantResolver';

// Resolves host context and session on every request. Unknown hostnames
// 404 before anything else runs. Agency routes are refused outright on
// tenant hosts; tenant routes on the agency host require a switcher
// selection held server side in the session.
export async function contextMiddleware(c: Context<AppContext>, next: Next): Promise<Response | void> {
  const url = new URL(c.req.url);
  const host = url.hostname;
  const env = c.env;

  if (isAgencyHost(env, host)) {
    c.set('hostContext', 'agency');
    c.set('tenant', null);
  } else {
    const tenant = await resolveTenantByHost(env, host);
    if (!tenant) return c.json({ error: 'not found' }, 404);
    c.set('hostContext', 'tenant');
    c.set('tenant', tenant);
  }

  const token = readSessionToken(c.req.header('cookie'));
  c.set('sessionToken', token);
  c.set('session', token ? await getSession(env, token) : null);

  await next();
}

export async function requireAuth(c: Context<AppContext>, next: Next): Promise<Response | void> {
  if (!c.get('session')) return c.json({ error: 'unauthorized' }, 401);
  await next();
}

export function requireRole(...roles: Role[]) {
  return async (c: Context<AppContext>, next: Next): Promise<Response | void> => {
    const session = c.get('session');
    if (!session) return c.json({ error: 'unauthorized' }, 401);
    if (!roles.includes(session.role)) return c.json({ error: 'forbidden' }, 403);
    await next();
  };
}

// CSRF double submit check on every mutating method.
export async function csrfMiddleware(c: Context<AppContext>, next: Next): Promise<Response | void> {
  const method = c.req.method.toUpperCase();
  if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) {
    const session = c.get('session');
    if (session && !checkCsrf(session, c.req.raw)) {
      return c.json({ error: 'csrf token missing or invalid' }, 403);
    }
  }
  await next();
}

// Refuses agency routes anywhere but the agency host, and requires an
// agency session.
export async function agencyOnly(c: Context<AppContext>, next: Next): Promise<Response | void> {
  if (c.get('hostContext') !== 'agency') return c.json({ error: 'not found' }, 404);
  const session = c.get('session');
  if (!session) return c.json({ error: 'unauthorized' }, 401);
  if (session.userType !== 'agency') return c.json({ error: 'forbidden' }, 403);
  await next();
}

// Resolves the effective tenant for tenant scoped routes and stores it in
// the context. Tenant identity comes only from the hostname or the agency
// session switcher, never from the client request.
export async function tenantScope(c: Context<AppContext>, next: Next): Promise<Response | void> {
  const session = c.get('session');
  if (!session) return c.json({ error: 'unauthorized' }, 401);

  if (c.get('hostContext') === 'tenant') {
    const hostTenant = c.get('tenant');
    if (!hostTenant) return c.json({ error: 'not found' }, 404);
    if (session.userType === 'tenant') {
      // A tenant session is only valid on its own tenant's host.
      if (session.tenantId !== hostTenant.id) return c.json({ error: 'forbidden' }, 403);
    } else if (session.userType === 'agency') {
      if (!agencyCanAccess(session.role, session.assignedTenants, hostTenant.id)) {
        return c.json({ error: 'forbidden' }, 403);
      }
    }
    await next();
    return;
  }

  // Agency host: only agency users may reach tenant scoped routes, via a
  // server validated switcher selection stored in the session.
  if (session.userType !== 'agency') return c.json({ error: 'forbidden' }, 403);
  if (!session.tenantId) return c.json({ error: 'no tenant selected' }, 400);
  if (!agencyCanAccess(session.role, session.assignedTenants, session.tenantId)) {
    return c.json({ error: 'forbidden' }, 403);
  }
  const tenant = await getTenantById(c.env, session.tenantId);
  if (!tenant || tenant.status !== 'active') return c.json({ error: 'not found' }, 404);
  c.set('tenant', tenant);
  await next();
}

export function agencyCanAccess(
  role: Role,
  assignedTenants: string[] | null,
  tenantId: string
): boolean {
  if (role === 'agency_admin') return true;
  if (role === 'agency_staff') return (assignedTenants ?? []).includes(tenantId);
  return false;
}

// Write access inside a tenant: account_admin, or any agency role with
// access to the tenant. Viewers are read only everywhere.
export async function tenantWrite(c: Context<AppContext>, next: Next): Promise<Response | void> {
  const session = c.get('session');
  if (!session) return c.json({ error: 'unauthorized' }, 401);
  const ok =
    session.role === 'account_admin' ||
    session.role === 'agency_admin' ||
    session.role === 'agency_staff';
  if (!ok) return c.json({ error: 'forbidden' }, 403);
  await next();
}
