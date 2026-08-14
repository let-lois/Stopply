// The real session, replacing the demo identity switcher.
//
// Phase 1's DemoIdentitySwitcher was a presentation device and said so in its
// own file header: it changed a name in the corner and nothing else, because
// there was no server to have an opinion. There is now.
//
// Nothing here holds a token. The session cookie is HttpOnly, so this code
// cannot read it even if it wanted to, and there is no branch that would. The
// only way to learn who you are is to ask the server, which is what boot does.

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { api, ApiRequestError } from '@/lib/api/client';
import { apiPaths } from '@/lib/api/paths';
import { sessionResponseSchema, type SessionResponse, type SessionUser } from '@/lib/api/contracts';
import { z } from 'zod';

const okSchema = z.object({ ok: z.boolean() });

export type SessionStatus = 'checking' | 'signed-in' | 'signed-out';

export interface SessionState {
  status: SessionStatus;
  user: SessionUser | null;
  /** Null means every client. Only a super admin gets that. */
  clientIds: string[] | null;
}

export interface SessionActions {
  /**
   * Sign in, and hand back the session that resulted.
   *
   * Returning it rather than only storing it is what lets the login page send
   * a client-scoped user to their own workspace. Reading it from context on
   * the next render instead would mean redirecting to the client list first
   * and bouncing off it.
   */
  signIn: (
    email: string,
    password: string,
    turnstileToken: string
  ) => Promise<SessionResponse>;
  signOut: () => Promise<void>;
}

const StateContext = createContext<SessionState | undefined>(undefined);
const ActionsContext = createContext<SessionActions | undefined>(undefined);

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<SessionState>({
    status: 'checking',
    user: null,
    clientIds: null,
  });

  const apply = useCallback((response: SessionResponse) => {
    setState({ status: 'signed-in', user: response.user, clientIds: response.clientIds });
  }, []);

  // One question at boot: who am I. A 401 is the expected answer for a
  // visitor, not an error to surface.
  useEffect(() => {
    const controller = new AbortController();

    api
      .get(apiPaths.session(), sessionResponseSchema, controller.signal)
      .then((response) => {
        if (!controller.signal.aborted) apply(response);
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setState({ status: 'signed-out', user: null, clientIds: null });
        }
      });

    return () => controller.abort();
  }, [apply]);

  const signIn = useCallback<SessionActions['signIn']>(
    async (email, password, turnstileToken) => {
      const response = await api.post(
        apiPaths.login(),
        { email, password, turnstileToken },
        sessionResponseSchema
      );
      apply(response);
      return response;
    },
    [apply]
  );

  const signOut = useCallback(async () => {
    try {
      await api.post(apiPaths.logout(), {}, okSchema);
    } catch (error) {
      // Signing out must not be blockable. The server deletes the session row,
      // so a failure here is a network problem; forgetting the user locally is
      // still the right response, and the next request will 401 anyway.
      if (!(error instanceof ApiRequestError)) throw error;
    }
    setState({ status: 'signed-out', user: null, clientIds: null });
  }, []);

  const actions = useMemo<SessionActions>(() => ({ signIn, signOut }), [signIn, signOut]);

  return (
    <StateContext.Provider value={state}>
      <ActionsContext.Provider value={actions}>{children}</ActionsContext.Provider>
    </StateContext.Provider>
  );
}

export function useSession(): SessionState {
  const value = useContext(StateContext);
  if (!value) throw new Error('useSession must be used inside SessionProvider');
  return value;
}

export function useSessionActions(): SessionActions {
  const value = useContext(ActionsContext);
  if (!value) throw new Error('useSessionActions must be used inside SessionProvider');
  return value;
}
