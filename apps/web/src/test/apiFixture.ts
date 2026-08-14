// A fake server, for tests that render the real providers.
//
// PlatformProvider fetches everything it holds, so a component test either
// mocks the provider or mocks the network. This mocks the network, which
// means the tests still exercise the real provider, the real seam, and the
// real Zod validation on the way in. A response that stopped matching its
// contract would fail these tests, which is exactly what §11.9 is for.

import { vi } from 'vitest';
import type { SessionResponse } from '@/lib/api/contracts';
import type { Client, PlatformUser } from '@/types';

const NOW = '2026-08-01T12:00:00.000Z';

export const testUser: PlatformUser = {
  id: 'usr_test',
  name: 'Alex Rivera',
  email: 'alex@example.invalid',
  role: 'super_admin',
  clientId: null,
  status: 'active',
};

function client(overrides: Partial<Client> & Pick<Client, 'id' | 'name'>): Client {
  return {
    code: overrides.id.slice(-3).toUpperCase(),
    industry: 'Testing',
    status: 'active',
    plan: 'Pro',
    dataMode: 'demo',
    enabledModules: [],
    integrations: [],
    createdAt: NOW,
    lastActive: NOW,
    contactEmail: 'ops@example.invalid',
    contactName: 'Ops',
    timezone: 'America/Los_Angeles',
    logo: null,
    ...overrides,
  };
}

export const testClients: Client[] = [
  client({
    id: 'cl_allstar',
    name: 'Allstar Home Solutions',
    enabledModules: ['field_sales', 'crm'],
  }),
  client({
    id: 'cl_roguesolar',
    name: 'Rogue Solar',
    plan: 'Enterprise',
    enabledModules: ['advertising', 'field_sales', 'crm', 'analytics'],
  }),
  client({ id: 'cl_bluecactus', name: 'Blue Cactus Power Washing', enabledModules: ['advertising'] }),
];

/**
 * Install a fetch stub covering every endpoint the providers call.
 *
 * Returns the mutable client list so a test can change entitlement and then
 * trigger a refetch, which is how the "disabled while being viewed" case is
 * exercised.
 */
let visitPostCount = 0;

/** How many knocks have been posted since the fixture was installed. */
export const visitPosts = () => visitPostCount;

export function installApiFixture(clients: Client[] = testClients) {
  const state = { clients: [...clients] };
  visitPostCount = 0;

  const session: SessionResponse = { user: testUser, clientIds: null };

  const ok = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    });

  vi.spyOn(globalThis, 'fetch').mockImplementation(
    (input: RequestInfo | URL, init?: RequestInit) => {
      const path =
        typeof input === 'string' ? input : input instanceof URL ? input.pathname : input.url;
      const method = init?.method ?? 'GET';

      if (path.startsWith('/api/auth/session')) return Promise.resolve(ok(session));
      if (path.startsWith('/api/team')) return Promise.resolve(ok({ users: [testUser] }));
      if (path.startsWith('/api/audit')) return Promise.resolve(ok({ entries: [] }));
      if (path.startsWith('/api/credentials')) return Promise.resolve(ok({ credentials: [] }));

      // Entitlement changes, so a test can disable a module and see the guard
      // react to the server's answer rather than to a local mutation.
      if (path.includes('/modules') && method === 'PATCH') {
        const clientId = path.split('/')[3] ?? '';
        // The client always sends a JSON string; anything else is a bug in
        // the caller, and reading it as an empty object would hide that.
        const raw = typeof init?.body === 'string' ? init.body : '{}';
        const body = JSON.parse(raw) as {
          moduleId: Client['enabledModules'][number];
          enabled: boolean;
        };
        state.clients = state.clients.map((c) =>
          c.id === clientId
            ? {
                ...c,
                enabledModules: body.enabled
                  ? [...new Set([...c.enabledModules, body.moduleId])]
                  : c.enabledModules.filter((m) => m !== body.moduleId),
              }
            : c
        );
        return Promise.resolve(ok({ clients: state.clients }));
      }

      if (path.includes('/field-sales/visits') && method === 'POST') {
        visitPostCount++;
        return Promise.resolve(
          ok({
            visit: {
              id: `vis_${visitPostCount}`,
              propertyId: 'prp_1',
              repId: 'rep_1',
              disposition: 'closed_sale',
              notes: null,
              vehiclePresent: null,
              occurredAt: NOW,
            },
            duplicate: false,
          })
        );
      }

      if (path.includes('/field-sales/data')) {
        // One door and one rep is enough for the write path. The read path
        // has its own coverage in the selector tests, against real volumes.
        return Promise.resolve(
          ok({
            properties: [
              {
                id: 'prp_1',
                address: '1200 E Broadway Rd',
                city: 'Mesa',
                state: 'AZ',
                postalCode: '85206',
                lat: 33.41,
                lng: -111.63,
                territoryId: 'ter_1',
                disposition: 'not_visited',
                ownerName: null,
                ownerPhone: null,
                notes: null,
              },
            ],
            visits: [],
            territories: [
              {
                id: 'ter_1',
                name: 'East Mesa',
                bounds: { north: 33.44, south: 33.36, east: -111.6, west: -111.66 },
                boundary: [
                  [-111.66, 33.36],
                  [-111.6, 33.36],
                  [-111.6, 33.44],
                  [-111.66, 33.44],
                ],
                repIds: ['rep_1'],
              },
            ],
            reps: [{ id: 'rep_1', name: 'Marcus Webb', territoryId: 'ter_1' }],
          })
        );
      }

      if (path.startsWith('/api/clients')) return Promise.resolve(ok({ clients: state.clients }));

      return Promise.resolve(
        ok({ error: { code: 'not_found', message: 'No such endpoint.' } }, 404)
      );
    }
  );

  return state;
}
