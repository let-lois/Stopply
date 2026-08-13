import type { ModuleId } from '@/types';
import type { ModuleDataMap } from '@/lib/data/moduleDataMap';
import { LiveModeNotAvailableError } from '@/lib/data/errors';
import { fetchFieldSalesLive } from '@/lib/data/live/fieldSales';

/**
 * Live adapters, dispatched by module.
 *
 * field_sales is connected: the platform stores doors, knocks, territories
 * and reps itself, so there is a real source to read.
 *
 * The other five are not, and this rejects for them rather than quietly
 * serving demo numbers under a live badge. Their data would come from Meta,
 * Google Ads, Shopify, Stripe and a carrier API, and none of those
 * integrations exists yet. "Live data is not connected" is the honest answer
 * and the one §10 requires: no interface copy may describe a capability that
 * is not there.
 *
 * Each becomes a case here when its integration is built, and no view changes
 * on that day. That is the whole return on routing every module through one
 * seam.
 */
export function fetchLiveData<M extends ModuleId>(
  moduleId: M,
  clientId: string,
  signal?: AbortSignal
): Promise<ModuleDataMap[M]> {
  if (moduleId === 'field_sales') {
    // Narrowing a generic to one member is past what the compiler tracks
    // through this signature, so the assertion is contained here rather than
    // pushed onto the seam or onto every view.
    return fetchFieldSalesLive(clientId, signal) as Promise<ModuleDataMap[M]>;
  }
  return Promise.reject(new LiveModeNotAvailableError(moduleId));
}
