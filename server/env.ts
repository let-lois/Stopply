// Bindings, and the rule that a missing one is an outage rather than a
// bypass.
//
// The spec calls out `if (env.TURNSTILE_SECRET)` by name: a guard shaped like
// that turns "the operator forgot to set the secret" into "the protection is
// off", silently, in production. Every binding this server needs is read
// through requireBinding, which throws. A throw becomes a 500. A 500 is a
// visible failure somebody fixes.

import type { D1Database } from '@cloudflare/workers-types';

export interface Env {
  DB: D1Database;
  /** Base64, 32 bytes. Wraps credential_refs.sealed. */
  CRED_MASTER_KEY?: string;
  /** Server half of the Turnstile keypair. */
  TURNSTILE_SECRET?: string;
  /** Public half. A var rather than a secret: the browser renders with it. */
  TURNSTILE_SITE_KEY?: string;
  /**
   * Overrides the Turnstile verification endpoint outside production.
   *
   * Ignored entirely when ENVIRONMENT is "production", which wrangler.toml
   * pins for the deployed project. See server/turnstile.ts.
   */
  TURNSTILE_VERIFY_URL?: string;
  ENVIRONMENT?: string;
}

export class MissingBindingError extends Error {
  constructor(name: string) {
    // The name of a binding is not a secret, and naming it is the difference
    // between a five minute fix and an afternoon.
    super(`Required binding ${name} is not configured`);
    this.name = 'MissingBindingError';
  }
}

/**
 * Read a required string binding, or throw.
 *
 * There is deliberately no default, no fallback, and no boolean-returning
 * variant. A caller cannot accidentally treat absence as permission.
 */
export function requireBinding(env: Env, name: 'CRED_MASTER_KEY' | 'TURNSTILE_SECRET'): string {
  const value = env[name];
  if (typeof value !== 'string' || value.length === 0) {
    throw new MissingBindingError(name);
  }
  return value;
}
