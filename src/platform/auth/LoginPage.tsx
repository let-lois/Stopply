// Sign in.
//
// The password lives in component state for exactly as long as it takes to
// submit it, and is cleared on the way out. It is never written to storage,
// never put in a URL, and never logged. The response carries no token: the
// server sets an HttpOnly cookie, which nothing in this application can read.

import { useCallback, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui';
import { Turnstile, turnstileConfigured, usingTestChallenge } from '@/platform/auth/Turnstile';
import { useSessionActions } from '@/lib/auth/SessionProvider';
import { ApiRequestError } from '@/lib/api/client';
import { routes } from '@/types/routes';

export default function LoginPage() {
  const { signIn } = useSessionActions();
  const navigate = useNavigate();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [token, setToken] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Stable identity, so the widget is not torn down and rebuilt on every
  // keystroke in the email field.
  const handleToken = useCallback((next: string | null) => setToken(next), []);

  const onSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await signIn(email, password, token ?? '');
      setPassword('');
      void navigate(routes.clients(), { replace: true });
    } catch (cause) {
      // The server's message, verbatim. It is written for the person reading
      // it and deliberately says the same thing for a wrong password as for
      // an account that does not exist.
      setError(
        cause instanceof ApiRequestError ? cause.message : 'Could not sign in. Try again.'
      );
      setPassword('');
      setSubmitting(false);
    }
  };

  const canSubmit = Boolean(email && password && token) && !submitting;

  return (
    <div className="grid min-h-dvh place-items-center bg-[var(--color-surface)] p-6">
      <div className="glass-panel w-full max-w-sm p-8">
        <div className="mb-6 flex items-center gap-3">
          <img src="/icon-192.png" alt="" width={36} height={36} className="size-9" />
          <div>
            <h1 className="text-lg font-semibold tracking-tight">Stopply</h1>
            <p className="micro-label">Operations platform</p>
          </div>
        </div>

        <form onSubmit={(e) => void onSubmit(e)} className="flex flex-col gap-4">
          <label className="flex flex-col gap-1.5">
            <span className="micro-label">Email</span>
            <input
              type="email"
              autoComplete="username"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="rounded-xl border border-[var(--color-hairline)] bg-black/20 px-3 py-2 text-sm outline-none focus-visible:border-[var(--color-accent-indigo)]"
            />
          </label>

          <label className="flex flex-col gap-1.5">
            <span className="micro-label">Password</span>
            <input
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="rounded-xl border border-[var(--color-hairline)] bg-black/20 px-3 py-2 text-sm outline-none focus-visible:border-[var(--color-accent-indigo)]"
            />
          </label>

          <Turnstile onToken={handleToken} />

          {error && (
            <p role="alert" className="text-sm text-[var(--color-accent-rose)]">
              {error}
            </p>
          )}

          <Button type="submit" variant="primary" disabled={!canSubmit}>
            {submitting ? 'Signing in' : 'Sign in'}
          </Button>

          {!turnstileConfigured && (
            <p className="text-xs text-[var(--color-ink-faint)]">
              Sign-in is unavailable until the challenge is configured.
            </p>
          )}

          {usingTestChallenge && (
            <p className="text-xs text-[var(--color-accent-amber)]">
              This deployment uses Cloudflare's test challenge keys, which accept any
              answer. Replace them with a real Turnstile keypair before anyone signs in
              with an account that matters.
            </p>
          )}
        </form>
      </div>
    </div>
  );
}
