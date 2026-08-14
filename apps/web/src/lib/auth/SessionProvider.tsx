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
import { backend } from '@/lib/api/backends';
import type { SessionResponse, SessionUser } from '@/lib/api/contracts';

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

    backend
      .fetchSession(controller.signal)
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
      const response = await backend.signIn(email, password, turnstileToken);
      apply(response);
      return response;
    },
    [apply]
  );

  const signOut = useCallback(async () => {
    // The backend swallows a network failure here on purpose: signing out must
    // not be blockable, and forgetting the user locally is right either way.
    await backend.signOut();
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
