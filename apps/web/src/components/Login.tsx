'use client';

import { useState } from 'react';
import { api, ApiError, setCsrf } from '@/lib/api';
import { StopplyLogo } from './StopplyLogo';

export function Login({ onLoggedIn }: { onLoggedIn: () => void }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [redirectHost, setRedirectHost] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [showReset, setShowReset] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await api<{ csrf: string }>('/api/auth/login', {
        method: 'POST',
        json: { email, password },
      });
      setCsrf(res.csrf);
      onLoggedIn();
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message);
        const host = err.body.redirectHost as string | undefined;
        if (host) setRedirectHost(host);
      } else {
        setError('login failed');
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="shell" style={{ maxWidth: 420, paddingTop: '12vh' }}>
      <form className="card stack" onSubmit={submit}>
        <div style={{ marginBottom: 4 }}>
          <StopplyLogo height={36} />
        </div>
        <h1>Sign in</h1>
        <label>
          Email
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" required />
        </label>
        <label>
          Password
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            required
          />
        </label>
        {error && <p className="delta-down">{error}</p>}
        {redirectHost && (
          <p>
            Your dashboard lives at <a href={`https://${redirectHost}`}>{redirectHost}</a>.
          </p>
        )}
        <button className="primary cta" disabled={busy} type="submit">
          {busy ? 'Signing in' : 'Sign in'}
        </button>

        {/* Resets are administrator driven, not self service: no email
            provider is bound to the API Worker, so there is nothing that
            could deliver a reset link. This explains who to ask instead of
            leaving people at a dead end. Deliberately says nothing about
            whether the address typed above exists. */}
        <button
          type="button"
          className="linklike"
          aria-expanded={showReset}
          onClick={() => setShowReset((v) => !v)}
        >
          Forgot your password?
        </button>
        {showReset && (
          <div className="login-help stack" style={{ gap: 8 }}>
            <p style={{ margin: 0 }}>
              An administrator issues a new temporary password for you. Nothing is emailed
              automatically, so ask whoever manages your account:
            </p>
            <ul style={{ margin: 0, paddingLeft: 18 }}>
              <li>
                <strong>Client dashboard:</strong> your account admin, or your contact at the agency.
              </li>
              <li>
                <strong>Agency console:</strong> another agency admin.
              </li>
            </ul>
            <p style={{ margin: 0 }}>
              They can issue one from the Team screen. You will be able to sign in with it right
              away, and you can change it afterwards.
            </p>
          </div>
        )}
      </form>
    </div>
  );
}
