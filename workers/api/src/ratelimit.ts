import type { Env } from './env';

// KV backed fixed window counters. KV is eventually consistent, so these
// limits are advisory rather than exact, which is acceptable for abuse
// throttling. Window key includes the window start so entries expire.

export interface RateLimitSpec {
  prefix: string;
  limit: number;
  windowSeconds: number;
}

export const LIMITS = {
  loginIp: { prefix: 'rl:login:ip', limit: 10, windowSeconds: 600 },
  loginEmail: { prefix: 'rl:login:email', limit: 10, windowSeconds: 600 },
  ingestVisitor: { prefix: 'rl:ingest:vid', limit: 120, windowSeconds: 60 },
  ingestTenant: { prefix: 'rl:ingest:tenant', limit: 6000, windowSeconds: 60 },
  chatUser: { prefix: 'rl:chat:user', limit: 20, windowSeconds: 60 },
  cfApi: { prefix: 'rl:cfapi:global', limit: 600, windowSeconds: 300 },
} as const satisfies Record<string, RateLimitSpec>;

export async function rateLimit(env: Env, spec: RateLimitSpec, key: string): Promise<boolean> {
  const windowStart = Math.floor(Date.now() / 1000 / spec.windowSeconds);
  const kvKey = `${spec.prefix}:${key}:${windowStart}`;
  const current = parseInt((await env.SESSIONS.get(kvKey)) ?? '0', 10);
  if (current >= spec.limit) return false;
  await env.SESSIONS.put(kvKey, String(current + 1), {
    expirationTtl: Math.max(60, spec.windowSeconds * 2),
  });
  return true;
}
