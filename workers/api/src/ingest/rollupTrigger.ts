// Rollup scheduling, debounced 60 seconds per tenant via a KV lock. The
// sync Worker cron drains pending flags every minute and runs the rollup
// engine; an inline best effort run also happens here for snappy updates
// after webhook bursts settle.

import type { Env } from '../env';

const DEBOUNCE_SECONDS = 60;

export async function scheduleRollup(env: Env, tenantId: string): Promise<void> {
  const lockKey = `rollup:lock:${tenantId}`;
  const existing = await env.SESSIONS.get(lockKey);
  if (existing) return; // already scheduled inside the debounce window
  await env.SESSIONS.put(lockKey, new Date().toISOString(), { expirationTtl: DEBOUNCE_SECONDS });
  await env.SESSIONS.put(`rollup:pending:${tenantId}`, new Date().toISOString(), {
    expirationTtl: 3600,
  });
}

export async function pendingRollups(env: Env): Promise<string[]> {
  const list = await env.SESSIONS.list({ prefix: 'rollup:pending:' });
  return list.keys.map((k) => k.name.slice('rollup:pending:'.length));
}

export async function clearPendingRollup(env: Env, tenantId: string): Promise<void> {
  await env.SESSIONS.delete(`rollup:pending:${tenantId}`);
}
