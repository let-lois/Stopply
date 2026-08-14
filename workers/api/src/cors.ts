// Cross origin access for the standalone field app.
//
// The store builds of the field app run from a local origin inside a
// WebView (capacitor://localhost on iOS, https://localhost on Android), so
// every call they make to this API is cross origin and needs CORS. Nothing
// else does: the dashboard and the web field app are same origin.
//
// Two rules keep this narrow.
//
// It applies to /api/field/* only. Client reporting, the agency console and
// ingest are never reachable cross origin, whatever origin asks.
//
// It never sets Access-Control-Allow-Credentials. The native app
// authenticates with a bearer token it holds itself, so there is no ambient
// credential to protect, and a page that manages to send a request from an
// allowed origin still gets nothing without a token it cannot read.

import type { Context, Next } from 'hono';
import type { AppContext } from './env';

// The origins a Capacitor WebView actually presents. `ionic://` covers the
// older iOS scheme still produced by some toolchains.
const APP_ORIGINS = new Set([
  'capacitor://localhost',
  'ionic://localhost',
  'https://localhost',
  'http://localhost',
]);

// Vite's dev server for the app, so the same build can be run against the
// live API while working on it. Loopback only, and still tokens only.
const DEV_ORIGIN = /^http:\/\/(localhost|127\.0\.0\.1):\d{2,5}$/;

export function isAppOrigin(origin: string | undefined | null): boolean {
  if (!origin) return false;
  return APP_ORIGINS.has(origin.toLowerCase()) || DEV_ORIGIN.test(origin.toLowerCase());
}

const ALLOW_HEADERS = 'content-type, authorization, x-csrf-token';
const ALLOW_METHODS = 'GET, POST, PUT, PATCH, DELETE, OPTIONS';

export async function fieldCors(c: Context<AppContext>, next: Next): Promise<Response | void> {
  const origin = c.req.header('origin');
  const path = new URL(c.req.url).pathname;
  const eligible = path.startsWith('/api/field/') || path === '/api/field';

  if (!eligible || !isAppOrigin(origin)) {
    // Still vary on Origin: the same URL answers differently to the app and
    // to a browser, and a cache must not serve one the other's response.
    if (eligible) c.header('vary', 'origin');
    await next();
    return;
  }

  // Preflight is answered here rather than by a route, so it does not depend
  // on host resolution or on a session the browser has not sent yet.
  if (c.req.method.toUpperCase() === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        'access-control-allow-origin': origin!,
        'access-control-allow-methods': ALLOW_METHODS,
        'access-control-allow-headers': ALLOW_HEADERS,
        'access-control-max-age': '86400',
        vary: 'origin',
      },
    });
  }

  await next();
  c.header('access-control-allow-origin', origin!);
  c.header('vary', 'origin');
}
