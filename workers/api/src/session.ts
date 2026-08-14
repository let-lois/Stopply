import type { SessionRecord } from '@letlois/db';
import type { Env } from './env';
import { randomToken } from './crypto';

const SESSION_TTL_SECONDS = 14 * 24 * 60 * 60; // absolute 14 day expiry
const COOKIE_NAME = 'lbi_session';
// Field reps carry their own cookie. A rep and a dashboard user share a
// hostname (the field app lives at /field on the tenant's own domain), so
// one cookie name would mean signing into the field app silently signs the
// same person out of the dashboard, and the reverse. Two names let an
// account admin hold both at once, and keep a leaked rep cookie from ever
// being presented as a dashboard session.
const FIELD_COOKIE_NAME = 'lbi_field';
const CSRF_HEADER = 'x-csrf-token';

export function sessionCookieName(): string {
  return COOKIE_NAME;
}

export function fieldCookieName(): string {
  return FIELD_COOKIE_NAME;
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

function cookie(name: string, token: string, secure: boolean, maxAge: number): string {
  const attrs = [`${name}=${token}`, 'Path=/', 'HttpOnly', 'SameSite=Lax', `Max-Age=${maxAge}`];
  if (secure) attrs.push('Secure');
  return attrs.join('; ');
}

export function buildSessionCookie(token: string, secure: boolean): string {
  return cookie(COOKIE_NAME, token, secure, SESSION_TTL_SECONDS);
}

export function clearSessionCookie(secure: boolean): string {
  return cookie(COOKIE_NAME, '', secure, 0);
}

export function buildFieldCookie(token: string, secure: boolean): string {
  return cookie(FIELD_COOKIE_NAME, token, secure, SESSION_TTL_SECONDS);
}

export function clearFieldCookie(secure: boolean): string {
  return cookie(FIELD_COOKIE_NAME, '', secure, 0);
}

function readCookie(cookieHeader: string | undefined, name: string): string | null {
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(';')) {
    const [k, ...rest] = part.trim().split('=');
    if (k === name) return rest.join('=') || null;
  }
  return null;
}

export function readSessionToken(cookieHeader: string | undefined): string | null {
  return readCookie(cookieHeader, COOKIE_NAME);
}

export function readFieldToken(cookieHeader: string | undefined): string | null {
  return readCookie(cookieHeader, FIELD_COOKIE_NAME);
}

// The standalone field app on the App Store and Play Store runs from its own
// local origin inside a WebView, so its requests to this API are cross
// origin and a cookie will not ride along: SameSite=Lax drops it, and iOS
// blocks third party cookies in a WKWebView outright. The native build
// carries its session in an Authorization header instead.
//
// Only ever consulted for the field population. The dashboard stays cookie
// only, so nothing about this widens what a leaked dashboard token can do.
export function readBearerToken(authHeader: string | undefined): string | null {
  if (!authHeader) return null;
  const match = /^Bearer\s+([0-9a-f]{16,128})$/i.exec(authHeader.trim());
  return match?.[1] ?? null;
}

// Field sessions slide: every bootstrap from a signed in rep pushes the
// expiry back out to a full window. A rep opens this app every working day,
// and being signed out mid shift, at a door, possibly with no signal to sign
// back in, is the worst failure this app has. Inactivity still ends it, and
// deactivating a rep still cuts them off immediately because /me rechecks
// `active` on every call.
//
// Deliberately not applied to the dashboard, which keeps its absolute expiry.
export async function renewSession(env: Env, token: string, record: SessionRecord): Promise<void> {
  await env.SESSIONS.put(`session:${token}`, JSON.stringify(record), {
    expirationTtl: SESSION_TTL_SECONDS,
  });
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
