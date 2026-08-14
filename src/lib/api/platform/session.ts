// Who is signed in, translated between two vocabularies.
//
// Both systems have roles. They are not the same roles, and the mapping is the
// interesting part of this file, so it is written out as a table with its
// reasoning rather than buried in a switch.

import { z } from 'zod';
import type { SessionResponse, SessionUser } from '@/lib/api/contracts';
import type { UserRole } from '@/types';
import { platformRequest, setCsrfToken } from '@/lib/api/platform/wire';
import { fetchMe, resetTenantContext } from '@/lib/api/platform/tenantContext';

const loginResponseSchema = z.object({
  ok: z.boolean(),
  csrf: z.string(),
  user: z.object({
    id: z.string(),
    email: z.string(),
    name: z.string(),
    role: z.string(),
  }),
});

const profileSchema = z.object({
  id: z.string(),
  email: z.string(),
  name: z.string(),
  role: z.string(),
});

const okSchema = z.object({ ok: z.boolean() });

/**
 * The platform's roles, mapped onto this app's.
 *
 * agency_admin -> super_admin
 *   The only role the platform lets create a workspace, and the only one this
 *   app grants client.create to. They line up exactly.
 *
 * agency_staff -> client_admin
 *   Not super_admin, which would be the tempting reading of "agency". The
 *   platform refuses tenant creation to agency_staff, and super_admin here
 *   grants client.create, so that mapping would draw a button the server
 *   always refuses. client_admin is the closest role that does not.
 *
 * account_admin -> client_admin
 *   The client's own administrator on both sides.
 *
 * viewer -> manager
 *   The loosest fit, and worth naming rather than hiding. The platform's
 *   viewer is read only; this app has no read only role, and manager is the
 *   narrowest one available. It grants audit.view, which is right, and
 *   field.logVisit, which is wider than the platform allows. That grant is
 *   inert in practice, because visits are logged from the rep app on a rep's
 *   own session and never from a dashboard user's, and the platform's
 *   tenantWrite refuses a viewer's writes server side regardless. Adding a
 *   real read only role is the proper fix and is listed in migrate/README.md.
 */
const ROLE_MAP: Record<string, UserRole> = {
  agency_admin: 'super_admin',
  agency_staff: 'client_admin',
  account_admin: 'client_admin',
  viewer: 'manager',
};

/**
 * An unknown role is refused, not defaulted.
 *
 * Defaulting the other way, to the least privilege, sounds safe and is not: a
 * role the platform adds later would silently demote every user holding it,
 * and the symptom would be missing buttons rather than an error anyone could
 * act on. Refusing says what happened.
 */
export function mapRole(role: string): UserRole {
  const mapped = ROLE_MAP[role];
  if (!mapped) throw new Error(`Unrecognized role from the platform: ${role}`);
  return mapped;
}

function toSessionUser(
  raw: { id: string; email: string; name: string; role: string },
  tenantId: string | null
): SessionUser {
  return {
    id: raw.id,
    name: raw.name,
    email: raw.email,
    role: mapRole(raw.role),
    // A tenant user is bound to their own workspace. An agency user is not,
    // even while one is selected: the selection is a place they are looking,
    // not who they are, and treating it as identity would hide our own brand
    // from an agency admin the moment they opened a client.
    clientId: raw.role === 'account_admin' || raw.role === 'viewer' ? tenantId : null,
    status: 'active',
  };
}

/**
 * Which workspaces this session may open.
 *
 * Null means all of them. The platform's /api/auth/me does not return the
 * assignment list, so for an agency user the answer comes from the tenant
 * list itself: that endpoint already filters to what the caller may see, so
 * the ids in it are the scope. That is one request either way, and the client
 * list needs it regardless.
 */
export async function fetchSession(signal?: AbortSignal): Promise<SessionResponse> {
  const me = await fetchMe(signal);
  setCsrfToken(me.csrf);

  const profile = await platformRequest(
    '/api/auth/profile',
    profileSchema,
    signal ? { signal } : {}
  );

  const user = toSessionUser(profile, me.tenantId);
  const clientIds = user.role === 'super_admin' ? null : await visibleClientIds(user, signal);
  return { user, clientIds };
}

async function visibleClientIds(user: SessionUser, signal?: AbortSignal): Promise<string[]> {
  if (user.clientId) return [user.clientId];
  const { listTenantIds } = await import('@/lib/api/platform/clients');
  return listTenantIds(signal);
}

/**
 * Sign in.
 *
 * The turnstileToken this app's own login page produces is deliberately not
 * forwarded. The platform's login schema is strict, so an unexpected field is
 * a 400 "invalid request" rather than an ignored extra, and a user would see
 * their correct password reported as a malformed request. The platform runs
 * its own rate limiting on the address and the email instead.
 */
export async function signIn(email: string, password: string): Promise<SessionResponse> {
  resetTenantContext();
  setCsrfToken(null);
  const response = await platformRequest('/api/auth/login', loginResponseSchema, {
    method: 'POST',
    body: { email, password },
  });
  setCsrfToken(response.csrf);

  // A fresh agency session has nothing selected, and a tenant user's selection
  // is their own workspace. Either way the login response does not carry it,
  // so it is read rather than assumed.
  const me = await fetchMe();
  setCsrfToken(me.csrf);

  const user = toSessionUser(response.user, me.tenantId);
  const clientIds = user.role === 'super_admin' ? null : await visibleClientIds(user);
  return { user, clientIds };
}

export async function signOut(): Promise<void> {
  try {
    await platformRequest('/api/auth/logout', okSchema, { method: 'POST' });
  } finally {
    // Cleared even if the request failed. The alternative is a tab that still
    // holds a CSRF token and a selection for a session it believes is over.
    setCsrfToken(null);
    resetTenantContext();
  }
}
