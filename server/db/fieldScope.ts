// Who is knocking, and what they may touch.
//
// This is the field equivalent of db/scope.ts and is deliberately a separate
// file with a separate cookie, a separate table, and no shared types. The two
// never meet.
//
// A rep's session resolves to a rep and a client, and that is the entire
// vocabulary. There is no role, no scope list, and no way to widen it: a field
// session cannot address another workspace because the client id comes off the
// session row rather than out of the request.

import type { D1Database } from '@cloudflare/workers-types';
import type { Env } from '@server/env';
import { forbidden, unauthorized } from '@server/http';
import { hashSessionToken } from '@server/crypto/tokens';
import { readCookie, SESSION_COOKIE } from '@server/db/scope';

/**
 * Distinct from the dashboard's cookie, on purpose.
 *
 * One person holds both at once: a manager who also knocks. Sharing a name
 * would mean signing in on one side silently replaced the other, and a leaked
 * rep credential would carry a dashboard session with it.
 */
export const FIELD_COOKIE = 'stopply_field';

export interface FieldSession {
  sessionId: string;
  repId: string;
  repName: string;
  /** From the session row. Never from the request. */
  clientId: string;
}

interface FieldRow {
  rep_id: string;
  rep_name: string;
  client_id: string;
  status: string;
}

/**
 * Resolve a rep's session, or refuse.
 *
 * Note what this cannot do. It reads FIELD_COOKIE, hashes it, and looks it up
 * in field_sessions, which joins only to reps. A dashboard token presented
 * here hashes to a row in `sessions`, which this query never touches, so it
 * simply does not match. The isolation is the schema's, not this function's.
 */
export async function requireFieldSession(request: Request, env: Env): Promise<FieldSession> {
  const token = readCookie(request, FIELD_COOKIE);
  if (!token) throw unauthorized('Sign in to log knocks.');

  const row = await env.DB.prepare(
    `SELECT r.id AS rep_id, r.name AS rep_name, fs.client_id, r.status
       FROM field_sessions fs
       JOIN reps r ON r.id = fs.rep_id
      WHERE fs.id = ?1 AND fs.expires_at > ?2`
  )
    .bind(await hashSessionToken(token), new Date().toISOString())
    .first<FieldRow>();

  if (!row) throw unauthorized('Your session has expired. Sign in again.');

  // A rep who has left keeps whatever cookie was on their phone. Checking here
  // is what makes deactivation take effect on the next knock rather than
  // whenever the session happens to lapse, which for a field session is a
  // month away by design.
  if (row.status !== 'active') throw forbidden('This account is no longer active.');

  return {
    sessionId: await hashSessionToken(token),
    repId: row.rep_id,
    repName: row.rep_name,
    clientId: row.client_id,
  };
}

/**
 * Refuse a field cookie on a dashboard route.
 *
 * The cookie names already keep these apart, so this is the second lock rather
 * than the first. It exists because the failure it prevents is silent: a rep
 * whose cookie was somehow accepted on /api/clients would be handed a client's
 * whole book of business, and nothing about that request would look wrong in a
 * log.
 */
export function rejectFieldCookie(request: Request): void {
  const field = readCookie(request, FIELD_COOKIE);
  const dashboard = readCookie(request, SESSION_COOKIE);
  if (field && !dashboard) {
    throw forbidden('This is a field sign-in. Sign in on the dashboard to view reporting.');
  }
}

/**
 * The rep's own doors, by territory.
 *
 * Scoped to the session's client and, when the rep has a territory, to that
 * territory. A rep with no territory sees their client's doors rather than
 * nothing, because an unassigned rep on their first morning should still be
 * able to work.
 */
export async function repTerritoryFilter(
  db: D1Database,
  session: FieldSession
): Promise<{ sql: string; bindings: string[] }> {
  const rep = await db
    .prepare('SELECT territory_id FROM reps WHERE id = ?1')
    .bind(session.repId)
    .first<{ territory_id: string | null }>();

  if (!rep?.territory_id) {
    return { sql: 'client_id = ?1', bindings: [session.clientId] };
  }
  return {
    sql: 'client_id = ?1 AND territory_id = ?2',
    bindings: [session.clientId, rep.territory_id],
  };
}
