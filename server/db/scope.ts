// Who is asking, and what they are allowed to ask about.
//
// The single rule this file exists to enforce: a client_id that arrives in a
// URL is a hint, not an instruction. Scope is derived from the session, and a
// requested client is checked against it before any query runs. The prototype
// enforced entitlement by not drawing a sidebar button, on a product that
// sells modules per client, which is what makes this the most important file
// in the server.

import type { D1Database } from '@cloudflare/workers-types';
import type { Env } from '@server/env';
import { forbidden, notFound, unauthorized } from '@server/http';
import { hashSessionToken } from '@server/crypto/tokens';
import type { SessionUser } from '@/lib/api/contracts';

export const SESSION_COOKIE = 'stopply_session';

export interface Session {
  sessionId: string;
  user: SessionUser;
  /** Null means every client, which only a super_admin holds. */
  scopedClientIds: string[] | null;
}

interface UserRow {
  id: string;
  email: string;
  name: string;
  role: string;
  client_id: string | null;
  status: string;
  client_name: string | null;
}

/**
 * Read one cookie by name.
 *
 * Split on ';' then on the first '=' only, because a cookie value may itself
 * contain '='. Matching on a substring, which is the usual shortcut, would
 * let a cookie named `x_stopply_session` satisfy a lookup for
 * `stopply_session`.
 */
export function readCookie(request: Request, name: string): string | null {
  const header = request.headers.get('cookie');
  if (!header) return null;
  for (const part of header.split(';')) {
    const trimmed = part.trim();
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    if (trimmed.slice(0, eq) === name) return decodeURIComponent(trimmed.slice(eq + 1));
  }
  return null;
}

/**
 * Resolve the session, or throw 401.
 *
 * Expiry is compared in SQL against the caller's timestamp so an expired row
 * simply does not match, rather than being fetched and then judged. There is
 * no path where an expired session is loaded into a variable that somebody
 * later forgets to check.
 */
export async function requireSession(request: Request, env: Env): Promise<Session> {
  const token = readCookie(request, SESSION_COOKIE);
  if (!token) throw unauthorized();

  const sessionId = await hashSessionToken(token);
  const now = new Date().toISOString();

  const row = await env.DB.prepare(
    `SELECT u.id, u.email, u.name, u.role, u.client_id, u.status, c.name AS client_name
       FROM sessions s
       JOIN users u ON u.id = s.user_id
       LEFT JOIN clients c ON c.id = u.client_id
      WHERE s.id = ?1 AND s.expires_at > ?2`
  )
    .bind(sessionId, now)
    .first<UserRow>();

  if (!row) throw unauthorized('Your session has expired. Sign in again.');

  // A deactivated account keeps any cookie it was holding. Checking status
  // here is what makes deactivation take effect on the next request rather
  // than whenever the session happens to lapse.
  if (row.status !== 'active') {
    throw forbidden('This account is not active.');
  }

  const user: SessionUser = {
    id: row.id,
    name: row.name,
    email: row.email,
    role: row.role as SessionUser['role'],
    clientId: row.client_id,
    ...(row.client_name ? { clientName: row.client_name } : {}),
    // Narrowed to the literal by the guard above, so no assertion is needed
    // and none is written: an `as` here would keep compiling if that guard
    // were ever removed.
    status: row.status,
  };

  return {
    sessionId,
    user,
    scopedClientIds: row.role === 'super_admin' ? null : row.client_id ? [row.client_id] : [],
  };
}

/**
 * Validate a requested client against the session's scope.
 *
 * Returns the id only if it is in scope, so callers interpolate the return
 * value rather than the parameter they were given. That is a small
 * discipline that makes the unchecked version awkward to write by accident.
 *
 * Out of scope answers 404, not 403: telling an unauthorised caller that a
 * client exists is itself a disclosure, and the two cases are
 * indistinguishable from outside on purpose.
 */
export async function requireClientInScope(
  db: D1Database,
  session: Session,
  requestedClientId: string | undefined
): Promise<string> {
  if (!requestedClientId) throw notFound('No such workspace.');

  if (session.scopedClientIds !== null && !session.scopedClientIds.includes(requestedClientId)) {
    throw notFound('No such workspace.');
  }

  const exists = await db
    .prepare('SELECT id FROM clients WHERE id = ?1')
    .bind(requestedClientId)
    .first<{ id: string }>();
  if (!exists) throw notFound('No such workspace.');

  return exists.id;
}

/**
 * Entitlement, re-checked server-side on every module data request.
 *
 * §6b's ModuleGuard is a UX affordance and says so in its own comment. This
 * is the check that actually decides, and it reads the same row the billing
 * conversation is about.
 */
export async function requireModuleEnabled(
  db: D1Database,
  clientId: string,
  moduleId: string | undefined
): Promise<string> {
  if (!moduleId) throw notFound('No such module.');

  const row = await db
    .prepare('SELECT module_id FROM client_modules WHERE client_id = ?1 AND module_id = ?2')
    .bind(clientId, moduleId)
    .first<{ module_id: string }>();

  if (!row) throw forbidden('That module is not enabled for this workspace.');
  return row.module_id;
}

/**
 * A SQL fragment restricting a query to the session's clients.
 *
 * Returned as a fragment plus its bindings so a caller cannot build the
 * string by concatenating an id, which is the shape most of these bugs take.
 */
export function scopeFilter(
  session: Session,
  column = 'client_id'
): { sql: string; bindings: string[] } {
  if (session.scopedClientIds === null) return { sql: '1 = 1', bindings: [] };
  if (session.scopedClientIds.length === 0) return { sql: '1 = 0', bindings: [] };
  const placeholders = session.scopedClientIds.map((_, i) => `?${i + 1}`).join(', ');
  return { sql: `${column} IN (${placeholders})`, bindings: [...session.scopedClientIds] };
}
