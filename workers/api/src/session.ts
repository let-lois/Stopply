import type { SessionRecord } from '@letlois/db';
import type { Env } from './env';
import { randomToken } from './crypto';

const SESSION_TTL_SECONDS = 14 * 24 * 60 * 60; // absolute 14 day expiry
const COOKIE_NAME = 'lbi_session';
const CSRF_HEADER = 'x-csrf-token';

export function sessionCookieName(): string {
  return COOKIE_NAME;
}

export async function createSession(
  env: Env,
  record: Omit<SessionRecord, 'csrf' | 'createdAt'>
): Promise<{ token: string; csrf: string }> {
  const token = randomToken(32);
  const csrf = randomToken(16);
  const full: SessionRecord = { ...record, csrf, createdAt: new Date().toISOString() };
  await env.SESSIONS.put(`session:${token}`, JSON.stringify(full), {
    expirationTtl: SESSION_TTL_SECONDS,
  });
  return { token, csrf };
}

export async function getSession(env: Env, token: string): Promise<SessionRecord | null> {
  const raw = await env.SESSIONS.get(`session:${token}`);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as SessionRecord;
  } catch {
    return null;
  }
}

export async function destroySession(env: Env, token: string): Promise<void> {
  await env.SESSIONS.delete(`session:${token}`);
}

// Role changes rotate the token: the old session is destroyed and a new
// one minted so a stale token cannot carry an upgraded role.
export async function rotateSession(
  env: Env,
  oldToken: string,
  record: Omit<SessionRecord, 'csrf' | 'createdAt'>
): Promise<{ token: string; csrf: string }> {
  await destroySession(env, oldToken);
  return createSession(env, record);
}

export async function updateSession(env: Env, token: string, record: SessionRecord): Promise<void> {
  // Preserve the absolute expiry: recompute remaining TTL from createdAt.
  const created = new Date(record.createdAt).getTime();
  const elapsed = Math.floor((Date.now() - created) / 1000);
  const remaining = Math.max(60, SESSION_TTL_SECONDS - elapsed);
  await env.SESSIONS.put(`session:${token}`, JSON.stringify(record), { expirationTtl: remaining });
}

// Domain is pinned to stopply.com: login is moving there. A browser will
// silently drop this Set-Cookie on responses from bi.letlois.com or any
// other host that isn't stopply.com or a subdomain of it, per the cookie
// Domain-matching rules. That's expected during the migration, since
// bi.letlois.com keeps serving /t.js and /ingest but not authenticated
// sessions.
const COOKIE_DOMAIN = '.stopply.com';

export function buildSessionCookie(token: string, secure: boolean): string {
  const attrs = [
    `${COOKIE_NAME}=${token}`,
    'Path=/',
    `Domain=${COOKIE_DOMAIN}`,
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${SESSION_TTL_SECONDS}`,
  ];
  if (secure) attrs.push('Secure');
  return attrs.join('; ');
}

export function clearSessionCookie(secure: boolean): string {
  const attrs = [`${COOKIE_NAME}=`, 'Path=/', `Domain=${COOKIE_DOMAIN}`, 'HttpOnly', 'SameSite=Lax', 'Max-Age=0'];
  if (secure) attrs.push('Secure');
  return attrs.join('; ');
}

export function readSessionToken(cookieHeader: string | undefined): string | null {
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(';')) {
    const [k, ...rest] = part.trim().split('=');
    if (k === COOKIE_NAME) return rest.join('=') || null;
  }
  return null;
}

// Double submit CSRF: the csrf value lives in the session record and is
// returned to the client at login; mutating requests echo it in a header.
export function csrfHeaderName(): string {
  return CSRF_HEADER;
}

export function checkCsrf(session: SessionRecord, request: Request): boolean {
  const header = request.headers.get(CSRF_HEADER);
  return !!header && header === session.csrf;
}
