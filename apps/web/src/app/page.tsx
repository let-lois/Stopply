'use client';

// Entry point. Host awareness is server side; the client just asks who it
// is. Agency users on the agency host see the overview grid with the
// tenant switcher; tenant users land straight in their dashboard.

import { useCallback, useEffect, useState } from 'react';
import { api, fetchMe, setCsrf, type Me } from '@/lib/api';
import { Login } from '@/components/Login';
import { AppShell } from '@/components/AppShell';
import { AgencyShell } from '@/components/AgencyShell';
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
    return (
      <div className="shell stack">
        <div className="skeleton" style={{ minHeight: 50 }} />
        <div className="skeleton" style={{ minHeight: 240 }} />
      </div>
    );
  }

  if (!me) return <ToastProvider><Login onLoggedIn={refresh} /></ToastProvider>;

  const isAgencyUser = me.userType === 'agency';
  // Agency users drive tenant context through the switcher; tenant users
  // are always in their own context.
  const inTenantContext = !isAgencyUser || agencyTenant !== null;

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
          agencyContext={isAgencyUser ? { name: me.userId } : null}
          onExitTenant={isAgencyUser ? () => setAgencyTenant(null) : null}
          onLogout={logout}
        />
      )}
    </ToastProvider>
  );
}
