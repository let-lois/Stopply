'use client';

// Agency console sections rendered as tabs inside AppShell:
//   - ClientsSection: the tenant grid from agency_rollup snapshots with
//     click through into each tenant's dashboard in agency context.
//   - TeamSection: agency user management (invite, role, tenant
//     assignment, deactivate), agency_admin only.
//   - AuditSection: the cross tenant audit log with filters.

import { useEffect, useState } from 'react';
import { api, ApiError, setCsrf } from '@/lib/api';
import { fmtStamp } from '@/lib/format';
import { CodeBox } from './CodeBox';

// The API's 400 responses carry a zod flatten() body under `details`:
// { fieldErrors: { [field]: string[] }, formErrors: string[] }. The
// top level error string alone ("invalid request") does not say which
// field or why, so pull the specific message out when one is present.
function describeApiError(err: unknown): string {
  if (err instanceof ApiError) {
    const details = err.body.details as { fieldErrors?: Record<string, string[]> } | undefined;
    const fieldErrors = details?.fieldErrors ?? {};
    const first = Object.entries(fieldErrors).find(([, msgs]) => msgs?.length > 0);
    if (first) return `${first[0]}: ${first[1][0]}`;
    return err.message;
  }
  return err instanceof Error ? err.message : 'request failed';
}

export const PLATFORM_LABEL: Record<string, string> = { meta: 'Meta', google: 'Google Ads' };

export interface TenantCard {
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
  monthly_ad_spend_budget: number | null;
  ad_platforms_json: string | null;
  ad_platform_budget_json: string | null;
}

export function parsePlatforms(json: string | null): string[] {
  if (!json) return [];
  try {
    const v = JSON.parse(json);
    return Array.isArray(v) ? (v as string[]) : [];
  } catch {
    return [];
  }
}

export function parsePlatformBudgets(json: string | null): Record<string, number> {
  if (!json) return {};
  try {
    const v = JSON.parse(json);
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, number>) : {};
  } catch {
    return {};
  }
}

const PLATFORM_LOGO: Record<string, string> = {
  meta: '/channel-logos/meta.webp',
  google: '/channel-logos/google-ads.webp',
};

function PlatformBadge({ platform }: { platform: string }) {
  const logo = PLATFORM_LOGO[platform];
  return (
    <span className="platform-badge" data-platform={platform}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      {logo && <img src={logo} alt="" />}
      {PLATFORM_LABEL[platform] ?? platform}
    </span>
  );
}

function PlusIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 15 15" fill="none" aria-hidden="true">
      <path d="M7.5 2v11M2 7.5h11" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" />
    </svg>
  );
}

// Which tint a card carries: Google leans blue, Meta purple, both blend.
// Purely decorative, the platform badges below still name them in text.
function tintFor(platforms: string[]): string {
  const google = platforms.includes('google');
  const meta = platforms.includes('meta');
  if (google && meta) return 'both';
  if (google) return 'google';
  if (meta) return 'meta';
  return 'none';
}

// Card grid or list. A per user preference like the theme, kept in
// localStorage rather than on the account, since it is a display choice and
// nobody else is affected by it.
type ClientsView = 'cards' | 'list';
const VIEW_KEY = 'lbi-clients-view';

function storedView(): ClientsView {
  try {
    const v = localStorage.getItem(VIEW_KEY);
    if (v === 'cards' || v === 'list') return v;
  } catch {
    /* ignore */
  }
  return 'cards';
}

function ViewToggle({ view, onChange }: { view: ClientsView; onChange: (v: ClientsView) => void }) {
  const options: Array<{ key: ClientsView; label: string; icon: React.ReactNode }> = [
    {
      key: 'cards',
      label: 'Cards',
      icon: (
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
          <rect x="0.9" y="0.9" width="5" height="5" rx="1.4" stroke="currentColor" strokeWidth="1.5" />
          <rect x="8.1" y="0.9" width="5" height="5" rx="1.4" stroke="currentColor" strokeWidth="1.5" />
          <rect x="0.9" y="8.1" width="5" height="5" rx="1.4" stroke="currentColor" strokeWidth="1.5" />
          <rect x="8.1" y="8.1" width="5" height="5" rx="1.4" stroke="currentColor" strokeWidth="1.5" />
        </svg>
      ),
    },
    {
      key: 'list',
      label: 'List',
      icon: (
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
          <path
            d="M1 2.4h12M1 7h12M1 11.6h12"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
          />
        </svg>
      ),
    },
  ];
  return (
    <div className="view-toggle" role="group" aria-label="Client layout">
      {options.map((o) => (
        <button
          key={o.key}
          type="button"
          className={o.key === view ? 'active' : undefined}
          aria-pressed={o.key === view}
          onClick={() => onChange(o.key)}
        >
          {o.icon}
          {o.label}
        </button>
      ))}
    </div>
  );
}

// The client this browser last opened. Kept locally like the view toggle
// and the theme: whose work is in front of you is a property of the person
// at the screen, not of the account, so it should not follow one agency
// user's browsing into everyone else's hero.
const LAST_CLIENT_KEY = 'lbi-last-client';

function storedLastClientId(): string | null {
  try {
    return localStorage.getItem(LAST_CLIENT_KEY);
  } catch {
    return null;
  }
}

function rememberLastClient(id: string): void {
  try {
    localStorage.setItem(LAST_CLIENT_KEY, id);
  } catch {
    /* ignore */
  }
}

// What the hero features, and why, so the eyebrow can say which it is
// rather than claiming "most recent activity" over something chosen on a
// different basis.
//
// Whichever client you last opened wins: coming back to the roster, the one
// you were working in is the one you most likely want again. Falls back to
// the most recent rollup on a fresh browser, and to the first client when
// nothing has rolled up at all. Rollup recency is real agency_rollup data,
// not a computed "top performer", which would mean putting numbers back on
// this page (see the note below).
type FeaturedReason = 'opened' | 'rollup' | 'first';

function pickFeatured(
  tenants: TenantCard[],
  lastOpenedId: string | null
): { tenant: TenantCard; reason: FeaturedReason } | null {
  if (tenants.length === 0) return null;
  // A remembered client that has since been removed falls through rather
  // than emptying the hero.
  const lastOpened = lastOpenedId ? tenants.find((t) => t.id === lastOpenedId) : undefined;
  if (lastOpened) return { tenant: lastOpened, reason: 'opened' };
  const rolled = tenants.filter((t) => t.pulled_at);
  if (rolled.length === 0) return { tenant: tenants[0]!, reason: 'first' };
  return {
    tenant: rolled.reduce((best, t) => (t.pulled_at! > best.pulled_at! ? t : best)),
    reason: 'rollup',
  };
}

const FEATURED_EYEBROW: Record<FeaturedReason, string> = {
  opened: 'Last opened',
  rollup: 'Most recent activity',
  first: 'Featured client',
};

// A selection surface, not a dashboard. Every number that used to live on
// each client (leads, revenue, ROAS, budget pacing, edit budget) now lives
// inside that client's own dashboard instead (see the Ad budget section
// added to Data and Team), so this stays "which client" and nothing else.
// The storefront treatment is layout and hierarchy only; it deliberately
// does not reintroduce metrics as card or hero stats.
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
  // Starts at the default and picks up the stored preference after mount:
  // the app is a static export, so reading localStorage during render would
  // not match the prerendered HTML.
  const [view, setView] = useState<ClientsView>('cards');
  const [lastClientId, setLastClientId] = useState<string | null>(null);
  useEffect(() => {
    setView(storedView());
    setLastClientId(storedLastClientId());
  }, []);

  const chooseView = (v: ClientsView) => {
    setView(v);
    try {
      localStorage.setItem(VIEW_KEY, v);
    } catch {
      /* ignore */
    }
  };

  const load = () => {
    setLoading(true);
    api<{ month: string; tenants: TenantCard[] }>('/api/agency/overview')
      .then((r) => setTenants(r.tenants))
      .finally(() => setLoading(false));
  };

  useEffect(load, []);

  const enter = async (t: TenantCard) => {
    const res = await api<{ csrf: string; tenant: { id: string; slug: string; name: string } }>(
      '/api/auth/switch-tenant',
      { method: 'POST', json: { tenantId: t.id } }
    );
    setCsrf(res.csrf);
    rememberLastClient(t.id);
    onEnterTenant(res.tenant);
  };

  const featuredPick = pickFeatured(tenants, lastClientId);
  const featured = featuredPick?.tenant ?? null;
  const rest = tenants.filter((t) => t.id !== featured?.id);

  const card = (t: TenantCard) => {
    const platforms = parsePlatforms(t.ad_platforms_json);
    return (
      <div
        key={t.id}
        className="client-card"
        data-tint={tintFor(platforms)}
        role="button"
        tabIndex={0}
        onClick={() => enter(t)}
        onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && enter(t)}
      >
        <div className="client-card-head">
          <span
            className={`status-dot lg ${t.pulled_at ? 'green' : 'gray'}`}
            title={t.pulled_at ? 'Rolled up' : 'No rollup yet'}
          />
          <div style={{ minWidth: 0, flex: 1 }}>
            <h3 className="client-card-name">{t.name}</h3>
            <div className="client-card-slug">{t.slug}</div>
          </div>
          {/* Tier sits in the head, not with the platforms: plan names vary
              in width (starter vs whitelabel) and would wrap the platform
              row on some cards but not others, leaving the grid ragged. */}
          <span className="plan-badge">{t.plan}</span>
        </div>
        <div className="client-card-badges">
          {platforms.map((p) => (
            <PlatformBadge key={p} platform={p} />
          ))}
        </div>
      </div>
    );
  };

  // Denser alternative to the grid: one client per row, same information,
  // scannable when the roster is long. Carries the platform tint as a left
  // edge rather than a top rule and corner wash.
  const listRow = (t: TenantCard) => {
    const platforms = parsePlatforms(t.ad_platforms_json);
    return (
      <div
        key={t.id}
        className="client-list-row"
        data-tint={tintFor(platforms)}
        role="button"
        tabIndex={0}
        onClick={() => enter(t)}
        onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && enter(t)}
      >
        <span
          className={`status-dot lg ${t.pulled_at ? 'green' : 'gray'}`}
          style={{ marginTop: 0 }}
          title={t.pulled_at ? 'Rolled up' : 'No rollup yet'}
        />
        <div className="client-list-name">
          <strong>{t.name}</strong>
          <span className="client-list-slug">{t.slug}</span>
        </div>
        <span className="client-list-stamp">
          {t.pulled_at ? fmtStamp(t.pulled_at) : 'No rollup yet'}
        </span>
        <div className="client-list-badges">
          {platforms.map((p) => (
            <PlatformBadge key={p} platform={p} />
          ))}
        </div>
        <span className="plan-badge">{t.plan}</span>
      </div>
    );
  };

  return (
    <div className="stack clients-page" style={{ gap: 28 }}>
      <div className="row clients-head" style={{ justifyContent: 'space-between' }}>
        <div className="stack" style={{ gap: 6, width: 'auto' }}>
          <h1>Clients</h1>
          {!loading && tenants.length > 0 && (
            <span className="clients-eyebrow">
              {tenants.length} {tenants.length === 1 ? 'account' : 'accounts'}
            </span>
          )}
        </div>
        <div className="row" style={{ gap: 12, width: 'auto' }}>
          {!loading && tenants.length > 0 && <ViewToggle view={view} onChange={chooseView} />}
          {role === 'agency_admin' && (
            <button className="primary action-cta" onClick={() => setProvisioning(true)}>
              <PlusIcon />
              New client
            </button>
          )}
        </div>
      </div>

      {loading && (
        <>
          <div className="skeleton" style={{ minHeight: 250, borderRadius: 20 }} />
          <div className="client-grid">
            {[0, 1, 2].map((i) => (
              <div key={i} className="skeleton client-card-skeleton" />
            ))}
          </div>
        </>
      )}

      {!loading && tenants.length === 0 && (
        <div className="clients-empty">
          <h3 style={{ fontSize: 22 }}>No clients yet</h3>
          <p className="muted" style={{ margin: 0, maxWidth: 420 }}>
            {role === 'agency_admin'
              ? 'Provision your first client with New client to get started.'
              : 'No clients have been assigned to you yet.'}
          </p>
        </div>
      )}

      {/* The hero belongs to the storefront view. List view is the dense
          alternative, so it shows every client in one uninterrupted index
          instead of pulling one out. */}
      {!loading && view === 'cards' && featured && (
        <div
          className="clients-hero"
          role="button"
          tabIndex={0}
          onClick={() => enter(featured)}
          onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && enter(featured)}
        >
          <span className="clients-eyebrow">{FEATURED_EYEBROW[featuredPick!.reason]}</span>
          <h2 className="clients-hero-title">{featured.name}</h2>
          <div className="clients-hero-meta">
            <span
              className={`status-dot lg ${featured.pulled_at ? 'green' : 'gray'}`}
              style={{ marginTop: 0 }}
            />
            <span>
              {featured.pulled_at ? `Rolled up ${fmtStamp(featured.pulled_at)}` : 'No rollup yet'}
            </span>
            {parsePlatforms(featured.ad_platforms_json).map((p) => (
              <PlatformBadge key={p} platform={p} />
            ))}
            <span className="plan-badge">{featured.plan}</span>
          </div>
        </div>
      )}

      {!loading && view === 'cards' && rest.length > 0 && (
        <div className="stack" style={{ gap: 14 }}>
          <span className="clients-eyebrow">All clients</span>
          <div className="client-grid">{rest.map(card)}</div>
        </div>
      )}

      {!loading && view === 'list' && tenants.length > 0 && (
        <div className="client-list">{tenants.map(listRow)}</div>
      )}

      {provisioning && (
        <ProvisionForm
          existingSlugs={tenants.map((t) => t.slug)}
          onDone={() => {
            setProvisioning(false);
            load();
          }}
        />
      )}
    </div>
  );
}

// Edit a client's committed monthly ad spend and platform mix after it has
// already been provisioned. Lives inside that client's own Data and Team
// tab now (see ClientBudgetSection in DataTeam.tsx), not the roster.
export function BudgetForm({ tenant, onSaved }: { tenant: TenantCard; onSaved: () => void }) {
  const [budget, setBudget] = useState(
    tenant.monthly_ad_spend_budget != null ? String(tenant.monthly_ad_spend_budget) : ''
  );
  const [platforms, setPlatforms] = useState<string[]>(parsePlatforms(tenant.ad_platforms_json));
  const initialPlatformBudgets = parsePlatformBudgets(tenant.ad_platform_budget_json);
  const [platformBudgets, setPlatformBudgets] = useState<Record<string, string>>({
    meta: initialPlatformBudgets.meta != null ? String(initialPlatformBudgets.meta) : '',
    google: initialPlatformBudgets.google != null ? String(initialPlatformBudgets.google) : '',
  });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const togglePlatform = (p: string) =>
    setPlatforms((prev) => (prev.includes(p) ? prev.filter((x) => x !== p) : [...prev, p]));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const platformBudgetsPayload: Record<string, number> = {};
      for (const p of platforms) {
        const raw = platformBudgets[p]?.trim();
        if (raw) platformBudgetsPayload[p] = Number(raw);
      }
      await api(`/api/agency/tenants/${tenant.id}/budget`, {
        method: 'PUT',
        json: {
          monthlyAdSpendBudget: budget.trim() === '' ? null : Number(budget),
          adPlatforms: platforms,
          platformBudgets: Object.keys(platformBudgetsPayload).length > 0 ? platformBudgetsPayload : null,
        },
      });
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'save failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="stack" onSubmit={submit}>
      <label>
        Monthly ad spend budget
        <input
          type="number"
          min={0}
          step="1"
          placeholder="e.g. 5000"
          value={budget}
          onChange={(e) => setBudget(e.target.value)}
        />
      </label>
      <div className="stack" style={{ gap: 6 }}>
        <span className="muted" style={{ fontSize: 13 }}>
          Platforms
        </span>
        <div className="row">
          {(['meta', 'google'] as const).map((p) => (
            <label key={p} className="row" style={{ gap: 6, width: 'auto' }}>
              <input
                type="checkbox"
                style={{ width: 'auto', minHeight: 0 }}
                checked={platforms.includes(p)}
                onChange={() => togglePlatform(p)}
              />
              {PLATFORM_LABEL[p]}
            </label>
          ))}
        </div>
      </div>
      {platforms.length > 0 && (
        <div className="stack" style={{ gap: 6 }}>
          <span className="muted" style={{ fontSize: 13 }}>
            Budget split by platform (optional, does not need to sum to the total above)
          </span>
          <div className="row">
            {(['meta', 'google'] as const)
              .filter((p) => platforms.includes(p))
              .map((p) => (
                <label key={p} style={{ flex: 1 }}>
                  {PLATFORM_LABEL[p]}
                  <input
                    type="number"
                    min={0}
                    step="1"
                    placeholder="e.g. 3000"
                    value={platformBudgets[p] ?? ''}
                    onChange={(e) => setPlatformBudgets((prev) => ({ ...prev, [p]: e.target.value }))}
                  />
                </label>
              ))}
          </div>
        </div>
      )}
      {error && <p className="delta-down">{error}</p>}
      <button className="primary" style={{ alignSelf: 'flex-start' }} disabled={busy} type="submit">
        {busy ? 'Saving' : 'Save budget'}
      </button>
    </form>
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
  // Shown once after a reset, exactly like the invite result: the password
  // is only ever returned in that one response, never stored in the clear.
  const [reset, setReset] = useState<{ email: string; tempPassword: string } | null>(null);

  const load = () => {
    setLoading(true);
    api<{ users: AgencyUser[] }>('/api/agency/users')
      .then((r) => setUsers(r.users ?? []))
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

  const resetPassword = async (u: AgencyUser) => {
    if (!confirm(`Issue a new temporary password for ${u.name}? Their current one stops working.`)) {
      return;
    }
    const res = await api<{ email: string; tempPassword: string }>(
      `/api/agency/users/${u.id}/reset-password`,
      { method: 'POST', json: {} }
    );
    setReset(res);
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

      {reset && (
        <div className="card stack">
          <h3>New temporary password</h3>
          <p className="muted" style={{ margin: 0, fontSize: 13 }}>
            Shown once. Pass it to {reset.email} over a channel you trust, then close this.
          </p>
          <p style={{ margin: 0 }}>
            <code className="num">{reset.tempPassword}</code>
          </p>
          <button className="primary" style={{ alignSelf: 'flex-start' }} onClick={() => setReset(null)}>
            Done
          </button>
        </div>
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
                    <div className="row-actions">
                      {u.active === 1 && (
                        <button className="small" onClick={() => resetPassword(u)}>
                          Reset password
                        </button>
                      )}
                      {u.active === 1 && u.id !== currentUserId && (
                        <button className="small" onClick={() => deactivate(u)}>
                          Deactivate
                        </button>
                      )}
                    </div>
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

// Client-facing subdomain the tenant provisions to (e.g. be-clinical in
// be-clinical.bi.letlois.com). Derived from the client name instead of
// asking the agency to come up with and type one themselves.
function slugify(name: string): string {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  return base.length >= 2 ? base : 'client';
}

function uniqueSlug(name: string, existingSlugs: string[]): string {
  const base = slugify(name);
  if (!existingSlugs.includes(base)) return base;
  for (let n = 2; ; n++) {
    const candidate = `${base}-${n}`.slice(0, 40);
    if (!existingSlugs.includes(candidate)) return candidate;
  }
}

function ProvisionForm({ existingSlugs, onDone }: { existingSlugs: string[]; onDone: () => void }) {
  const [form, setForm] = useState({
    name: '',
    adminEmail: '',
    adminName: '',
    timezone: 'America/Phoenix',
    plan: 'starter',
    monthlyAdSpendBudget: '',
  });
  const [adPlatforms, setAdPlatforms] = useState<string[]>([]);
  const [platformBudgets, setPlatformBudgets] = useState<Record<string, string>>({ meta: '', google: '' });
  const [result, setResult] = useState<{ tempPassword: string | null; slug: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const togglePlatform = (p: string) =>
    setAdPlatforms((prev) => (prev.includes(p) ? prev.filter((x) => x !== p) : [...prev, p]));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const { monthlyAdSpendBudget, ...rest } = form;
      const payload: Record<string, unknown> = { ...rest, slug: uniqueSlug(form.name, existingSlugs), adPlatforms };
      if (monthlyAdSpendBudget.trim() !== '') payload.monthlyAdSpendBudget = Number(monthlyAdSpendBudget);
      const platformBudgetsPayload: Record<string, number> = {};
      for (const p of adPlatforms) {
        const raw = platformBudgets[p]?.trim();
        if (raw) platformBudgetsPayload[p] = Number(raw);
      }
      if (Object.keys(platformBudgetsPayload).length > 0) payload.platformBudgets = platformBudgetsPayload;
      const res = await api<{ tempPassword: string | null; slug: string }>('/api/agency/tenants', {
        method: 'POST',
        json: payload,
      });
      setResult(res);
    } catch (err) {
      setError(describeApiError(err));
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
      <label>
        Name
        <input value={form.name} onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))} required />
      </label>
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
      <div className="row">
        <label style={{ flex: 1 }}>
          Monthly ad spend budget
          <input
            type="number"
            min={0}
            step="1"
            placeholder="e.g. 5000"
            value={form.monthlyAdSpendBudget}
            onChange={(e) => setForm((p) => ({ ...p, monthlyAdSpendBudget: e.target.value }))}
          />
        </label>
        <div className="stack" style={{ flex: 1, gap: 6 }}>
          <span className="muted" style={{ fontSize: 13 }}>
            Platforms
          </span>
          <div className="row">
            {(['meta', 'google'] as const).map((p) => (
              <label key={p} className="row" style={{ gap: 6, width: 'auto' }}>
                <input
                  type="checkbox"
                  style={{ width: 'auto', minHeight: 0 }}
                  checked={adPlatforms.includes(p)}
                  onChange={() => togglePlatform(p)}
                />
                {PLATFORM_LABEL[p]}
              </label>
            ))}
          </div>
        </div>
      </div>
      {adPlatforms.length > 0 && (
        <div className="row">
          {(['meta', 'google'] as const)
            .filter((p) => adPlatforms.includes(p))
            .map((p) => (
              <label key={p} style={{ flex: 1 }}>
                {PLATFORM_LABEL[p]} budget (optional)
                <input
                  type="number"
                  min={0}
                  step="1"
                  placeholder="e.g. 3000"
                  value={platformBudgets[p] ?? ''}
                  onChange={(e) => setPlatformBudgets((prev) => ({ ...prev, [p]: e.target.value }))}
                />
              </label>
            ))}
        </div>
      )}
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
