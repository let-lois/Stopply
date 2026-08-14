// The browser's half of the wire.
//
// §11.9 asks for Zod at both boundaries and means it: the server validates
// what arrives, and this validates what comes back. Trusting a response
// because we wrote the server is how a deploy that changes one field turns
// into `cannot read property of undefined` three components deep, with a
// stack trace that points nowhere near the cause.
//
// Every response is parsed against the same schema the server produced it
// from, so a mismatch is one clear error naming the field.

import type { ZodType } from 'zod';
import { errorBodySchema } from '@/lib/api/contracts';

/** An error the server described. Carries its code so callers can branch. */
export class ApiRequestError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = 'ApiRequestError';
    this.status = status;
    this.code = code;
  }
}

/**
 * A response that did not match its contract. Never user error.
 *
 * Usually a bug, but there is one benign cause worth naming in the message
 * rather than making somebody guess: a tab left open across a deploy is still
 * running the old contract, and a field that has since widened (a new
 * disposition, say) reads to it as invalid. That is exactly what it looks
 * like, and reloading fixes it, so the message says so.
 */
export class ApiContractError extends Error {
  constructor(path: string, detail: string) {
    super(
      `The server's response for ${path} did not match the expected shape: ${detail}. ` +
        'If this page has been open a while, reload it: it may be running an older version of the app.'
    );
    this.name = 'ApiContractError';
  }
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  body?: unknown;
  signal?: AbortSignal;
}

function parseJson(text: string): unknown {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

async function request<T>(
  path: string,
  schema: ZodType<T>,
  { method = 'GET', body, signal }: RequestOptions = {}
): Promise<T> {
  const response = await fetch(path, {
    method,
    // The session cookie is HttpOnly, so this is the only way it travels.
    // Nothing in this application reads or writes a token in script.
    credentials: 'same-origin',
    ...(body === undefined ? {} : { headers: { 'content-type': 'application/json' } }),
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    ...(signal ? { signal } : {}),
  });

  const text = await response.text();
  // A body that is not JSON is not an exception here: a gateway or a proxy in
  // front of the app answers with HTML, and that has to become a clean error
  // rather than a parse throw with no status attached.
  const payload = parseJson(text);

  if (!response.ok) {
    const described = errorBodySchema.safeParse(payload);
    if (described.success) {
      throw new ApiRequestError(
        response.status,
        described.data.error.code,
        described.data.error.message
      );
    }
    // A failure the server did not describe: a proxy, a gateway, an outage.
    // Say so plainly rather than surfacing whatever HTML came back.
    throw new ApiRequestError(
      response.status,
      'unexpected',
      'The server could not be reached. Try again.'
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

export const api = {
  get: <T>(path: string, schema: ZodType<T>, signal?: AbortSignal) =>
    request(path, schema, signal ? { signal } : {}),
  post: <T>(path: string, body: unknown, schema: ZodType<T>) =>
    request(path, schema, { method: 'POST', body }),
  patch: <T>(path: string, body: unknown, schema: ZodType<T>) =>
    request(path, schema, { method: 'PATCH', body }),
  delete: <T>(path: string, schema: ZodType<T>) => request(path, schema, { method: 'DELETE' }),
};
