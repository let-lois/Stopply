// Rep sign-in.
//
// Thirty-day sessions mean a rep sees this roughly once a month, which is
// exactly why it has to work first time in bad conditions: large fields,
// correct keyboards, and autocomplete attributes so a password manager fills
// it rather than the rep typing on a phone in the cold.

import { useCallback, useState } from 'react';
import { useFieldActions } from '@/lib/field/FieldSessionProvider';
import { Turnstile, turnstileConfigured } from '@/platform/auth/Turnstile';
import { ApiRequestError } from '@/lib/api/client';

export default function FieldLogin() {
  const { signIn } = useFieldActions();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [token, setToken] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const handleToken = useCallback((next: string | null) => setToken(next), []);

  const onSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await signIn(email, password, token ?? '');
      setPassword('');
    } catch (cause) {
      setError(cause instanceof ApiRequestError ? cause.message : 'Could not sign in. Try again.');
      setPassword('');
      setSubmitting(false);
    }
  };

  const field =
    'min-h-14 w-full rounded-2xl border-2 border-[var(--color-hairline)] bg-well px-4 text-base ' +
    'text-[var(--color-ink)] outline-none focus-visible:border-[var(--color-accent-indigo)]';

  return (
    <div className="flex min-h-dvh flex-col justify-center px-5 py-10">
      <div className="mx-auto w-full max-w-md">
        <div className="mb-8 flex items-center gap-3">
          <img src="/icon-192.png" alt="" width={44} height={44} className="size-11" />
          <div>
            <h1 className="text-xl font-semibold tracking-tight">Stopply Field</h1>
            <p className="text-sm text-[var(--color-ink-soft)]">Log your doors</p>
          </div>
        </div>

        <form onSubmit={(e) => void onSubmit(e)} className="flex flex-col gap-5">
          <label className="flex flex-col gap-2">
            <span className="text-sm font-medium">Email</span>
            <input
              type="email"
              // inputMode and autocomplete together are what stop a phone
              // autocapitalising an address and a rep fighting the keyboard.
              inputMode="email"
              autoComplete="username"
              autoCapitalize="none"
              autoCorrect="off"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className={field}
            />
          </label>

          <label className="flex flex-col gap-2">
            <span className="text-sm font-medium">Password</span>
            <input
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className={field}
            />
          </label>

          <Turnstile onToken={handleToken} />

          {error && (
            <p role="alert" className="text-sm font-medium text-[var(--color-negative)]">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={!email || !password || !token || submitting}
            className="min-h-14 rounded-2xl bg-[var(--color-primary)] text-base font-semibold text-[var(--color-on-accent)] disabled:opacity-50"
          >
            {submitting ? 'Signing in…' : 'Sign in'}
          </button>

          {!turnstileConfigured && (
            <p className="text-sm text-[var(--color-ink-faint)]">
              Sign-in is unavailable until the challenge is configured.
            </p>
          )}

          <p className="text-sm text-[var(--color-ink-faint)]">
            You stay signed in for a month, so you should not see this often.
          </p>
        </form>
      </div>
    </div>
  );
}
