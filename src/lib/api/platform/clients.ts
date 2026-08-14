// The client list, from the platform's tenants.
//
// GET /api/agency/tenants returns raw D1 rows: snake_case, JSON columns still
// strings, and already filtered to what the caller may see. This turns them
// into the Client shape every view in this app is written against.
//
// Where the platform has no equivalent column the field is left empty rather
// than filled with something plausible. An invented industry or a made up
// contact reads on screen exactly like one the client gave us, and there is no
// way for anyone looking at it to tell the difference.

import { z } from 'zod';
import type { Client } from '@/types';
import type { ModuleId } from '@/types';
import { clientSchema } from '@/lib/api/contracts';
import { platformRequest } from '@/lib/api/platform/wire';

/**
 * A tenant row.
 *
 * Loose on purpose in the places the platform is loose: `status` and `plan`
 * are free text in its schema, and `schema_version` is not something this app
 * reads. Tightening them here would turn a column this app ignores into a
 * reason the client list fails to load.
 */
const tenantRowSchema = z.object({
  id: z.string(),
  slug: z.string(),
  name: z.string(),
  status: z.string(),
  plan: z.string().nullable(),
  timezone: z.string().nullable(),
  custom_hostname: z.string().nullable().optional(),
  ad_platforms_json: z.string().nullable().optional(),
  created_at: z.string(),
});

const tenantsResponseSchema = z.object({ tenants: z.array(tenantRowSchema) });

export type TenantRow = z.infer<typeof tenantRowSchema>;

/**
 * The platform's statuses, mapped onto this app's three.
 *
 * Anything unfamiliar becomes 'paused' rather than 'active'. This is the one
 * place a conservative default is right: a status this app does not recognise
 * is not one it can promise is healthy, and 'paused' shows the workspace
 * without claiming anything about it.
 */
function mapStatus(status: string): Client['status'] {
  if (status === 'active') return 'active';
  if (status === 'provisioning' || status === 'pending') return 'onboarding';
  return 'paused';
}

/** Title case for display, so "starter" reads as "Starter" beside our own plans. */
function titleCase(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

/**
 * A short code for the workspace.
 *
 * The platform has no code column, but it does have a slug, which is the
 * thing a person already recognises this client by in a URL. Deriving from the
 * slug keeps the code stable and meaningful rather than inventing initials.
 */
function codeFromSlug(slug: string): string {
  return slug.replace(/[^a-z0-9]/gi, '').slice(0, 8).toUpperCase() || slug.toUpperCase();
}

/**
 * Which modules a workspace shows.
 *
 * The platform records its section configuration in tenants.sections_json,
 * which GET /tenants does not select, so it cannot be read here. What is
 * available is ad_platforms_json, and it answers the question that actually
 * matters for these four clients: a client running Meta or Google has an
 * advertising dashboard, and a client running neither does not. All Star is
 * the second case by design, and its dashboard is door to door only.
 *
 * field_sales is enabled for everyone because the platform enables it for
 * everyone: migration 0006 seeds the field tables into every tenant database,
 * and the section only draws once a roster exists, so a client with no crew
 * sees nothing rather than an empty module.
 */
function modulesFor(row: TenantRow): ModuleId[] {
  const modules: ModuleId[] = ['field_sales'];
  const platforms = row.ad_platforms_json ? safeParseArray(row.ad_platforms_json) : [];
  if (platforms.length > 0) modules.unshift('advertising');
  return modules;
}

function safeParseArray(value: string): string[] {
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string') : [];
  } catch {
    return [];
  }
}

export function toClient(row: TenantRow): Client {
  // Parsed rather than constructed, so a mapping that drifts from the shape
  // the views expect fails here with the field named, not three components
  // deep at render time.
  return clientSchema.parse({
    id: row.id,
    code: codeFromSlug(row.slug),
    name: row.name,
    status: mapStatus(row.status),
    plan: row.plan ? titleCase(row.plan) : '',
    // The platform is the live system by definition. Nothing in it is demo
    // data, so there is no mode to choose.
    dataMode: 'live',
    enabledModules: modulesFor(row),
    // Integrations are configured in the platform's own settings, behind
    // routes this app does not call. An empty list is accurate: this app knows
    // of none, and listing one it cannot show the state of would be worse.
    integrations: [],
    createdAt: new Date(row.created_at).toISOString(),
    timezone: row.timezone ?? 'America/Los_Angeles',
    // industry, contactName, contactEmail, lastActive and logo all default.
    // The platform has no column for any of them.
  });
}

export async function fetchClients(signal?: AbortSignal): Promise<Client[]> {
  const response = await platformRequest(
    '/api/agency/tenants',
    tenantsResponseSchema,
    signal ? { signal } : {}
  );
  return response.tenants.map(toClient);
}

/** The ids alone, for resolving what a non-admin session may open. */
export async function listTenantIds(signal?: AbortSignal): Promise<string[]> {
  const response = await platformRequest(
    '/api/agency/tenants',
    tenantsResponseSchema,
    signal ? { signal } : {}
  );
  return response.tenants.map((t) => t.id);
}
