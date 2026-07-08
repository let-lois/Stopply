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
      </form>
    </div>
  );
}
