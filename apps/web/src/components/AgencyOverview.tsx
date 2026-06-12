'use client';

// Agency console sections rendered inside AgencyShell:
//   - ClientsSection: the tenant grid from agency_rollup snapshots with
//     click through into each tenant's dashboard in agency context.
//   - TeamSection: agency user management (invite, role, tenant
//     assignment, deactivate), agency_admin only.
//   - AuditSection: the cross tenant audit log with filters.

import { useEffect, useState } from 'react';
import { api, setCsrf } from '@/lib/api';
import { fmtMoney, fmtNum } from '@/lib/format';
import { CodeBox } from './CodeBox';

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

export function ClientsSection({
  role,
  onEnterTenant,
}: {
  role: 'agency_admin' | 'agency_staff';
  onEnterTenant: (tenant: { id: string; slug: string; name: string }) => void;
}) {
  const [tenants, setTenants] = useState<TenantCard[]>([]);
  const [loading, setLoading] = useState(true);
  const [provisioning, setProvisioning] = useState(false);

  useEffect(() => {
    api<{ month: string; tenants: TenantCard[] }>('/api/agency/overview')
      .then((r) => setTenants(r.tenants))
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
    <div className="stack" style={{ gap: 20 }}>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <h1>Clients</h1>
        {role === 'agency_admin' && (
          <button className="primary" onClick={() => setProvisioning(true)}>
            New client
          </button>
        )}
      </div>

      {loading && <div className="skeleton" style={{ minHeight: 120 }} />}

      {!loading && tenants.length === 0 && (
        <div className="card stack">
          <h3>No clients yet</h3>
          <p className="muted">
            {role === 'agency_admin'
              ? 'Provision your first client with New client to get started.'
              : 'No clients have been assigned to you yet.'}
          </p>
        </div>
      )}

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

interface AgencyUser {
  id: string;
  email: string;
  name: string;
  role: 'agency_admin' | 'agency_staff';
  assigned_tenants_json: string | null;
  permissions_json: string | null;
  active: number;
  created_at: string;
}

function parsePermissions(json: string | null): { manageSecrets: boolean } {
  if (!json) return { manageSecrets: false };
  try {
    const v = JSON.parse(json) as Record<string, boolean>;
    return { manageSecrets: v.manageSecrets === true };
  } catch {
    return { manageSecrets: false };
  }
}

// Agency team management: list members, invite a new one (temp password
// shown once), assign tenants to staff, and deactivate. agency_admin only.
export function TeamSection({ currentUserId }: { currentUserId: string }) {
  const [users, setUsers] = useState<AgencyUser[]>([]);
  const [tenants, setTenants] = useState<Array<{ id: string; name: string }>>([]);
  const [loading, setLoading] = useState(true);
  const [inviting, setInviting] = useState(false);

  const load = () => {
    setLoading(true);
    api<{ users: AgencyUser[] }>('/api/agency/users')
      .then((r) => setUsers(r.users))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
    api<{ tenants: Array<{ id: string; name: string }> }>('/api/agency/tenants')
      .then((r) => setTenants(r.tenants))
      .catch(() => undefined);
  }, []);

  const deactivate = async (u: AgencyUser) => {
    if (!confirm(`Deactivate ${u.name}? They will no longer be able to sign in.`)) return;
    await api(`/api/agency/users/${u.id}`, { method: 'DELETE', json: {} });
    load();
  };

  const toggleSecrets = async (u: AgencyUser) => {
    const next = !parsePermissions(u.permissions_json).manageSecrets;
    await api(`/api/agency/users/${u.id}`, {
      method: 'PATCH',
      json: { permissions: { manageSecrets: next } },
    });
    load();
  };

  return (
    <div className="stack" style={{ gap: 20 }}>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <h1>Team</h1>
        <button className="primary" onClick={() => setInviting(true)}>
          Invite member
        </button>
      </div>

      {loading && <div className="skeleton" style={{ minHeight: 120 }} />}

      {inviting && (
        <InviteForm
          tenants={tenants}
          onDone={() => {
            setInviting(false);
            load();
          }}
        />
      )}

      <div className="card" style={{ overflowX: 'auto' }}>
        <table className="data">
          <thead>
            <tr>
              <th>Name</th>
              <th>Email</th>
              <th>Role</th>
              <th>Clients</th>
              <th>Keys &amp; secrets</th>
              <th>Status</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {users.map((u) => {
              const assigned = parseAssigned(u.assigned_tenants_json);
              const assignedLabel =
                u.role === 'agency_admin'
                  ? 'All'
                  : assigned.length
                  ? assigned
                      .map((id) => tenants.find((t) => t.id === id)?.name ?? id)
                      .join(', ')
                  : 'None';
              const canSecrets = u.role === 'agency_admin' || parsePermissions(u.permissions_json).manageSecrets;
              return (
                <tr key={u.id} style={u.active ? undefined : { opacity: 0.5 }}>
                  <td>{u.name}</td>
                  <td>{u.email}</td>
                  <td>{u.role === 'agency_admin' ? 'Admin' : 'Staff'}</td>
                  <td>{assignedLabel}</td>
                  <td>
                    {u.role === 'agency_admin' ? (
                      <span className="muted">Always</span>
                    ) : (
                      <label className="row" style={{ gap: 6, width: 'auto' }}>
                        <input
                          type="checkbox"
                          style={{ width: 18, minHeight: 0 }}
                          checked={canSecrets}
                          disabled={!u.active}
                          onChange={() => toggleSecrets(u)}
                        />
                        {canSecrets ? 'Allowed' : 'No'}
                      </label>
                    )}
                  </td>
                  <td>{u.active ? 'Active' : 'Deactivated'}</td>
                  <td>
                    {u.active === 1 && u.id !== currentUserId && (
                      <button className="small" onClick={() => deactivate(u)}>
                        Deactivate
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
            {!loading && users.length === 0 && (
              <tr>
                <td colSpan={7} className="muted">
                  No team members yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function parseAssigned(json: string | null): string[] {
  if (!json) return [];
  try {
    const v = JSON.parse(json);
    return Array.isArray(v) ? (v as string[]) : [];
  } catch {
    return [];
  }
}

function InviteForm({
  tenants,
  onDone,
}: {
  tenants: Array<{ id: string; name: string }>;
  onDone: () => void;
}) {
  const [form, setForm] = useState<{
    email: string;
    name: string;
    role: 'agency_admin' | 'agency_staff';
    assignedTenants: string[];
    manageSecrets: boolean;
  }>({ email: '', name: '', role: 'agency_staff', assignedTenants: [], manageSecrets: false });
  const [result, setResult] = useState<{ email: string; tempPassword: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const toggleTenant = (id: string) =>
    setForm((f) => ({
      ...f,
      assignedTenants: f.assignedTenants.includes(id)
        ? f.assignedTenants.filter((t) => t !== id)
        : [...f.assignedTenants, id],
    }));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const payload: Record<string, unknown> = {
        email: form.email,
        name: form.name,
        role: form.role,
      };
      if (form.role === 'agency_staff') {
        payload.assignedTenants = form.assignedTenants;
        payload.permissions = { manageSecrets: form.manageSecrets };
      }
      const res = await api<{ email: string; tempPassword: string }>('/api/agency/users', {
        method: 'POST',
        json: payload,
      });
      setResult(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'invite failed');
    } finally {
      setBusy(false);
    }
  };

  if (result) {
    return (
      <div className="card stack">
        <h3>Member invited</h3>
        <p>
          {result.email} can sign in with this temp password (shown once):{' '}
          <code className="num">{result.tempPassword}</code>
        </p>
        <button className="primary" onClick={onDone}>
          Done
        </button>
      </div>
    );
  }

  return (
    <form className="card stack" onSubmit={submit}>
      <h3>Invite team member</h3>
      <div className="row">
        <label style={{ flex: 1 }}>
          Name
          <input value={form.name} onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))} required />
        </label>
        <label style={{ flex: 1 }}>
          Email
          <input
            type="email"
            value={form.email}
            onChange={(e) => setForm((p) => ({ ...p, email: e.target.value }))}
            required
          />
        </label>
      </div>
      <label>
        Role
        <select
          value={form.role}
          style={{ width: 'auto' }}
          onChange={(e) => setForm((p) => ({ ...p, role: e.target.value as 'agency_admin' | 'agency_staff' }))}
        >
          <option value="agency_staff">Staff (assigned clients only)</option>
          <option value="agency_admin">Admin (all clients and settings)</option>
        </select>
      </label>
      {form.role === 'agency_staff' && (
        <div className="stack" style={{ gap: 6 }}>
          <span className="muted" style={{ fontSize: 13 }}>
            Assigned clients
          </span>
          {tenants.length === 0 && <span className="muted">No clients to assign yet.</span>}
          <div className="row">
            {tenants.map((t) => (
              <label key={t.id} className="row" style={{ gap: 6, width: 'auto' }}>
                <input
                  type="checkbox"
                  style={{ width: 'auto', minHeight: 0 }}
                  checked={form.assignedTenants.includes(t.id)}
                  onChange={() => toggleTenant(t.id)}
                />
                {t.name}
              </label>
            ))}
          </div>
          <label className="row" style={{ gap: 8, width: 'auto' }}>
            <input
              type="checkbox"
              style={{ width: 18, minHeight: 0 }}
              checked={form.manageSecrets}
              onChange={(e) => setForm((p) => ({ ...p, manageSecrets: e.target.checked }))}
            />
            Can manage API keys &amp; secrets
          </label>
        </div>
      )}
      {error && <p className="delta-down">{error}</p>}
      <div className="row">
        <button className="primary" disabled={busy} type="submit">
          {busy ? 'Inviting' : 'Send invite'}
        </button>
        <button type="button" onClick={onDone}>
          Cancel
        </button>
      </div>
    </form>
  );
}

// Cross tenant audit log with filters by tenant, actor, action, and date.
export function AuditSection() {
  const [tenants, setTenants] = useState<Array<{ id: string; name: string }>>([]);
  const [filters, setFilters] = useState({ tenantId: '', actor: '', action: '', from: '', to: '' });
  const [entries, setEntries] = useState<Array<Record<string, unknown>>>([]);
  const [loading, setLoading] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      for (const [k, v] of Object.entries(filters)) if (v) params.set(k, v);
      const res = await api<{ entries: Array<Record<string, unknown>> }>(`/api/agency/audit?${params}`);
      setEntries(res.entries);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    api<{ tenants: Array<{ id: string; name: string }> }>('/api/agency/tenants')
      .then((r) => setTenants(r.tenants))
      .catch(() => undefined);
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="stack" style={{ gap: 20 }}>
      <h1>Audit log</h1>
      <div className="card stack">
        <div className="row">
          <select
            value={filters.tenantId}
            style={{ width: 'auto' }}
            onChange={(e) => setFilters((f) => ({ ...f, tenantId: e.target.value }))}
          >
            <option value="">All clients</option>
            {tenants.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
          <input
            placeholder="Actor id"
            style={{ maxWidth: 140 }}
            value={filters.actor}
            onChange={(e) => setFilters((f) => ({ ...f, actor: e.target.value }))}
          />
          <input
            placeholder="Action prefix"
            style={{ maxWidth: 160 }}
            value={filters.action}
            onChange={(e) => setFilters((f) => ({ ...f, action: e.target.value }))}
          />
          <input type="date" style={{ maxWidth: 160 }} value={filters.from} onChange={(e) => setFilters((f) => ({ ...f, from: e.target.value }))} />
          <input type="date" style={{ maxWidth: 160 }} value={filters.to} onChange={(e) => setFilters((f) => ({ ...f, to: e.target.value }))} />
          <button className="small primary" onClick={load}>
            Filter
          </button>
        </div>
        <div style={{ overflowX: 'auto' }}>
          <table className="data">
            <thead>
              <tr>
                <th>When</th>
                <th>Actor</th>
                <th>Client</th>
                <th>Action</th>
                <th>Target</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((e) => (
                <tr key={String(e.id)}>
                  <td className="num">{String(e.created_at).slice(0, 19).replace('T', ' ')}</td>
                  <td>
                    {String(e.actor_type)}:{String(e.actor_id ?? '')}
                  </td>
                  <td>{String(e.tenant_id ?? '')}</td>
                  <td>{String(e.action)}</td>
                  <td>{String(e.target ?? '')}</td>
                </tr>
              ))}
              {!loading && entries.length === 0 && (
                <tr>
                  <td colSpan={5} className="muted">
                    No entries match.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// Keys & secrets console: lets an agency admin (or a staff member granted
// the permission) rotate platform keys without touching code or running
// wrangler. Values are write only here — the server stores them encrypted
// and never sends plaintext back, so we only ever show whether a value is
// set and where the live value resolves from.
interface SettingStatus {
  key: string;
  label: string;
  secret: boolean;
  help: string;
  isSet: boolean;
  source: 'console' | 'env' | 'unset';
  updatedAt: string | null;
  updatedBy: string | null;
}

export function SecretsSection() {
  const [settings, setSettings] = useState<SettingStatus[]>([]);
  const [loading, setLoading] = useState(true);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [savedKey, setSavedKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = () => {
    setLoading(true);
    api<{ settings: SettingStatus[] }>('/api/agency/secrets')
      .then((r) => setSettings(r.settings))
      .catch((e) => setError(e instanceof Error ? e.message : 'failed to load'))
      .finally(() => setLoading(false));
  };

  useEffect(load, []);

  const save = async (key: string) => {
    const value = drafts[key];
    if (!value) return;
    setError(null);
    try {
      await api(`/api/agency/secrets/${key}`, { method: 'PUT', json: { value } });
      setDrafts((d) => ({ ...d, [key]: '' }));
      setSavedKey(key);
      setTimeout(() => setSavedKey(null), 2000);
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'save failed');
    }
  };

  return (
    <div className="stack" style={{ gap: 20 }}>
      <div className="stack" style={{ gap: 4 }}>
        <h1>Keys &amp; secrets</h1>
        <p className="muted">
          Rotate platform keys here instead of editing code. Values are stored encrypted and take effect
          immediately — you never have to redeploy. Existing values are hidden; entering a new one replaces it.
        </p>
      </div>

      {error && <p className="delta-down">{error}</p>}
      {loading && <div className="skeleton" style={{ minHeight: 120 }} />}

      {!loading &&
        settings.map((s) => (
          <div key={s.key} className="card stack" style={{ gap: 8 }}>
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <strong>{s.label}</strong>
              <span
                className="muted"
                style={{
                  fontSize: 12,
                  color:
                    s.source === 'console'
                      ? 'var(--verified-green)'
                      : s.source === 'unset'
                      ? 'var(--red-check)'
                      : undefined,
                }}
              >
                {s.source === 'console'
                  ? 'Set in console'
                  : s.source === 'env'
                  ? 'Using deployment value'
                  : 'Not set'}
              </span>
            </div>
            <p className="muted" style={{ fontSize: 13 }}>
              {s.help}
            </p>
            <div className="row" style={{ alignItems: 'flex-end' }}>
              <label style={{ flex: 1 }}>
                New value{s.secret ? ' (hidden)' : ''}
                <input
                  type={s.secret ? 'password' : 'text'}
                  placeholder={s.isSet ? '•••••••• (leave blank to keep)' : 'Enter a value'}
                  value={drafts[s.key] ?? ''}
                  onChange={(e) => setDrafts((d) => ({ ...d, [s.key]: e.target.value }))}
                />
              </label>
              <button className="primary" disabled={!drafts[s.key]} onClick={() => save(s.key)}>
                {savedKey === s.key ? 'Saved' : 'Save'}
              </button>
            </div>
            {s.updatedAt && (
              <p className="muted" style={{ fontSize: 12 }}>
                Last updated {s.updatedAt.slice(0, 19).replace('T', ' ')} by {s.updatedBy ?? 'unknown'}
              </p>
            )}
            <CodeBox
              label="Equivalent command line"
              hint="For reference only — you do not need this."
              code={`wrangler secret put ${s.key}`}
              language="bash"
            />
          </div>
        ))}
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
