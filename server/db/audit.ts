// The audit trail.
//
// Every value that matters is set here, from the server: the timestamp from
// the server's clock, the actor from the session, the address from
// CF-Connecting-IP. Nothing a caller sends reaches this table except the
// details string, which is assembled from values the handler has already
// validated.
//
// The table itself refuses UPDATE and DELETE, so this is not merely the
// intended way to write to it, it is the only way.

import type { D1Database } from '@cloudflare/workers-types';
import { newId } from '@server/crypto/tokens';
import type { Session } from '@server/db/scope';

export interface AuditInput {
  session: Session;
  action: string;
  details: string;
  clientId?: string | null;
  clientName?: string | null;
  moduleId?: string | null;
  ipAddress?: string | null;
}

/**
 * Append one entry.
 *
 * Deliberately not fire-and-forget. If the trail cannot be written the action
 * that produced it should fail too, because an action that happened with no
 * record of it is the exact thing an audit log exists to prevent. Callers
 * therefore await this before returning success.
 */
export async function recordAudit(db: D1Database, input: AuditInput): Promise<void> {
  await db
    .prepare(
      `INSERT INTO audit_log
         (id, occurred_at, user_id, user_name, client_id, client_name, module_id, action, details, ip_address)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)`
    )
    .bind(
      newId('aud'),
      new Date().toISOString(),
      input.session.user.id,
      input.session.user.name,
      input.clientId ?? null,
      input.clientName ?? null,
      input.moduleId ?? null,
      input.action,
      input.details,
      input.ipAddress ?? null
    )
    .run();
}
