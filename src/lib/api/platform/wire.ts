// Speaking the BI platform's wire protocol.
//
// This app has its own API, served by its own Pages Functions, and that is
// what src/lib/api/client.ts talks to. This file talks to a different server:
// the Hono Worker behind bi.letlois.com, which four clients already use.
//
// The two disagree about three things, and each one is a real failure rather
// than a stylistic difference:
//
//   1. Error bodies. Ours are { error: { code, message } }. The platform's are
//      { error: "some sentence" }, sometimes with an extra field beside it.
//      Handed the platform's shape, our client's errorBodySchema fails to
//      parse and every failure collapses into "The server could not be
//      reached", so a wrong password reads as an outage.
//   2. CSRF. The platform requires an x-csrf-token header on every POST, PUT,
//      PATCH and DELETE once a session exists. This app has no concept of one,
//      because its own server uses SameSite cookies instead.
//   3. The CSRF token is not stable. Signing in mints one; switching the
//      selected client mints another and destroys the first. A cached token is
//      a 403 waiting to happen.
//
// The token is held in a module variable and nowhere else. Not localStorage,
// not sessionStorage, not a cookie this code writes. It dies with the tab,
// which is the correct lifetime for it.

import type { ZodType } from 'zod';
import { z } from 'zod';
import { ApiContractError, ApiRequestError } from '@/lib/api/client';

/** The header name is from the platform's own session.ts. */
const CSRF_HEADER = 'x-csrf-token';

let csrfToken: string | null = null;

export function setCsrfToken(token: string | null): void {
  csrfToken = token;
}

export function getCsrfToken(): string | null {
  return csrfToken;
}

/**
 * The platform's error body.
 *
 * `error` is the only guaranteed field. `redirectHost` rides along on one
 * specific 401, when a client's own user signs in on the agency host and has
 * to be pointed at their own subdomain, so it is read rather than discarded.
 */
const platformErrorSchema = z.object({
  error: z.string(),
  redirectHost: z.string().optional(),
});

/**
 * An error the platform described, carrying the redirect hint when it sent one.
 *
 * The message is the platform's own sentence, passed through unchanged. Every
 * place this app shows an API failure shows `.message`, so rewriting the
 * platform's wording here would only make the displayed text disagree with
 * what the platform actually said.
 */
export class PlatformRequestError extends ApiRequestError {
  readonly redirectHost: string | null;

  constructor(status: number, code: string, message: string, redirectHost: string | null) {
    super(status, code, message);
    this.name = 'PlatformRequestError';
    this.redirectHost = redirectHost;
  }
}

/**
 * A coarse code, derived from the status.
 *
 * The platform does not send machine readable codes, so inventing precise ones
 * by matching on its English would break the day somebody rewords a message.
 * Status is the part that is actually stable.
 */
function codeForStatus(status: number): string {
  if (status === 401) return 'unauthorized';
  if (status === 403) return 'forbidden';
  if (status === 404) return 'not_found';
  if (status === 429) return 'rate_limited';
  if (status >= 500) return 'server_error';
  return 'bad_request';
}

function parseJson(text: string): unknown {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

interface PlatformRequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  body?: unknown;
  signal?: AbortSignal;
}

export async function platformRequest<T>(
  path: string,
  schema: ZodType<T>,
  { method = 'GET', body, signal }: PlatformRequestOptions = {}
): Promise<T> {
  const mutating = method !== 'GET';
  const headers: Record<string, string> = {};
  if (body !== undefined) headers['content-type'] = 'application/json';
  // Sent whenever we hold one and the method needs it. Absent on the very
  // first sign-in, which is correct: there is no session to protect yet, and
  // the platform only checks the header once a session exists.
  if (mutating && csrfToken) headers[CSRF_HEADER] = csrfToken;

  const response = await fetch(path, {
    method,
    // Same-origin because the app is served from the same hostname as the
    // Worker. Cross-origin would need CORS on the platform's side and would
    // put the session cookie on a third party context, so it is not an option
    // that is quietly available here.
    credentials: 'same-origin',
    headers,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    ...(signal ? { signal } : {}),
  });

  const text = await response.text();
  // A body that is not JSON is not an exception: a gateway or a proxy in front
  // of the Worker answers with HTML, and that has to become a clean error with
  // a status attached rather than a parse throw with none.
  const payload: unknown = parseJson(text);

  if (!response.ok) {
    const described = platformErrorSchema.safeParse(payload);
    if (described.success) {
      throw new PlatformRequestError(
        response.status,
        codeForStatus(response.status),
        described.data.error,
        described.data.redirectHost ?? null
      );
    }
    throw new PlatformRequestError(
      response.status,
      codeForStatus(response.status),
      'The server could not be reached. Try again.',
      null
    );
  }

  const parsed = schema.safeParse(payload);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    throw new ApiContractError(
      path,
      first ? `${first.path.join('.') || 'body'} ${first.message}` : 'unknown field'
    );
  }
  return parsed.data;
}
