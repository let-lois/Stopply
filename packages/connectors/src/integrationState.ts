// What an integration's state is, in words an administrator can act on.
//
// The integrations table stores a coarse status (disconnected, connected,
// error) plus the last sync result and the last connection test. The state
// shown on screen is derived from those, never stored, so it cannot drift
// from what actually happened.

export type IntegrationState =
  | 'not_connected'
  | 'pending'
  | 'connected'
  | 'syncing'
  | 'synced'
  | 'no_campaigns'
  | 'permission_required'
  | 'auth_expired'
  | 'sync_failed'
  | 'disabled';

export const INTEGRATION_STATES: Record<IntegrationState, { label: string; hint: string }> = {
  not_connected: { label: 'Not connected', hint: 'No credentials are saved for this integration.' },
  pending: { label: 'Pending configuration', hint: 'Credentials are saved but not verified yet. Run Test, and pick an ad account if it asks for one.' },
  connected: { label: 'Connected', hint: 'The connection test passed. Figures arrive with the next sync.' },
  syncing: { label: 'Syncing', hint: 'A sync is running now.' },
  synced: { label: 'Successfully synced', hint: 'The last sync finished without errors.' },
  no_campaigns: { label: 'No campaigns found', hint: 'The last sync worked, but the ad account had no matching campaigns in that period.' },
  permission_required: {
    label: 'Permission required',
    hint: 'The credentials work but cannot read this account. Ask the platform’s account administrator for a read only role on it.',
  },
  auth_expired: {
    label: 'Authentication expired',
    hint: 'The platform refused the credentials. They may have been revoked or replaced. Re-enter them and Test.',
  },
  sync_failed: { label: 'Synchronization failed', hint: 'The last sync failed. Its message says why. The next scheduled sync will try again.' },
  disabled: { label: 'Reporting disabled', hint: 'Credentials are kept but nothing syncs. Enable it to resume.' },
};

export interface IntegrationStateInput {
  hasCredentials: boolean;
  status: string;
  // 0 or 1 from the table. Undefined on a database not migrated yet.
  enabled?: number | null;
  lastSyncAt: string | null;
  lastSyncResult: string | null;
  planCheck: string | null;
  running?: boolean;
}

function parse(json: string | null): Record<string, unknown> | null {
  if (!json) return null;
  try {
    const v = JSON.parse(json);
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function fromFailure(kind: unknown): IntegrationState {
  if (kind === 'auth') return 'auth_expired';
  if (kind === 'permission') return 'permission_required';
  if (kind === 'select_account' || kind === 'config') return 'pending';
  return 'sync_failed';
}

export function deriveIntegrationState(input: IntegrationStateInput): IntegrationState {
  if (!input.hasCredentials) return 'not_connected';
  if (input.enabled === 0) return 'disabled';
  if (input.running) return 'syncing';
  const result = parse(input.lastSyncResult);
  const plan = parse(input.planCheck);

  if (input.status === 'error') {
    // Whichever happened last decides: a failed test after an old failed
    // sync is about the test, and the other way round.
    const syncFailedAt = result && result.ok === false && typeof result.at === 'string' ? result.at : '';
    const testFailedAt = plan && typeof plan.checkedAt === 'string' && plan.failureKind ? plan.checkedAt : '';
    if (testFailedAt && testFailedAt >= syncFailedAt) return fromFailure(plan!.failureKind);
    if (result && result.ok === false) return fromFailure(result.failure);
    return 'sync_failed';
  }
  if (input.status === 'connected') {
    if (!input.lastSyncAt) return 'connected';
    const stats = result && typeof result.stats === 'object' && result.stats ? (result.stats as Record<string, unknown>) : null;
    if (result && result.ok === true && stats && stats.campaigns === 0) return 'no_campaigns';
    return 'synced';
  }
  return 'pending';
}

export function describeIntegrationState(input: IntegrationStateInput) {
  const state = deriveIntegrationState(input);
  return { state, ...INTEGRATION_STATES[state] };
}
