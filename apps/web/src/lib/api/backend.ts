// Which server this build talks to.
//
// There are two, and they are not variants of one thing. `own` is this app's
// Pages Functions and its own D1: everything works because both halves were
// written together. `platform` is the BI platform's Hono Worker at
// bi.letlois.com, which four clients already depend on and which this app has
// to meet on its own terms.
//
// The choice is made once, here, at build time. Deciding per call site would
// mean every future view has to remember which server it is talking to, and
// the one that forgets is the one that breaks on the host where the Worker
// intercepts /api.
//
// Why it has to be a choice at all: on bi.letlois.com a Worker route owns
// /api/*, and Worker routes take precedence over Pages Functions. This app's
// own API is unreachable there no matter what is deployed alongside it, so a
// build for that host must speak the Worker's protocol or it cannot sign
// anybody in.

import type { SessionResponse } from '@/lib/api/contracts';
import type { AuditLogEntry, Client, CredentialRef, PlatformUser } from '@/types';

export type BackendName = 'own' | 'platform';

/**
 * Defaults to this app's own server.
 *
 * The default is the safe one: a build with nothing configured talks to the
 * API that ships with it. `platform` is opted into by .env.production, which
 * is what the bi.letlois.com deployment builds with.
 */
export const BACKEND: BackendName =
  import.meta.env.VITE_BACKEND === 'platform' ? 'platform' : 'own';

/** Everything above this app's data layer that differs between the two. */
export interface Backend {
  fetchSession: (signal?: AbortSignal) => Promise<SessionResponse>;
  signIn: (email: string, password: string, turnstileToken: string) => Promise<SessionResponse>;
  signOut: () => Promise<void>;
  /** The agency console's four reads: workspaces, team, audit trail, credentials. */
  fetchConsole: (signal?: AbortSignal) => Promise<{
    clients: Client[];
    users: PlatformUser[];
    auditLog: AuditLogEntry[];
    credentialRefs: CredentialRef[];
  }>;
  /**
   * Re-read the audit trail after a write.
   *
   * Separate from fetchConsole because it is called on its own after every
   * mutation, and re-reading the workspaces and the team each time would be
   * three requests to refresh one list.
   */
  fetchAudit: () => Promise<AuditLogEntry[]>;
}
