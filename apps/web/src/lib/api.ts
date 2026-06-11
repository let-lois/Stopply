// Tiny API client. Same origin: the Worker serves /api/* on the same
// hostname as the static app. The CSRF token from login or /me rides on
// every mutating request.

let csrfToken: string | null = null;

export function setCsrf(token: string | null): void {
  csrfToken = token;
}

export function getCsrf(): string | null {
  return csrfToken;
}

export class ApiError extends Error {
  status: number;
  body: Record<string, unknown>;
  constructor(status: number, body: Record<string, unknown>) {
    super(String(body.error ?? `HTTP ${status}`));
    this.status = status;
    this.body = body;
  }
}

export async function api<T = Record<string, unknown>>(
  path: string,
  init: RequestInit & { json?: unknown } = {}
): Promise<T> {
  const headers: Record<string, string> = { ...(init.headers as Record<string, string>) };
  let body = init.body;
  if (init.json !== undefined) {
    headers['content-type'] = 'application/json';
    body = JSON.stringify(init.json);
  }
  const method = (init.method ?? 'GET').toUpperCase();
  if (method !== 'GET' && csrfToken) headers['x-csrf-token'] = csrfToken;
  const res = await fetch(path, { ...init, headers, body, credentials: 'same-origin' });
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) throw new ApiError(res.status, data);
  return data as T;
}

export interface Me {
  userType: 'agency' | 'tenant';
  userId: string;
  role: 'agency_admin' | 'agency_staff' | 'account_admin' | 'viewer';
  tenantId: string | null;
  csrf: string;
}

export async function fetchMe(): Promise<Me | null> {
  try {
    const me = await api<Me>('/api/auth/me');
    setCsrf(me.csrf);
    return me;
  } catch {
    return null;
  }
}
