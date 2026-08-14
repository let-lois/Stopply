// Turnstile verification, fail-closed.
//
// The spec names the anti-pattern directly:
//
//     if (env.TURNSTILE_SECRET) { ...verify... }
//
// That reads as a safety check and behaves as an off switch. Forget the
// secret in one environment and every mutating endpoint silently stops being
// protected, with nothing in the logs to say so.
//
// Here the secret is read through requireBinding, which throws when it is
// missing. Absent configuration produces a 500 on every write, which is
// noisy, obvious, and safe. Every other failure -- a missing token, a token
// Cloudflare rejects, a network error reaching the verify endpoint -- is a
// refusal. There is no branch in this file that returns without a decision.

import { requireBinding, type Env } from '@server/env';
import { ApiError, clientIp } from '@server/http';

const VERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

/**
 * Where to send the verification.
 *
 * Always Cloudflare in production, whatever else is configured: the check
 * below is on ENVIRONMENT, which wrangler.toml pins to "production" for the
 * deployed project, so setting the override there changes nothing.
 *
 * The override exists because verifying a token requires reaching
 * challenges.cloudflare.com, and a development sandbox often cannot. Pointing
 * it at a local stub is not a bypass: the secret is still required, the
 * request is still made, and success must still come back true. Only the
 * destination moves.
 */
function verifyUrl(env: Env): string {
  if (env.ENVIRONMENT === 'production') return VERIFY_URL;
  return env.TURNSTILE_VERIFY_URL ?? VERIFY_URL;
}

interface VerifyResponse {
  success?: boolean;
  'error-codes'?: string[];
}

export const challengeFailed = (detail: string) =>
  new ApiError(403, 'challenge_failed', detail);

/**
 * Verify a Turnstile token, or throw.
 *
 * Returns void: there is no boolean for a caller to ignore. The only way past
 * this function is for it to return normally.
 */
export async function verifyTurnstile(env: Env, request: Request, token: string): Promise<void> {
  // Throws if unset. This line is the whole design.
  const secret = requireBinding(env, 'TURNSTILE_SECRET');

  if (!token) throw challengeFailed('Complete the challenge and try again.');

  const body = new FormData();
  body.append('secret', secret);
  body.append('response', token);
  const ip = clientIp(request);
  if (ip) body.append('remoteip', ip);

  let outcome: VerifyResponse;
  try {
    const response = await fetch(verifyUrl(env), { method: 'POST', body });
    // A non-200 from the verifier tells us nothing about the token, so it
    // cannot be read as a pass.
    if (!response.ok) throw new Error(`verify endpoint returned ${response.status}`);
    outcome = (await response.json()) as VerifyResponse;
  } catch (error) {
    console.error('[turnstile] verification unavailable', error);
    throw challengeFailed('Could not verify the challenge. Try again.');
  }

  if (outcome.success !== true) {
    console.warn('[turnstile] rejected', outcome['error-codes']);
    throw challengeFailed('Challenge failed. Reload the page and try again.');
  }
}
