import type { Env } from './env';
import { randomToken } from './crypto';

export interface AuditEntry {
  actorType: 'agency' | 'tenant' | 'system' | 'chat';
  actorId?: string | null;
  actorName?: string | null;
  tenantId?: string | null;
  action: string;
  target?: string | null;
  before?: unknown;
  after?: unknown;
}

export async function writeAudit(env: Env, entry: AuditEntry): Promise<void> {
  await env.CONTROL_DB.prepare(
    `INSERT INTO audit_log (id, actor_type, actor_id, actor_name, tenant_id, action, target, before_json, after_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(
      randomToken(16),
      entry.actorType,
      entry.actorId ?? null,
      entry.actorName ?? null,
      entry.tenantId ?? null,
      entry.action,
      entry.target ?? null,
      entry.before === undefined ? null : JSON.stringify(entry.before),
      entry.after === undefined ? null : JSON.stringify(entry.after)
    )
    .run();
}
