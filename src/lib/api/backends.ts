// The two servers, behind one interface.
//
// Separate from backend.ts so that file stays a declaration: what the two have
// to agree on, and which one this build chose. This one is the wiring.

import { z } from 'zod';
import { api, ApiRequestError } from '@/lib/api/client';
import { apiPaths } from '@/lib/api/paths';
import {
  auditResponseSchema,
  clientsResponseSchema,
  credentialsResponseSchema,
  sessionResponseSchema,
  teamResponseSchema,
} from '@/lib/api/contracts';
import { BACKEND, type Backend } from '@/lib/api/backend';
import { fetchClients } from '@/lib/api/platform/clients';
import {
  fetchSession as platformFetchSession,
  signIn as platformSignIn,
  signOut as platformSignOut,
} from '@/lib/api/platform/session';

const okSchema = z.object({ ok: z.boolean() });

const ownBackend: Backend = {
  fetchSession: (signal) => api.get(apiPaths.session(), sessionResponseSchema, signal),
  signIn: (email, password, turnstileToken) =>
    api.post(apiPaths.login(), { email, password, turnstileToken }, sessionResponseSchema),
  signOut: async () => {
    try {
      await api.post(apiPaths.logout(), {}, okSchema);
    } catch (error) {
      // Signing out must not be blockable. The server deletes the session row,
      // so a failure here is a network problem; forgetting the user locally is
      // still right, and the next request would 401 anyway.
      if (!(error instanceof ApiRequestError)) throw error;
    }
  },
  fetchConsole: async (signal) => {
    // Four independent reads, each already scoped by the server to the
    // session. Together rather than in sequence: four round trips in series is
    // the difference between a page that appears and one that assembles.
    const [clients, team, audit, credentials] = await Promise.all([
      api.get(apiPaths.clients(), clientsResponseSchema, signal),
      api.get(apiPaths.team(), teamResponseSchema, signal),
      api.get(apiPaths.audit(), auditResponseSchema, signal),
      api.get(apiPaths.credentials(), credentialsResponseSchema, signal),
    ]);
    return {
      clients: clients.clients,
      users: team.users,
      auditLog: audit.entries,
      credentialRefs: credentials.credentials,
    };
  },
  fetchAudit: async () => (await api.get(apiPaths.audit(), auditResponseSchema)).entries,
};

const platformBackend: Backend = {
  fetchSession: platformFetchSession,
  // The Turnstile token is dropped rather than forwarded. The platform's login
  // schema is strict, so an extra field turns a correct password into a 400
  // "invalid request". It runs its own rate limiting on the address and the
  // email, which is the protection that token was standing in for.
  signIn: (email, password) => platformSignIn(email, password),
  signOut: platformSignOut,
  fetchConsole: async (signal) => ({
    clients: await fetchClients(signal),
    // Empty, and empty is the honest answer rather than a placeholder.
    //
    // The platform has its own team, audit trail and stored credentials, but
    // behind routes this app does not call and shapes it has not mapped.
    // Showing a partial team list would be worse than showing none: somebody
    // would read a missing colleague as a revoked account. The views already
    // render the empty state, because it is the state a new workspace is in.
    users: [],
    auditLog: [],
    credentialRefs: [],
  }),
  // The platform keeps its own audit trail, on a route this app does not read.
  // Empty rather than a partial one: a trail missing entries reads as a record
  // that nothing happened, which is the opposite of what a trail is for.
  fetchAudit: () => Promise.resolve([]),
};

export const backend: Backend = BACKEND === 'platform' ? platformBackend : ownBackend;
