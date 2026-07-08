'use client';

// Entry point. Host awareness is server side; the client just asks who it
// is. Agency users on the agency host see the overview grid with the
// tenant switcher; tenant users land straight in their dashboard.

import { useCallback, useEffect, useState } from 'react';
import { api, fetchMe, setCsrf, type Me } from '@/lib/api';
import { isDemoMode } from '@/lib/demoMode';
import { Login } from '@/components/Login';
import { AppShell } from '@/components/AppShell';
import { AgencyShell } from '@/components/AgencyShell';
import { DemoBadge } from '@/components/DemoBadge';
import { ToastProvider } from '@/components/Toasts';

export default function Page() {
  const [me, setMe] = useState<Me | null | 'loading'>('loading');
  const [agencyTenant, setAgencyTenant] = useState<{ id: string; slug: string; name: string } | null>(null);

  const refresh = useCallback(() => {
    fetchMe().then(setMe);
  }, []);

  useEffect(refresh, [refresh]);

  const logout = async () => {
    await api('/api/auth/logout', { method: 'POST', json: {} }).catch(() => undefined);
    setCsrf(null);
    setAgencyTenant(null);
    setMe(null);
  };

  if (me === 'loading') {
    // Static export prerenders this branch server side, where window is
    // undefined, so isDemoMode() must not be read here: doing so would
    // disagree with the client's hydration pass and throw a hydration
    // mismatch. Every other branch below only ever renders after the
    // fetchMe() effect resolves, client side only, so isDemoMode() is
    // safe to read there.
    return (
      <div className="shell stack">
        <div className="skeleton" style={{ minHeight: 50 }} />
        <div className="skeleton" style={{ minHeight: 240 }} />
      </div>
    );
  }

  if (!me) {
    return (
      <ToastProvider>
        <Login onLoggedIn={refresh} />
        {isDemoMode() && <DemoBadge />}
      </ToastProvider>
    );
  }

  const isAgencyUser = me.userType === 'agency';
  // Agency users drive tenant context through the Clients tab; tenant users
  // are always in their own context. Demo mode always goes straight to
  // AppShell (its own Clients tab included), never AgencyShell, that's the
  // unified nav direction; this is scoped to demo for now, real agency
  // routing below is unchanged pending a decision on rolling it out fully.
  const inTenantContext = !isAgencyUser || agencyTenant !== null || isDemoMode();

  return (
    <ToastProvider>
      {isAgencyUser && !inTenantContext && (
        <AgencyShell
          role={me.role as 'agency_admin' | 'agency_staff'}
          userId={me.userId}
          onEnterTenant={(t) => setAgencyTenant(t)}
          onLogout={logout}
        />
      )}
      {inTenantContext && (
        <AppShell
          // Remount when the active sub-account changes so all tenant scoped
          // data reloads cleanly under the new context.
          key={agencyTenant?.id ?? 'self'}
          isAgencyUser={isAgencyUser}
          agencyRole={isAgencyUser ? (me.role as 'agency_admin' | 'agency_staff') : undefined}
          onSwitchTenant={isAgencyUser ? (t) => setAgencyTenant(t) : null}
          onLogout={logout}
          initialTab={isAgencyUser && !agencyTenant ? 'clients' : undefined}
        />
      )}
      {/* AppShell renders its own inline demo badge in the sidebar, since a
          fixed corner badge here would overlap in-page controls (e.g. the
          Clients tab's "New client" button). AgencyShell has no demo badge
          of its own, but demo mode never renders AgencyShell (see
          inTenantContext above), so there is nothing to cover here. */}
    </ToastProvider>
  );
}
