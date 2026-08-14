'use client';

// The field app shell: sign in, the three screens a rep moves between, and
// the sync indicator that tells them whether their day has reached the
// office yet.

import { useCallback, useEffect, useState } from 'react';
import {
  FieldApiError,
  fieldApi,
  restoreFieldSessionToken,
  setFieldCsrf,
  setFieldSessionToken,
} from './api';
import {
  discardRejected,
  flush,
  getOutbox,
  restoreOutboxBackup,
  startAutoFlush,
  subscribeOutbox,
} from './outbox';
import { fieldPlatform } from './platform';
import type { FieldBootstrap, OutboxEntry, SavedVisit, FieldStats } from './types';
import { KnockForm } from './KnockForm';
import { TodayPanel } from './TodayPanel';
import { MePanel } from './MePanel';

type Screen = 'knock' | 'today' | 'me';

export function FieldApp() {
  const [boot, setBoot] = useState<FieldBootstrap | null | 'loading'>('loading');
  const [screen, setScreen] = useState<Screen>('knock');
  const [outbox, setOutbox] = useState<OutboxEntry[]>([]);
  const [online, setOnline] = useState(true);
  const [toast, setToast] = useState<string | null>(null);
  const [visits, setVisits] = useState<SavedVisit[] | null>(null);
  const [stats, setStats] = useState<FieldStats | null>(null);

  const loadMe = useCallback(async () => {
    try {
      const me = await fieldApi<FieldBootstrap>('/api/field/me');
      setFieldCsrf(me.csrf);
      setBoot(me);
    } catch (err) {
      // A network failure is not a sign out. A rep who opens the app in a
      // dead zone keeps their session and their queue; only an actual 401
      // sends them back to the sign in screen.
      if (err instanceof FieldApiError && err.status === 401) {
        // The session is genuinely gone, so drop the stored token too.
        // Keeping it would mean every cold start retries a dead credential.
        setFieldSessionToken(null);
        setBoot(null);
      } else setBoot((prev) => (prev === 'loading' ? null : prev));
    }
  }, []);

  // A cold start on a platform that carries its own session: the stored
  // token has to be back in place before anything asks the API who this is,
  // or an already signed in rep is shown the sign in screen.
  useEffect(() => {
    void restoreFieldSessionToken().then(() => loadMe());
  }, [loadMe]);

  useEffect(() => {
    setOutbox(getOutbox());
    const unsubscribe = subscribeOutbox(setOutbox);
    // Before the first flush, so a queue recovered from the platform's
    // backup goes out rather than sitting there unnoticed.
    void restoreOutboxBackup().then((restored) => {
      if (restored > 0) setOutbox(getOutbox());
    });
    return unsubscribe;
  }, []);

  useEffect(() => {
    if (boot === 'loading' || boot === null) return;
    return startAutoFlush((result) => {
      setOnline(!result.offline);
      if (result.sent > 0) {
        void refreshData();
      }
    });
    // refreshData is stable enough for this: it only reads boot's presence.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [boot]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const update = () => setOnline(window.navigator.onLine);
    update();
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    return () => {
      window.removeEventListener('online', update);
      window.removeEventListener('offline', update);
    };
  }, []);

  const refreshData = useCallback(async () => {
    const [v, s] = await Promise.allSettled([
      fieldApi<{ visits: SavedVisit[] }>('/api/field/visits?limit=100'),
      fieldApi<FieldStats>('/api/field/stats'),
    ]);
    if (v.status === 'fulfilled') setVisits(v.value.visits);
    if (s.status === 'fulfilled') setStats(s.value);
  }, []);

  useEffect(() => {
    if (boot === 'loading' || boot === null) return;
    void refreshData();
  }, [boot, refreshData]);

  const showToast = useCallback((message: string) => {
    setToast(message);
    window.setTimeout(() => setToast((current) => (current === message ? null : current)), 2200);
  }, []);

  const logout = async () => {
    await fieldApi('/api/field/logout', { method: 'POST', json: {} }).catch(() => undefined);
    setFieldCsrf(null);
    // Cleared locally even if the call above never reached the server, so a
    // rep handing their phone back is signed out on this device either way.
    setFieldSessionToken(null);
    setBoot(null);
  };

  if (boot === 'loading') {
    return (
      <div className="field-app field-centered">
        <div className="field-spinner" aria-label="Loading" />
      </div>
    );
  }

  if (!boot) return <FieldLogin onSignedIn={loadMe} />;

  const pending = outbox.filter((e) => !e.rejected).length;
  const rejected = outbox.filter((e) => e.rejected);

  return (
    <div className="field-app">
      <header className="field-header">
        <div>
          <p className="field-client">{boot.tenant.name}</p>
          <p className="field-rep">{boot.rep.name}</p>
        </div>
        <SyncPill
          online={online}
          pending={pending}
          onTap={() => {
            void flush().then((r) => {
              setOnline(!r.offline);
              if (r.sent > 0) {
                showToast(`${r.sent} sent`);
                void refreshData();
              } else if (r.offline) {
                showToast('Still no connection, your knocks are saved');
              }
            });
          }}
        />
      </header>

      {rejected.length > 0 && (
        <div className="field-banner">
          <span>
            {rejected.length} {rejected.length === 1 ? 'knock' : 'knocks'} could not be saved:{' '}
            {rejected[0]?.lastError}
          </span>
          <button type="button" onClick={() => discardRejected()}>
            Dismiss
          </button>
        </div>
      )}

      <main className="field-main">
        {screen === 'knock' && <KnockForm dispositions={boot.dispositions} onLogged={showToast} />}
        {screen === 'today' && (
          <TodayPanel
            visits={visits}
            queued={outbox}
            dispositions={boot.dispositions}
            timezone={boot.tenant.timezone}
            onChanged={refreshData}
          />
        )}
        {screen === 'me' && <MePanel rep={boot.rep} stats={stats} onLogout={logout} />}
      </main>

      <nav className="field-tabs">
        <button className={screen === 'knock' ? 'active' : ''} onClick={() => setScreen('knock')}>
          Knock
        </button>
        <button className={screen === 'today' ? 'active' : ''} onClick={() => setScreen('today')}>
          Today
          {pending > 0 && <span className="field-tab-badge">{pending}</span>}
        </button>
        <button className={screen === 'me' ? 'active' : ''} onClick={() => setScreen('me')}>
          Me
        </button>
      </nav>

      {toast && <div className="field-toast">{toast}</div>}
    </div>
  );
}

// The one piece of status a rep actually needs: is my work saved, and has
// it reached the office. Deliberately never alarming, because working
// offline is normal here and not a failure.
function SyncPill({
  online,
  pending,
  onTap,
}: {
  online: boolean;
  pending: number;
  onTap: () => void;
}) {
  const state = pending > 0 ? (online ? 'syncing' : 'queued') : online ? 'synced' : 'offline';
  const label =
    state === 'syncing'
      ? `Sending ${pending}`
      : state === 'queued'
        ? `${pending} saved on phone`
        : state === 'synced'
          ? 'All synced'
          : 'Offline';
  return (
    <button type="button" className={`field-sync field-sync-${state}`} onClick={onTap}>
      <span className="field-sync-dot" />
      {label}
    </button>
  );
}

function FieldLogin({ onSignedIn }: { onSignedIn: () => void }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fieldApi<{ csrf: string; token?: string }>('/api/field/login', {
        method: 'POST',
        json: { email, password },
      });
      setFieldCsrf(res.csrf);
      // Returned only to the installed app, which has no cookie to carry the
      // session for it. On the web this is absent and the cookie does the
      // work, as it always has.
      if (res.token) setFieldSessionToken(res.token);
      onSignedIn();
    } catch (err) {
      setError(
        err instanceof FieldApiError
          ? err.message
          : 'No connection. You need signal once to sign in, then the app works offline.'
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="field-app field-centered">
      <form className="field-login" onSubmit={submit}>
        <h1>Field log</h1>
        <p className="field-login-sub">Sign in with the account your manager set up.</p>
        <label className="knock-field">
          Email
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="username"
            inputMode="email"
            required
          />
        </label>
        <label className="knock-field">
          Password
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            required
          />
        </label>
        {error && <p className="field-error">{error}</p>}
        <button className="knock-submit" type="submit" disabled={busy}>
          {busy ? 'Signing in' : 'Sign in'}
        </button>
      </form>
    </div>
  );
}
