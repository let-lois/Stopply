// Sign in, sign out, and "who am I".

import type { D1Database } from '@cloudflare/workers-types';
import { json, clientIp, unauthorized, ApiError, readJson } from '@server/http';
import type { RouteContext } from '@server/router';
import { hashPassword, verifyPassword } from '@server/crypto/password';
import { hashSessionToken, mintSessionToken, newId } from '@server/crypto/tokens';
import { requireSession, readCookie, SESSION_COOKIE, type Session } from '@server/db/scope';
import { recordAudit } from '@server/db/audit';
import { verifyTurnstile } from '@server/turnstile';
import { loginRequestSchema, type SessionResponse } from '@/lib/api/contracts';

const SESSION_TTL_MS = 12 * 60 * 60 * 1000;

// Ten failures from one address in fifteen minutes is far above what a person
// mistyping a password produces and far below what makes a password spray
// worthwhile.
const ATTEMPT_WINDOW_MS = 15 * 60 * 1000;
const MAX_FAILURES = 10;

/**
 * Cookie attributes, in one place so no endpoint can set a weaker variant.
 *
 * HttpOnly keeps it away from any script, including our own, which is why
 * there is no token in localStorage anywhere in this application. SameSite
 * Lax lets a normal top-level navigation carry it while cross-site form posts
 * do not. Secure is unconditional; local development runs
 * `wrangler pages dev --local-protocol https` rather than relaxing it.
 */
function sessionCookie(token: string, maxAgeSeconds: number): string {
  return [
    `${SESSION_COOKIE}=${encodeURIComponent(token)}`,
    'Path=/',
    'HttpOnly',
    'Secure',
    'SameSite=Lax',
    `Max-Age=${maxAgeSeconds}`,
  ].join('; ');
}

async function recentFailures(db: D1Database, ip: string): Promise<number> {
  const since = new Date(Date.now() - ATTEMPT_WINDOW_MS).toISOString();
  const row = await db
    .prepare(
      `SELECT count(*) AS n FROM login_attempts
        WHERE ip_address = ?1 AND succeeded = 0 AND attempted_at > ?2`
    )
    .bind(ip, since)
    .first<{ n: number }>();
  return row?.n ?? 0;
}

async function recordAttempt(
  db: D1Database,
  ip: string,
  email: string,
  succeeded: boolean
): Promise<void> {
  await db
    .prepare(
      'INSERT INTO login_attempts (id, ip_address, email, attempted_at, succeeded) VALUES (?1, ?2, ?3, ?4, ?5)'
    )
    .bind(newId('att'), ip, email, new Date().toISOString(), succeeded ? 1 : 0)
    .run();
}

interface LoginRow {
  id: string;
  email: string;
  name: string;
  role: string;
  client_id: string | null;
  status: string;
  password_hash: string | null;
  client_name: string | null;
}

export async function login(ctx: RouteContext): Promise<Response> {
  const body = await readJson(ctx.request, loginRequestSchema);
  const ip = clientIp(ctx.request) ?? 'unknown';

  // Before the challenge and before the hash, so a throttled caller costs
  // nothing but one indexed count.
  if ((await recentFailures(ctx.env.DB, ip)) >= MAX_FAILURES) {
    throw new ApiError(
      429,
      'too_many_attempts',
      'Too many sign-in attempts. Wait fifteen minutes and try again.'
    );
  }

  await verifyTurnstile(ctx.env, ctx.request, body.turnstileToken ?? '');

  const email = body.email.trim().toLowerCase();
  const row = await ctx.env.DB.prepare(
    `SELECT u.id, u.email, u.name, u.role, u.client_id, u.status, u.password_hash,
            c.name AS client_name
       FROM users u LEFT JOIN clients c ON c.id = u.client_id
      WHERE u.email = ?1`
  )
    .bind(email)
    .first<LoginRow>();

  // One message and one code for every failure below, whatever the cause: a
  // response that distinguishes "no such account" from "wrong password" is an
  // account enumeration endpoint.
  const reject = () => unauthorized('That email and password do not match.');

  if (!row || !row.password_hash || row.status !== 'active') {
    // Still spend comparable time. Returning instantly for an unknown email
    // and slowly for a known one leaks the same fact through the clock that
    // the message was careful not to say.
    if (!row?.password_hash) hashPassword(body.password);
    await recordAttempt(ctx.env.DB, ip, email, false);
    throw reject();
  }

  if (!verifyPassword(body.password, row.password_hash)) {
    await recordAttempt(ctx.env.DB, ip, email, false);
    throw reject();
  }

  const token = mintSessionToken();
  const now = new Date();
  await ctx.env.DB.prepare(
    `INSERT INTO sessions (id, user_id, created_at, expires_at, last_seen_at, ip_address, user_agent)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)`
  )
    .bind(
      await hashSessionToken(token),
      row.id,
      now.toISOString(),
      new Date(now.getTime() + SESSION_TTL_MS).toISOString(),
      now.toISOString(),
      ip,
      ctx.request.headers.get('user-agent')?.slice(0, 300) ?? null
    )
    .run();

  await recordAttempt(ctx.env.DB, ip, email, true);

  const payload: SessionResponse = {
    user: {
      id: row.id,
      name: row.name,
      email: row.email,
      role: row.role as SessionResponse['user']['role'],
      clientId: row.client_id,
      ...(row.client_name ? { clientName: row.client_name } : {}),
      status: 'active',
    },
    clientIds: row.role === 'super_admin' ? null : row.client_id ? [row.client_id] : [],
  };

  return json(payload, {
    headers: { 'set-cookie': sessionCookie(token, SESSION_TTL_MS / 1000) },
  });
}

export async function logout(ctx: RouteContext): Promise<Response> {
  const token = readCookie(ctx.request, SESSION_COOKIE);

  // The row goes, so the token is dead even if a copy of the cookie survives
  // somewhere. Clearing the cookie alone would leave a working credential in
  // anything that had already captured it.
  if (token) {
    await ctx.env.DB.prepare('DELETE FROM sessions WHERE id = ?1')
      .bind(await hashSessionToken(token))
      .run();
  }

  // Unconditional 204: whether that token was valid is not information a
  // caller needs, and signing out should never fail.
  return json(
    { ok: true },
    { headers: { 'set-cookie': sessionCookie('', 0) } }
  );
}

export async function session(ctx: RouteContext): Promise<Response> {
  const current = await requireSession(ctx.request, ctx.env);
  const payload: SessionResponse = {
    user: current.user,
    clientIds: current.scopedClientIds,
  };
  return json(payload);
}

/** Shared by the handlers that need an actor for the trail. */
export async function withSession(
  ctx: RouteContext,
  fn: (session: Session) => Promise<Response>
): Promise<Response> {
  return fn(await requireSession(ctx.request, ctx.env));
}

export { recordAudit };
