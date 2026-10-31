// Who can sign in to a tenant's dashboard: inviting, resetting a password,
// and switching access off and on again.
//
// Shared by the tenant's own Data and Team screens (routes/tenant.ts) and the
// read and write service routes Operations Center uses (routes/service.ts), so
// a user is created and a password reset the same way whichever app asks.
// Callers write their own audit entry, because only they know who acted.
//
// There is no email provider bound to this Worker: a temporary password is
// returned exactly once for a person to pass on, and only its hash is stored.

import type { Env } from './env';
import { tenantD1Client } from './provisioning';
import { hashPassword, randomToken } from './crypto';
import { sanitizeViewConfig } from './viewConfig';

export type TenantRole = 'account_admin' | 'viewer';

export async function createTenantUser(
  env: Env,
  tenant: { id: string; d1_database_id: string },
  input: { email: string; name: string; role: TenantRole; viewConfig?: unknown }
): Promise<{ ok: true; id: string; email: string; tempPassword: string } | { ok: false; reason: 'exists' }> {
  const email = input.email.toLowerCase().trim();
  const d1 = tenantD1Client(env);
  const existing = await d1.query(tenant.d1_database_id, `SELECT id FROM users WHERE email = ?`, [email]);
  if (existing.results.length > 0) return { ok: false, reason: 'exists' };

  const tempPassword = randomToken(9);
  const id = `u_${randomToken(8)}`;
  const viewConfigJson = input.role === 'viewer' ? JSON.stringify(sanitizeViewConfig(input.viewConfig)) : null;
  await d1.query(
    tenant.d1_database_id,
    `INSERT INTO users (id, email, name, role, password_hash, view_config_json, active) VALUES (?, ?, ?, ?, ?, ?, 1)`,
    [id, email, input.name, input.role, await hashPassword(tempPassword), viewConfigJson]
  );
  await env.CONTROL_DB.prepare(`INSERT OR IGNORE INTO tenant_directory (email, tenant_id) VALUES (?, ?)`)
    .bind(email, tenant.id)
    .run();
  return { ok: true, id, email, tempPassword };
}

// Active users only: resetting a deactivated account's password would read as
// restoring access, which is reactivation's job.
//
// Does NOT end sessions the user already holds: sessions are keyed by token
// alone in KV with no per user index (session.ts), so an existing sign in
// lasts until its TTL.
export async function resetTenantUserPassword(
  env: Env,
  databaseId: string,
  id: string
): Promise<{ ok: true; email: string; tempPassword: string } | { ok: false }> {
  const d1 = tenantD1Client(env);
  const { results } = await d1.query<{ id: string; email: string }>(
    databaseId,
    `SELECT id, email FROM users WHERE id = ? AND active = 1`,
    [id]
  );
  const user = results[0];
  if (!user) return { ok: false };
  const tempPassword = randomToken(9);
  await d1.query(databaseId, `UPDATE users SET password_hash = ? WHERE id = ?`, [await hashPassword(tempPassword), id]);
  return { ok: true, email: user.email, tempPassword };
}

// Sign in refuses an inactive user (routes/auth.ts). The same caveat as a
// password reset applies to a session already open.
export async function setTenantUserActive(
  env: Env,
  databaseId: string,
  id: string,
  active: boolean
): Promise<{ ok: true; email: string } | { ok: false }> {
  const d1 = tenantD1Client(env);
  const { results } = await d1.query<{ email: string; active: number }>(
    databaseId,
    `SELECT email, active FROM users WHERE id = ?`,
    [id]
  );
  const user = results[0];
  if (!user || (user.active === 1) === active) return { ok: false };
  await d1.query(databaseId, `UPDATE users SET active = ? WHERE id = ?`, [active ? 1 : 0, id]);
  return { ok: true, email: user.email };
}
