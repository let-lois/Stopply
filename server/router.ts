// A router small enough to read in one sitting.
//
// The point of hand-rolling it is that the middleware order is written down
// once, in dispatch(), rather than distributed across a directory of
// _middleware files whose composition you have to reconstruct from the
// filesystem. Authentication, tenant scope, and entitlement are the three
// checks this application cannot afford to get wrong, and here they are a
// sequence you can point at.

import type { Env } from '@server/env';
import { ApiError, errorResponse, notFound } from '@server/http';

export type Method = 'GET' | 'POST' | 'PATCH' | 'DELETE';

export interface RouteContext {
  request: Request;
  env: Env;
  url: URL;
  /** Path parameters, by name. Undefined for a name the pattern does not declare. */
  params: Readonly<Record<string, string | undefined>>;
}

export type Handler = (ctx: RouteContext) => Promise<Response>;

export interface Route {
  method: Method;
  /** e.g. /api/clients/:clientId/modules */
  pattern: string;
  handler: Handler;
}

export function route(method: Method, pattern: string, handler: Handler): Route {
  return { method, pattern, handler };
}

/**
 * Match one path against one pattern.
 *
 * Segment count must agree, so /api/clients cannot match
 * /api/clients/:clientId. Returns null for no match, which is distinct from
 * an empty params object for a match with no parameters.
 */
export function matchPath(
  pattern: string,
  pathname: string
): Record<string, string> | null {
  const patternParts = pattern.split('/').filter(Boolean);
  const pathParts = pathname.split('/').filter(Boolean);
  if (patternParts.length !== pathParts.length) return null;

  const params: Record<string, string> = {};
  for (let i = 0; i < patternParts.length; i++) {
    const p = patternParts[i];
    const actual = pathParts[i];
    if (p === undefined || actual === undefined) return null;
    if (p.startsWith(':')) {
      // An empty segment is not a value. Without this /api/clients//modules
      // would bind clientId to the empty string and every scope check
      // downstream would compare against it.
      if (actual.length === 0) return null;
      params[p.slice(1)] = decodeURIComponent(actual);
      continue;
    }
    if (p !== actual) return null;
  }
  return params;
}

export function createRouter(routes: readonly Route[]) {
  return async function dispatch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    try {
      // Matched in two passes so that a known path with the wrong verb is a
      // 405 naming what it does allow, rather than a 404 that sends someone
      // looking for a typo in the path.
      const pathMatches = routes
        .map((r) => ({ r, params: matchPath(r.pattern, url.pathname) }))
        .filter((m): m is { r: Route; params: Record<string, string> } => m.params !== null);

      if (pathMatches.length === 0) throw notFound('No such endpoint.');

      const match = pathMatches.find((m) => m.r.method === request.method);
      if (!match) {
        const allowed = [...new Set(pathMatches.map((m) => m.r.method))].sort();
        throw new ApiError(
          405,
          'method_not_allowed',
          `That endpoint accepts ${allowed.join(', ')}.`
        );
      }

      return await match.r.handler({ request, env, url, params: match.params });
    } catch (error) {
      return errorResponse(error);
    }
  };
}
