// API client for the field app.
//
// Separate from the dashboard client on purpose: it carries its own CSRF
// token (the rep's session is a different cookie), and it distinguishes a
// network failure from a server rejection, which the outbox depends on to
// decide whether retrying could ever help.

let csrfToken: string | null = null;

export function setFieldCsrf(token: string | null): void {
  csrfToken = token;
}

// Thrown when the server answered and said no. Retrying sends the same
// request to the same answer, so the outbox stops rather than looping.
export class FieldApiError extends Error {
  status: number;
  body: Record<string, unknown>;
  constructor(status: number, body: Record<string, unknown>) {
    super(String(body.error ?? `HTTP ${status}`));
    this.name = 'FieldApiError';
    this.status = status;
    this.body = body;
  }
}

// Thrown when the request never got an answer. This is the normal state in
// the field, not an error condition: the visit stays queued and goes out
// when signal comes back.
export class FieldOfflineError extends Error {
  constructor(message = 'no connection') {
    super(message);
    this.name = 'FieldOfflineError';
  }
}

export async function fieldApi<T = Record<string, unknown>>(
  path: string,
  init: RequestInit & { json?: unknown } = {}
): Promise<T> {
  const method = (init.method ?? 'GET').toUpperCase();
  const headers: Record<string, string> = { ...(init.headers as Record<string, string>) };
  let body = init.body;
  if (init.json !== undefined) {
    headers['content-type'] = 'application/json';
    body = JSON.stringify(init.json);
  }
  if (method !== 'GET' && csrfToken) headers['x-csrf-token'] = csrfToken;

  let res: Response;
  try {
    res = await fetch(path, { ...init, headers, body, credentials: 'same-origin' });
  } catch {
    throw new FieldOfflineError();
  }

  // A gateway or origin failure is treated as offline: it is transient and
  // worth retrying, unlike a 400 the server will keep giving.
  if (res.status >= 500) throw new FieldOfflineError(`server unavailable (${res.status})`);

  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) throw new FieldApiError(res.status, data);
  return data as T;
}
