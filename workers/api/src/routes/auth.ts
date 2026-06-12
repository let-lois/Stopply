import { Hono } from 'hono';
import { z } from 'zod';
import type { AgencyUserRow, TenantUserRow } from '@letlois/db';
import type { AppContext } from '../env';
import { verifyPassword, hashPassword } from '../crypto';
import {
  buildSessionCookie,
  clearSessionCookie,
  createSession,
  destroySession,
  rotateSession,
} from '../session';
import { LIMITS, rateLimit } from '../ratelimit';
import { tenantD1Client } from '../provisioning';
import { agencyCanAccess } from '../middleware';
import { getTenantById } from '../tenantResolver';
import { writeAudit } from '../audit';

const loginSchema = z
  .object({ email: z.string().email().max(254), password: z.string().min(1).max(256) })
  .strict();

export const authRoutes = new Hono<AppContext>();

// Host aware login. Tenant hosts authenticate against the tenant's own
// users table; the agency host authenticates agency_users and falls back
// to the tenant directory to point a tenant user at their own domain.
authRoutes.post('/login', async (c) => {
  const ip = c.req.header('cf-connecting-ip') ?? 'unknown';
  const body = loginSchema.safeParse(await c.req.json().catch(() => null));
  if (!body.success) return c.json({ error: 'invalid request' }, 400);
  const email = body.data.email.toLowerCase().trim();

  const ipOk = await rateLimit(c.env, LIMITS.loginIp, ip);
  const emailOk = await rateLimit(c.env, LIMITS.loginEmail, email);
  if (!ipOk || !emailOk) return c.json({ error: 'too many attempts, try again later' }, 429);

  // Session fixation defense: any token presented at login is destroyed
  // and a fresh one minted on success.
  const presentedToken = c.get('sessionToken');
  if (presentedToken) await destroySession(c.env, presentedToken);

  const secure = new URL(c.req.url).protocol === 'https:';

  if (c.get('hostContext') === 'tenant') {
    const tenant = c.get('tenant');
    if (!tenant?.d1_database_id) return c.json({ error: 'not found' }, 404);
    const d1 = tenantD1Client(c.env);
    const { results } = await d1.query<TenantUserRow>(
      tenant.d1_database_id,
      `SELECT * FROM users WHERE email = ? AND active = 1`,
      [email]
    );
    const user = results[0] ?? null;
    // verifyPassword runs the full derivation even for unknown emails so
    // response timing does not reveal which emails exist.
    const ok = await verifyPassword(body.data.password, user?.password_hash ?? null);
    if (!ok || !user) return c.json({ error: 'invalid email or password' }, 401);

    const { token, csrf } = await createSession(c.env, {
      userType: 'tenant',
      userId: user.id,
      role: user.role,
      tenantId: tenant.id,
      assignedTenants: null,
    });
    c.header('set-cookie', buildSessionCookie(token, secure));
    return c.json({
      ok: true,
      csrf,
      user: { id: user.id, email: user.email, name: user.name, role: user.role },
    });
  }

  // Agency host.
  const agencyUser = await c.env.CONTROL_DB.prepare(
    `SELECT * FROM agency_users WHERE email = ? AND active = 1`
  )
    .bind(email)
    .first<AgencyUserRow>();
  const ok = await verifyPassword(body.data.password, agencyUser?.password_hash ?? null);
  if (ok && agencyUser) {
    const assigned = agencyUser.assigned_tenants_json
      ? (JSON.parse(agencyUser.assigned_tenants_json) as string[])
      : null;
    const { token, csrf } = await createSession(c.env, {
      userType: 'agency',
      userId: agencyUser.id,
      role: agencyUser.role,
      tenantId: null,
      assignedTenants: assigned,
    });
    c.header('set-cookie', buildSessionCookie(token, secure));
    return c.json({
      ok: true,
      csrf,
      user: { id: agencyUser.id, email: agencyUser.email, name: agencyUser.name, role: agencyUser.role },
    });
  }

  // Tenant directory fallback: tell the user where their dashboard lives.
  // No password is checked here; this is a redirect hint only, and we only
  // reveal it after the failed agency check so the cost stays constant.
  const directoryRow = await c.env.CONTROL_DB.prepare(
    `SELECT t.slug, t.custom_hostname FROM tenant_directory d JOIN tenants t ON t.id = d.tenant_id
     WHERE d.email = ? AND t.status = 'active' LIMIT 1`
  )
    .bind(email)
    .first<{ slug: string; custom_hostname: string | null }>();
  if (directoryRow) {
    const host = directoryRow.custom_hostname ?? `${directoryRow.slug}${c.env.TENANT_HOST_SUFFIX}`;
    return c.json({ error: 'use your own dashboard domain', redirectHost: host }, 401);
  }
  return c.json({ error: 'invalid email or password' }, 401);
});

authRoutes.post('/logout', async (c) => {
  const token = c.get('sessionToken');
  if (token) await destroySession(c.env, token);
  const secure = new URL(c.req.url).protocol === 'https:';
  c.header('set-cookie', clearSessionCookie(secure));
  return c.json({ ok: true });
});

authRoutes.get('/me', async (c) => {
  const session = c.get('session');
  if (!session) return c.json({ error: 'unauthorized' }, 401);
  return c.json({
    userType: session.userType,
    userId: session.userId,
    role: session.role,
    tenantId: session.tenantId,
    csrf: session.csrf,
  });
});

// Profile: the signed in user's own name and email. Agency users live in
// CONTROL_DB.agency_users; tenant users live in their own tenant database,
// resolved from the host tenant. This lets anyone update their own profile
// and change their password without an admin.
authRoutes.get('/profile', async (c) => {
  const session = c.get('session');
  if (!session) return c.json({ error: 'unauthorized' }, 401);
  if (session.userType === 'agency') {
    const row = await c.env.CONTROL_DB.prepare(
      `SELECT id, email, name, role FROM agency_users WHERE id = ?`
    )
      .bind(session.userId)
      .first<{ id: string; email: string; name: string; role: string }>();
    if (!row) return c.json({ error: 'not found' }, 404);
    return c.json({ id: row.id, email: row.email, name: row.name, role: row.role });
  }
  const tenant = c.get('tenant');
  if (!tenant?.d1_database_id) return c.json({ error: 'not found' }, 404);
  const d1 = tenantD1Client(c.env);
  const { results } = await d1.query<{ id: string; email: string; name: string; role: string }>(
    tenant.d1_database_id,
    `SELECT id, email, name, role FROM users WHERE id = ?`,
    [session.userId]
  );
  const row = results[0];
  if (!row) return c.json({ error: 'not found' }, 404);
  return c.json({ id: row.id, email: row.email, name: row.name, role: row.role });
});

const profileSchema = z.object({ name: z.string().min(1).max(120) }).strict();

authRoutes.put('/profile', async (c) => {
  const session = c.get('session');
  if (!session) return c.json({ error: 'unauthorized' }, 401);
  const body = profileSchema.safeParse(await c.req.json().catch(() => null));
  if (!body.success) return c.json({ error: 'invalid request' }, 400);
  const name = body.data.name.trim();
  if (session.userType === 'agency') {
    await c.env.CONTROL_DB.prepare(`UPDATE agency_users SET name = ? WHERE id = ?`)
      .bind(name, session.userId)
      .run();
  } else {
    const tenant = c.get('tenant');
    if (!tenant?.d1_database_id) return c.json({ error: 'not found' }, 404);
    const d1 = tenantD1Client(c.env);
    await d1.query(tenant.d1_database_id, `UPDATE users SET name = ? WHERE id = ?`, [name, session.userId]);
  }
  await writeAudit(c.env, {
    actorType: session.userType,
    actorId: session.userId,
    tenantId: session.tenantId,
    action: 'profile.update',
    target: session.userId,
  });
  return c.json({ ok: true, name });
});

const passwordSchema = z
  .object({ currentPassword: z.string().min(1).max(256), newPassword: z.string().min(8).max(256) })
  .strict();

authRoutes.put('/password', async (c) => {
  const session = c.get('session');
  if (!session) return c.json({ error: 'unauthorized' }, 401);
  const body = passwordSchema.safeParse(await c.req.json().catch(() => null));
  if (!body.success) return c.json({ error: 'password must be at least 8 characters' }, 400);

  let storedHash: string | null = null;
  if (session.userType === 'agency') {
    const row = await c.env.CONTROL_DB.prepare(`SELECT password_hash FROM agency_users WHERE id = ?`)
      .bind(session.userId)
      .first<{ password_hash: string }>();
    storedHash = row?.password_hash ?? null;
  } else {
    const tenant = c.get('tenant');
    if (!tenant?.d1_database_id) return c.json({ error: 'not found' }, 404);
    const d1 = tenantD1Client(c.env);
    const { results } = await d1.query<{ password_hash: string }>(
      tenant.d1_database_id,
      `SELECT password_hash FROM users WHERE id = ?`,
      [session.userId]
    );
    storedHash = results[0]?.password_hash ?? null;
  }

  const ok = await verifyPassword(body.data.currentPassword, storedHash);
  if (!ok) return c.json({ error: 'current password is incorrect' }, 403);

  const newHash = await hashPassword(body.data.newPassword);
  if (session.userType === 'agency') {
    await c.env.CONTROL_DB.prepare(`UPDATE agency_users SET password_hash = ? WHERE id = ?`)
      .bind(newHash, session.userId)
      .run();
  } else {
    const tenant = c.get('tenant')!;
    const d1 = tenantD1Client(c.env);
    await d1.query(tenant.d1_database_id!, `UPDATE users SET password_hash = ? WHERE id = ?`, [
      newHash,
      session.userId,
    ]);
  }
  await writeAudit(c.env, {
    actorType: session.userType,
    actorId: session.userId,
    tenantId: session.tenantId,
    action: 'password.change',
    target: session.userId,
  });
  return c.json({ ok: true });
});

const switchSchema = z.object({ tenantId: z.string().min(1).max(64) }).strict();

// Agency tenant switcher. Sets the server validated tenant context in the
// session. Tenant users never see or reach this.
authRoutes.post('/switch-tenant', async (c) => {
  const session = c.get('session');
  const token = c.get('sessionToken');
  if (!session || !token) return c.json({ error: 'unauthorized' }, 401);
  if (c.get('hostContext') !== 'agency' || session.userType !== 'agency') {
    return c.json({ error: 'forbidden' }, 403);
  }
  const body = switchSchema.safeParse(await c.req.json().catch(() => null));
  if (!body.success) return c.json({ error: 'invalid request' }, 400);
  if (!agencyCanAccess(session.role, session.assignedTenants, body.data.tenantId)) {
    return c.json({ error: 'forbidden' }, 403);
  }
  const tenant = await getTenantById(c.env, body.data.tenantId);
  if (!tenant || tenant.status !== 'active') return c.json({ error: 'not found' }, 404);

  // Rotate the token on context change.
  const { token: newToken, csrf } = await rotateSession(c.env, token, {
    userType: 'agency',
    userId: session.userId,
    role: session.role,
    tenantId: tenant.id,
    assignedTenants: session.assignedTenants,
  });
  const secure = new URL(c.req.url).protocol === 'https:';
  c.header('set-cookie', buildSessionCookie(newToken, secure));
  await writeAudit(c.env, {
    actorType: 'agency',
    actorId: session.userId,
    tenantId: tenant.id,
    action: 'agency.switch_tenant',
    target: tenant.slug,
  });
  return c.json({ ok: true, csrf, tenant: { id: tenant.id, slug: tenant.slug, name: tenant.name } });
});
