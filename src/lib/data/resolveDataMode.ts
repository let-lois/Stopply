import type { Client, DataMode, ModuleId } from '@/types';

// Which integration belongs to which module. An integration-level data mode
// overrides the client-level one, so a client can run advertising live while
// everything else stays on demo.
const MODULE_PROVIDERS: Record<ModuleId, readonly string[]> = {
  advertising: ['meta', 'google_ads'],
  field_sales: ['field_maps'],
  ecommerce: ['shopify', 'stripe'],
  logistics: ['carrier_api'],
  crm: [],
  analytics: [],
};

/**
 * Resolution order: the module's own integration, then the client, then demo.
 *
 * Pure and exported so it can be tested directly. The honest behaviour this
 * protects is that a client switched to live mode must visibly stop showing
 * demo data; the prototype's toggle wrote an audit entry saying the source
 * had changed and then rendered the same numbers behind a LIVE badge.
 */
export function resolveDataMode(client: Client | undefined, moduleId: ModuleId): DataMode {
  if (!client) return 'demo';

  const providers = MODULE_PROVIDERS[moduleId];
  const integration = client.integrations.find((i) => providers.includes(i.provider));
  if (integration) return integration.dataMode;

  return client.dataMode;
}
