// Reading one client's data from a server that only remembers one client.
//
// This is the sharpest edge in the whole port, so it is worth being exact
// about why it exists.
//
// This app addresses a workspace by id: the id is in the URL, and two
// workspaces are two routes. The platform does not work that way. Its tenant
// scoped routes take the tenant from the hostname, and on the agency host
// there is no tenant in the hostname, so it takes it from a selection stored
// in the session. Its middleware says so directly: "Tenant identity comes only
// from the hostname or the agency session switcher, never from the client
// request." A request cannot name the client it wants.
//
// So reading Allstar's visits is two steps, not one: select Allstar, then
// read. And that turns a stateless read into a stateful one, with two ways to
// get the wrong answer:
//
//   1. Two reads in flight at once. Select Allstar, select Be Clinical, read,
//      read: both reads return Be Clinical, and one of them is drawn under
//      Allstar's heading. Solved below by a queue, so a read never starts
//      until the one before it has finished.
//
//   2. Two tabs. The session cookie is one cookie for the whole browser, so a
//      switch in one tab moves the other tab's server side selection too. A
//      queue cannot fix that, because the tabs do not share one. Solved below
//      by asking the server what it thinks is selected after the read, and
//      refusing to return data that came back under the wrong client.
//
// The second check costs one extra request per read. That is the price of not
// drawing one client's numbers under another client's name, which is the one
// error here that a person would act on without noticing it was wrong.

import { z } from 'zod';
import { platformRequest, setCsrfToken } from '@/lib/api/platform/wire';

const switchResponseSchema = z.object({
  ok: z.boolean(),
  csrf: z.string(),
  tenant: z.object({ id: z.string(), slug: z.string(), name: z.string() }),
});

const meSchema = z.object({
  userType: z.enum(['agency', 'tenant']),
  userId: z.string(),
  role: z.string(),
  tenantId: z.string().nullable(),
  csrf: z.string(),
});

export type PlatformMe = z.infer<typeof meSchema>;

export function fetchMe(signal?: AbortSignal): Promise<PlatformMe> {
  return platformRequest('/api/auth/me', meSchema, signal ? { signal } : {});
}

/**
 * Raised when the server's selection did not match the client we read for.
 *
 * Deliberately not retried silently and not swallowed. A retry loop would
 * fight the other tab and could spin; showing an error names the actual
 * situation, which the person can resolve by closing the other tab.
 */
export class TenantSelectionError extends Error {
  constructor(wanted: string, got: string | null) {
    super(
      `This workspace's data could not be loaded because the session is now on a different workspace ` +
        `(asked for ${wanted}, the server is on ${got ?? 'none'}). ` +
        'This happens when the platform is open in more than one tab. Close the others and reload.'
    );
    this.name = 'TenantSelectionError';
  }
}

/** What the server currently has selected, as far as this tab last saw. */
let selected: string | null = null;

/** The tail of the queue. Every read links onto it, so they run in order. */
let queue: Promise<unknown> = Promise.resolve();

export function resetTenantContext(): void {
  selected = null;
  queue = Promise.resolve();
}

async function selectTenant(tenantId: string): Promise<void> {
  const response = await platformRequest('/api/auth/switch-tenant', switchResponseSchema, {
    method: 'POST',
    body: { tenantId },
  });
  // The switch rotates the session token and mints a new CSRF. Storing it here
  // is not bookkeeping: the previous token stops being accepted at this
  // moment, so any later write that reused it would be a 403.
  setCsrfToken(response.csrf);
  selected = response.tenant.id;
}

/**
 * Run a read against one client, with the selection held still around it.
 *
 * `read` may make several requests. They all happen inside the critical
 * section, so a page that loads reps, addresses and visits together pays for
 * one selection and one verification rather than three of each.
 */
export function withTenant<T>(
  tenantId: string,
  read: (signal?: AbortSignal) => Promise<T>,
  signal?: AbortSignal
): Promise<T> {
  const run = queue.then(async () => {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');

    // Skipped when this tab already selected the same client and nothing has
    // moved since. The verification below is what makes that safe to skip:
    // if another tab did move it, the read is rejected rather than trusted.
    if (selected !== tenantId) await selectTenant(tenantId);

    const result = await read(signal);

    const me = await fetchMe(signal);
    setCsrfToken(me.csrf);
    selected = me.tenantId;
    if (me.tenantId !== tenantId) throw new TenantSelectionError(tenantId, me.tenantId);

    return result;
  });

  // The queue must advance whether or not this read succeeded, or one failure
  // would wedge every read after it. The caller still sees the rejection; this
  // only stops it propagating into the chain.
  queue = run.catch(() => undefined);
  return run;
}
