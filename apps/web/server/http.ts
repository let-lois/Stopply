// Responses, errors, and the one place a request body is parsed.
//
// Two things here are load-bearing. Errors carry a machine-readable code and
// a message written for the person who hits them, and an error nobody
// anticipated becomes a generic 500 rather than a stack trace: an unexpected
// exception is exactly the case where the detail is most likely to describe
// the inside of the database.
//
// And every request body goes through readJson, which validates against a
// Zod schema before a handler sees it. There is no path from the network to
// a handler that skips it.

import type { ZodType } from 'zod';

export interface ErrorBody {
  error: { code: string; message: string };
}

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

export const unauthorized = (message = 'Sign in to continue.') =>
  new ApiError(401, 'unauthorized', message);

export const forbidden = (message = 'You do not have access to this.') =>
  new ApiError(403, 'forbidden', message);

export const notFound = (message = 'Not found.') => new ApiError(404, 'not_found', message);

export const badRequest = (message: string) => new ApiError(400, 'bad_request', message);

const SECURITY_HEADERS: Record<string, string> = {
  // An API response is never a document, and saying so stops a browser
  // guessing otherwise.
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer',
  // Nothing here is ever a useful cache entry, and several responses describe
  // who you are signed in as.
  'cache-control': 'no-store',
};

export function json(data: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  headers.set('content-type', 'application/json; charset=utf-8');
  for (const [key, value] of Object.entries(SECURITY_HEADERS)) headers.set(key, value);
  return new Response(JSON.stringify(data), { ...init, headers });
}

export function errorResponse(error: unknown): Response {
  if (error instanceof ApiError) {
    const body: ErrorBody = { error: { code: error.code, message: error.message } };
    return json(body, { status: error.status });
  }

  // Anything else is a bug. It is logged where an operator can find it and
  // described to the caller in terms that reveal nothing.
  console.error('[api] unhandled', error);
  const body: ErrorBody = {
    error: { code: 'internal', message: 'Something went wrong. Try again.' },
  };
  return json(body, { status: 500 });
}

/**
 * Parse and validate a JSON request body.
 *
 * A body that is absent, malformed, or the wrong shape is a 400 with a
 * message naming the field, because the caller is usually our own client and
 * "invalid request" costs somebody an hour.
 */
export async function readJson<T>(request: Request, schema: ZodType<T>): Promise<T> {
  const contentType = request.headers.get('content-type') ?? '';
  if (!contentType.includes('application/json')) {
    throw badRequest('Send a JSON body with a content-type of application/json.');
  }

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    throw badRequest('The request body is not valid JSON.');
  }

  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    const field = first && first.path.length > 0 ? first.path.join('.') : 'body';
    throw badRequest(`${field}: ${first?.message ?? 'is not valid'}`);
  }
  return parsed.data;
}

/**
 * The client's address, as Cloudflare sees it.
 *
 * Read from CF-Connecting-IP only. X-Forwarded-For is caller-supplied and an
 * audit trail that records a value the audited party chose is worse than one
 * that records nothing.
 */
export function clientIp(request: Request): string | null {
  return request.headers.get('cf-connecting-ip');
}
