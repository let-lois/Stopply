'use client';

// Agency overview on bi.letlois.com: a grid of tenant cards from the
// agency_rollup snapshots with click through into each tenant's
// dashboard in agency context.

import { useEffect, useState } from 'react';
import { api, setCsrf } from '@/lib/api';
import { fmtMoney, fmtNum } from '@/lib/format';

interface TenantCard {
  id: string;
  slug: string;
  name: string;
  plan: string;
  leads: number | null;
  scheduled: number | null;
  completed: number | null;
  purchases: number | null;
  revenue: number | null;
  spend: number | null;
  pulled_at: string | null;
}

export function AgencyOverview({
  role,
  onEnterTenant,
}: {
  role: 'agency_admin' | 'agency_staff';
  onEnterTenant: (tenant: { id: string; slug: string; name: string }) => void;
}) {
  const [tenants, setTenants] = useState<TenantCard[]>([]);
  const [month, setMonth] = useState('');
  const [loading, setLoading] = useState(true);
  const [provisioning, setProvisioning] = useState(false);

  useEffect(() => {
    api<{ month: string; tenants: TenantCard[] }>('/api/agency/overview')
      .then((r) => {
        setMonth(r.month);
        setTenants(r.tenants);
      })
      .finally(() => setLoading(false));
  }, []);

  const enter = async (t: TenantCard) => {
    const res = await api<{ csrf: string; tenant: { id: string; slug: string; name: string } }>(
      '/api/auth/switch-tenant',
      { method: 'POST', json: { tenantId: t.id } }
    );
    setCsrf(res.csrf);
    onEnterTenant(res.tenant);
  };

  return (
    <div className="shell stack" style={{ gap: 20 }}>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <h1>Clients</h1>
        {role === 'agency_admin' && (
          <button className="primary" onClick={() => setProvisioning(true)}>
            New client
          </button>
        )}
      </div>
      <p className="muted">{month} snapshot</p>

      {loading && <div className="skeleton" style={{ minHeight: 120 }} />}

      <div className="kpi-grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))' }}>
        {tenants.map((t) => {
          const roas = t.spend && t.spend > 0 ? (t.revenue ?? 0) / t.spend : null;
          return (
            <button
              key={t.id}
              className="card stack"
              style={{ textAlign: 'left', cursor: 'pointer', gap: 8 }}
              onClick={() => enter(t)}
            >
              <div className="row" style={{ justifyContent: 'space-between' }}>
                <strong>{t.name}</strong>
                <span className="muted" style={{ fontSize: 12 }}>
                  {t.plan}
                </span>
              </div>
              <div className="row" style={{ gap: 18 }}>
                <span>
                  <span className="muted" style={{ fontSize: 11 }}>Leads</span>
                  <br />
                  <span className="num">{fmtNum(t.leads ?? 0)}</span>
                </span>
                <span>
                  <span className="muted" style={{ fontSize: 11 }}>Completed</span>
                  <br />
                  <span className="num">{fmtNum(t.completed ?? 0)}</span>
                </span>
                <span>
                  <span className="muted" style={{ fontSize: 11 }}>Revenue</span>
                  <br />
                  <span className="num">{fmtMoney(t.revenue ?? 0)}</span>
                </span>
                <span>
                  <span className="muted" style={{ fontSize: 11 }}>ROAS</span>
                  <br />
                  <span className="num">{roas ? roas.toFixed(1) + 'x' : '-'}</span>
                </span>
              </div>
              {!t.pulled_at && <span className="muted" style={{ fontSize: 12 }}>No rollup yet</span>}
            </button>
          );
        })}
      </div>

      {provisioning && <ProvisionForm onDone={() => setProvisioning(false)} />}
    </div>
  );
}

function ProvisionForm({ onDone }: { onDone: () => void }) {
  const [form, setForm] = useState({ slug: '', name: '', adminEmail: '', adminName: '', timezone: 'America/Phoenix', plan: 'starter' });
  const [result, setResult] = useState<{ tempPassword: string | null; slug: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await api<{ tempPassword: string | null; slug: string }>('/api/agency/tenants', {
        method: 'POST',
        json: form,
      });
      setResult(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'provisioning failed');
    } finally {
      setBusy(false);
    }
  };

  if (result) {
    return (
      <div className="card stack">
        <h3>Tenant provisioned</h3>
        <p>
          Dashboard: <code>{result.slug}.bi.letlois.com</code>
        </p>
        {result.tempPassword && (
          <p>
            Admin temp password (shown once): <code className="num">{result.tempPassword}</code>
          </p>
        )}
        <button className="primary" onClick={onDone}>
          Done
        </button>
      </div>
    );
  }

  return (
    <form className="card stack" onSubmit={submit}>
      <h3>New client</h3>
      <div className="row">
        <label style={{ flex: 1 }}>
          Name
          <input value={form.name} onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))} required />
        </label>
        <label style={{ flex: 1 }}>
          Slug
          <input
            value={form.slug}
            pattern="[a-z0-9-]+"
            onChange={(e) => setForm((p) => ({ ...p, slug: e.target.value }))}
            required
          />
        </label>
      </div>
      <div className="row">
        <label style={{ flex: 1 }}>
          Admin name
          <input value={form.adminName} onChange={(e) => setForm((p) => ({ ...p, adminName: e.target.value }))} required />
        </label>
        <label style={{ flex: 1 }}>
          Admin email
          <input
            type="email"
            value={form.adminEmail}
            onChange={(e) => setForm((p) => ({ ...p, adminEmail: e.target.value }))}
            required
          />
        </label>
      </div>
      <div className="row">
        <label>
          Timezone
          <input value={form.timezone} onChange={(e) => setForm((p) => ({ ...p, timezone: e.target.value }))} />
        </label>
        <label>
          Plan
          <select value={form.plan} onChange={(e) => setForm((p) => ({ ...p, plan: e.target.value }))} style={{ width: 'auto' }}>
            <option value="starter">starter</option>
            <option value="pro">pro</option>
            <option value="whitelabel">whitelabel</option>
          </select>
        </label>
      </div>
      {error && <p className="delta-down">{error}</p>}
      <div className="row">
        <button className="primary" disabled={busy} type="submit">
          {busy ? 'Provisioning' : 'Provision'}
        </button>
        <button type="button" onClick={onDone}>
          Cancel
        </button>
      </div>
    </form>
  );
}
