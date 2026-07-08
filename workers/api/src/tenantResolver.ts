import type { TenantRow } from '@letlois/db';
import type { Env } from './env';

// Hostname to tenant resolution, cached in memory per isolate with a 60s
// TTL. The tenant is always resolved server side from the request host or
// the session, never from anything the client sends in a body or header.

interface CacheEntry {
  tenant: TenantRow | null;
  expires: number;
}

const cache = new Map<string, CacheEntry>();
const TTL_MS = 60000;

export function clearResolverCache(): void {
  cache.clear();
}

export async function resolveTenantByHost(env: Env, hostname: string): Promise<TenantRow | null> {
  const host = hostname.toLowerCase().split(':')[0] ?? '';
  const cached = cache.get(host);
  if (cached && cached.expires > Date.now()) return cached.tenant;

  let tenant: TenantRow | null = null;
  const suffix = tenantHostSuffixes(env).find((s) => host.endsWith(s));
  if (suffix && !isAgencyHost(env, host)) {
    const slug = host.slice(0, -suffix.length);
    tenant = await getTenantBySlug(env, slug);
  } else {
    const row = await env.CONTROL_DB.prepare(
      `SELECT * FROM tenants WHERE custom_hostname = ? AND status = 'active'`
    )
      .bind(host)
      .first<TenantRow>();
    tenant = row ?? null;
  }
  cache.set(host, { tenant, expires: Date.now() + TTL_MS });
  return tenant;
}

export async function getTenantBySlug(env: Env, slug: string): Promise<TenantRow | null> {
  const row = await env.CONTROL_DB.prepare(`SELECT * FROM tenants WHERE slug = ? AND status = 'active'`)
    .bind(slug)
    .first<TenantRow>();
  return row ?? null;
}

export async function getTenantById(env: Env, id: string): Promise<TenantRow | null> {
  const row = await env.CONTROL_DB.prepare(`SELECT * FROM tenants WHERE id = ?`)
    .bind(id)
    .first<TenantRow>();
  return row ?? null;
}

export function isAgencyHost(env: Env, hostname: string): boolean {
  const host = hostname.toLowerCase().split(':')[0] ?? '';
  // localhost and 127.0.0.1 act as the agency host in development.
  if (host === 'localhost' || host === '127.0.0.1') return true;
  return agencyHosts(env).includes(host);
}

// Comma-separated so more than one host/suffix can resolve at once. Only
// bi.letlois.com is configured today (see CLAUDE.md on the abandoned
// stopply.com migration), but the parsing stays generic.
function agencyHosts(env: Env): string[] {
  return env.AGENCY_HOST.split(',')
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean);
}

function tenantHostSuffixes(env: Env): string[] {
  return env.TENANT_HOST_SUFFIX.split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}
