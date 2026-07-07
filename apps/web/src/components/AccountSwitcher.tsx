'use client';

// The top left account control for agency users. It always tells you where
// you are — a specific sub-account, or the agency view — and lets you jump
// between them. This replaces the old amber "viewing as agency" banner: the
// context now lives in one obvious place instead of a stripe across the top.

import { useEffect, useRef, useState } from 'react';
import { api, setCsrf } from '@/lib/api';

interface TenantOption {
  id: string;
  slug: string;
  name: string;
  custom_hostname?: string | null;
}

export function AccountSwitcher({
  current,
  onSwitchTenant,
  onEnterAgencyView,
}: {
  // The sub-account currently in context, or null when in agency view.
  current: { id: string; name: string } | null;
  onSwitchTenant: (tenant: { id: string; slug: string; name: string }) => void;
  onEnterAgencyView: (() => void) | null;
}) {
  const [open, setOpen] = useState(false);
  const [tenants, setTenants] = useState<TenantOption[]>([]);
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open || tenants.length > 0) return;
    api<{ tenants: TenantOption[] }>('/api/agency/tenants')
      .then((r) => setTenants(r.tenants))
      .catch(() => undefined);
  }, [open, tenants.length]);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  const switchTo = async (t: TenantOption) => {
    if (t.id === current?.id) {
      setOpen(false);
      return;
    }
    setBusy(true);
    try {
      const res = await api<{ csrf: string; tenant: { id: string; slug: string; name: string } }>(
        '/api/auth/switch-tenant',
        { method: 'POST', json: { tenantId: t.id } }
      );
      setCsrf(res.csrf);
      setOpen(false);
      onSwitchTenant(res.tenant);
    } finally {
      setBusy(false);
    }
  };

  const filtered = query.trim()
    ? tenants.filter((t) => t.name.toLowerCase().includes(query.trim().toLowerCase()))
    : tenants;

  const label = current ? current.name : 'Agency view';
  const sub = current ? 'Sub-account' : 'All clients';
  const avatar = (current?.name ?? 'Agency').slice(0, 1).toUpperCase();

  return (
    <div className="acct-switcher" ref={ref}>
      <button
        type="button"
        className="acct-switcher-trigger"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <span className="acct-avatar">{avatar}</span>
        <span style={{ minWidth: 0 }}>
          <span className="acct-name" title={label}>
            {label}
          </span>
          <span className="acct-sub">{sub}</span>
        </span>
        <span aria-hidden="true" style={{ color: 'var(--ink-soft)', fontSize: 12 }}>
          ⌄
        </span>
      </button>

      {open && (
        <div className="acct-menu" role="menu">
          <input
            className="acct-search"
            placeholder="Search for a sub-account"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            autoFocus
          />

          {onEnterAgencyView && (
            <button
              type="button"
              className={`acct-agency-btn ${current === null ? 'current' : ''}`.trim()}
              onClick={() => {
                setOpen(false);
                onEnterAgencyView();
              }}
            >
              ↩ Switch to Agency View
            </button>
          )}

          <div className="acct-section">All accounts</div>
          {filtered.length === 0 && (
            <p className="muted" style={{ padding: '6px 10px', fontSize: 13 }}>
              {tenants.length === 0 ? 'Loading clients…' : 'No matches.'}
            </p>
          )}
          {filtered.map((t) => (
            <button
              key={t.id}
              type="button"
              className={`acct-row ${t.id === current?.id ? 'current' : ''}`.trim()}
              disabled={busy}
              onClick={() => switchTo(t)}
            >
              <span className="acct-avatar">{t.name.slice(0, 1).toUpperCase()}</span>
              <span style={{ minWidth: 0 }}>
                <span className="acct-row-name">{t.name}</span>
                <br />
                <span className="acct-row-sub">{t.custom_hostname ?? `${t.slug}.stopply.com`}</span>
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
