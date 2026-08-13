import type { ModuleId } from '@/types';
import type { ModuleDataMap } from '@/lib/data/moduleDataMap';
import { LiveModeNotAvailableError } from '@/lib/data/errors';

/**
 * Live adapters. Phase 1 has none, and says so rather than pretending.
 *
 * Phase 2 replaces this with real fetches. field_sales binds to the D1 field
 * schema already running in production (field_reps, field_addresses,
 * field_visits, field_dispositions) rather than defining a second home for
 * the same knocks; see ARCHITECTURE.md. The other five are new work.
 *
 * Views need no change when that happens. That is the whole return on
 * routing every module through one seam.
 */
export function fetchLiveData<M extends ModuleId>(
  moduleId: M,
  _clientId: string
): Promise<ModuleDataMap[M]> {
  return Promise.reject(new LiveModeNotAvailableError(moduleId));
}
