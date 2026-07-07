import { describe, it, expect } from 'vitest';
import { isAgencyHost, resolveTenantByHost, clearResolverCache } from '../src/tenantResolver';
import { FakeD1, makeEnv } from './helpers';
import type { Env } from '../src/env';

// Both AGENCY_HOST and TENANT_HOST_SUFFIX are comma-separated during the
// stopply.com migration (see wrangler.toml). These tests pin the dual-domain
// values directly rather than relying on the makeEnv() default so a future
// change to that default can't silently stop exercising the multi-value
// parsing path.
const DUAL_DOMAIN_ENV = {
  AGENCY_HOST: 'stopply.com,bi.letlois.com',
  TENANT_HOST_SUFFIX: '.stopply.com,.bi.letlois.com',
};

const TENANT_ROW = {
  id: 't_beclinical',
  slug: 'beclinical',
  name: 'Be Clinical',
  status: 'active',
  d1_database_id: 'db-1',
  custom_hostname: null,
};

function wireControlDb(db: FakeD1) {
  db.on(/FROM tenants WHERE slug = \?/, (params) => ({
    first: params[0] === 'beclinical' ? TENANT_ROW : null,
  }));
  db.on(/FROM tenants WHERE custom_hostname = \?/, (params) => ({
    first: params[0] === 'bi.clientname.com' ? { ...TENANT_ROW, custom_hostname: 'bi.clientname.com' } : null,
  }));
}

describe('isAgencyHost: dual-domain agency hosts', () => {
  it('recognizes stopply.com as the agency host', () => {
    const env = makeEnv(DUAL_DOMAIN_ENV);
    expect(isAgencyHost(env as unknown as Env, 'stopply.com')).toBe(true);
  });

  it('recognizes bi.letlois.com as the agency host', () => {
    const env = makeEnv(DUAL_DOMAIN_ENV);
    expect(isAgencyHost(env as unknown as Env, 'bi.letlois.com')).toBe(true);
  });

  it('is case insensitive and does not match unrelated or lookalike hosts', () => {
    const env = makeEnv(DUAL_DOMAIN_ENV);
    expect(isAgencyHost(env as unknown as Env, 'STOPPLY.COM')).toBe(true);
    expect(isAgencyHost(env as unknown as Env, 'evilstopply.com')).toBe(false);
    expect(isAgencyHost(env as unknown as Env, 'notarealhost.com')).toBe(false);
  });
});

describe('resolveTenantByHost: dual-domain tenant subdomains', () => {
  it('resolves a tenant subdomain on bi.letlois.com by slug', async () => {
    const env = makeEnv(DUAL_DOMAIN_ENV);
    wireControlDb(env.CONTROL_DB as FakeD1);
    clearResolverCache();
    const tenant = await resolveTenantByHost(env as unknown as Env, 'beclinical.bi.letlois.com');
    expect(tenant?.slug).toBe('beclinical');
  });

  it('resolves a tenant subdomain on stopply.com by slug', async () => {
    const env = makeEnv(DUAL_DOMAIN_ENV);
    wireControlDb(env.CONTROL_DB as FakeD1);
    clearResolverCache();
    const tenant = await resolveTenantByHost(env as unknown as Env, 'beclinical.stopply.com');
    expect(tenant?.slug).toBe('beclinical');
  });

  it('falls through to the custom_hostname lookup for a client custom domain, not swallowed by either suffix', async () => {
    const env = makeEnv(DUAL_DOMAIN_ENV);
    wireControlDb(env.CONTROL_DB as FakeD1);
    clearResolverCache();
    const tenant = await resolveTenantByHost(env as unknown as Env, 'bi.clientname.com');
    expect(tenant?.custom_hostname).toBe('bi.clientname.com');
  });

  it('resolves to null for an unknown tenant subdomain rather than a false positive', async () => {
    const env = makeEnv(DUAL_DOMAIN_ENV);
    wireControlDb(env.CONTROL_DB as FakeD1);
    clearResolverCache();
    const tenant = await resolveTenantByHost(env as unknown as Env, 'nosuchtenant.stopply.com');
    expect(tenant).toBeNull();
  });
});
