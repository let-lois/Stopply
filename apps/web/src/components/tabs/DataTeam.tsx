'use client';

// Data and Team: sources with freshness, Mark pulled (upload or sync),
// recent imports, team roster with invites and view configs, targets
// editor, the integrations hub, and the white label settings panel.

import { useCallback, useEffect, useState } from 'react';
import { api, ApiError, getCsrf } from '@/lib/api';
import { isDemoMode } from '@/lib/demoMode';
import { fmtMoney, fmtStamp } from '@/lib/format';
import type { FunnelLabels, SourceInfo, TenantSettings } from '@/lib/types';
import { useToast } from '../Toasts';
import { CodeBox } from '../CodeBox';
import { applyThemeMode, getThemeMode, type ThemeMode } from '@/lib/theme';
import { BudgetForm, type TenantCard } from '../AgencyOverview';
import { FieldRepsSection, SampleDataControls } from './FieldActivity';

// The palette a tenant starts from in the theme editor, and the base every
// save is spread over so a partial edit still sends a complete theme (the
// PUT schema requires every token). Mirrors LETLOIS_THEME in packages/db,
// which apps/web cannot import: it is a Worker side package and the web app
// does not depend on it. Keep the two in step if either changes.
const DEFAULT_THEME_TOKENS: Record<string, string> = {
  paper: '#F6F3EE', card: '#FFFFFF', ink: '#23201C', inkSoft: '#6F6A62', hairline: '#E7E1D8',
  accent: '#3F5A52', accentSoft: '#E9EEEB', positive: '#3F5A52', negative: '#B0644F', amber: '#A98142',
  verifiedGreen: '#4C7A5E', grayCheck: '#C9C3B8', redCheck: '#C0654E', channelGoogle: '#3F5A52',
  channelMeta: '#A98142', channelWebsite: '#9A9389', fontDisplay: 'Fraunces', fontBody: 'Spline Sans',
  fontMono: 'Spline Sans Mono',
};

interface TeamUser {
  id: string;
  email: string;
  name: string;
  role: 'account_admin' | 'viewer';
  view_config_json: string | null;
  active: number;
}

interface IntegrationInfo {
  key: string;
  provider: string;
  status: string;
  connectedAs: string | null;
  lastSyncAt: string | null;
  lastSyncResult: string | null;
  planCheck: Record<string, unknown> | null;
}

interface Requirements {
  displayName: string;
  authKind: string;
  credentialFields: Array<{ key: string; label: string; secret: boolean }>;
  planRequirement: string;
  planLink: string;
  tokenGuide: string[];
  defaultStageMap: Array<{ externalEvent: string; stage: string }>;
}

export function DataTeamTab({
  settings,
  labels,
  sources,
  refreshSources,
  refreshSettings,
  refreshFieldRoster,
}: {
  settings: TenantSettings;
  labels: FunnelLabels;
  sources: SourceInfo[];
  refreshSources: () => void;
  refreshSettings: () => void;
  // Lets AppShell re-check whether this client has a crew, so the
  // client-facing Door to Door section appears as soon as the first rep is
  // added rather than on the next page load.
  refreshFieldRoster?: () => void;
}) {
  const toast = useToast();
  const tz = settings.tenant.timezone;
  const isAgency = settings.role === 'agency_admin' || settings.role === 'agency_staff';

  return (
    <div className="stack" style={{ gap: 24 }}>
      <SourcesSection sources={sources} tz={tz} refreshSources={refreshSources} toast={toast} />
      <ImportsSection tz={tz} />
      <TeamSection toast={toast} />
      <SectionsSection settings={settings} toast={toast} refreshSettings={refreshSettings} />
      <FieldRepsSection onRosterChanged={refreshFieldRoster} />
      <SampleDataControls onChanged={refreshFieldRoster} />
      <TargetsSection labels={labels} toast={toast} />
      {settings.role === 'agency_admin' && <ClientBudgetSection tenantId={settings.tenant.id} />}
      <SettingsSection settings={settings} labels={labels} toast={toast} isAgency={isAgency} refreshSettings={refreshSettings} />

      {/* API integrations are buried by design: getting started is about
          getting clean CSVs in. Live API connections are an optional power
          feature, tucked away so they do not distract from the main flow. */}
      <section className="card">
        <details className="disclosure">
          <summary>Advanced: live API integrations</summary>
          <p className="muted" style={{ fontSize: 13, margin: '8px 0' }}>
            Most accounts never need this. Connect a live API only when you want automatic syncing instead of
            CSV uploads.
          </p>
          <IntegrationsSection toast={toast} refreshSources={refreshSources} />
        </details>
      </section>
    </div>
  );
}

// Friendly parser presets. 'auto' lets the AI detector classify the CSV.
const PARSER_OPTIONS: Array<{ key: string; label: string }> = [
  { key: 'auto', label: 'Auto-detect with AI' },
  { key: 'ghl-contacts', label: 'Go High Level — contacts' },
  { key: 'ghl-website', label: 'Go High Level — website' },
  { key: 'google-campaign', label: 'Google Ads — campaigns' },
  { key: 'meta-campaign', label: 'Meta Ads — campaigns' },
  { key: 'google-ad-lineitem', label: 'Google Ads — by ad' },
  { key: 'meta-ad-lineitem', label: 'Meta Ads — by ad' },
  { key: 'blvd-appointments', label: 'Boulevard — appointments' },
  { key: 'blvd-line-items', label: 'Boulevard — sales' },
  { key: 'blvd-clients', label: 'Boulevard — clients' },
  { key: 'd2d-accounts', label: 'Door to door — accounts (knocks, appointments, sits, closes)' },
];

function SourcesSection({
  sources,
  tz,
  refreshSources,
  toast,
}: {
  sources: SourceInfo[];
  tz: string;
  refreshSources: () => void;
  toast: (s: string) => void;
}) {
  const [uploadFor, setUploadFor] = useState<SourceInfo | null>(null);
  const [secret, setSecret] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  const verify = async (key: string) => {
    await api(`/api/tenant/sources/${key}/verify`, { method: 'POST' });
    toast('Source verified');
    refreshSources();
  };

  const rotateSecret = async (key: string) => {
    const res = await api<{ secret: string }>(`/api/tenant/sources/${key}/secret`, { method: 'POST' });
    setSecret(res.secret);
  };

  const removeSource = async (s: SourceInfo) => {
    if (!confirm(`Remove the source "${s.name}"? Imported data stays; only the source is removed.`)) return;
    await api(`/api/tenant/sources/${s.key}`, { method: 'DELETE' });
    toast('Source removed');
    refreshSources();
  };

  const origin = typeof location !== 'undefined' ? location.origin : '';

  return (
    <section className="card stack">
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <h3>Sources</h3>
        <button className="small primary" onClick={() => setAdding(true)}>
          + Add source
        </button>
      </div>
      <p className="muted" style={{ fontSize: 13 }}>
        Every source is a CSV. Tell us where it comes from and we&apos;ll organize the columns for you — even for
        a custom export.
      </p>
      <div style={{ overflowX: 'auto' }}>
        <table className="data">
          <thead>
            <tr>
              <th>Source</th>
              <th>Type</th>
              <th>Freshness</th>
              <th>Records through</th>
              <th>Last import</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {sources.map((s) => (
              <tr key={s.key}>
                <td>{s.name}</td>
                <td className="muted">{s.connector_type ?? (s.kind === 'csv' ? 'CSV (auto)' : s.kind)}</td>
                <td>
                  <span className={`check ${s.freshness}`} style={{ marginLeft: 0 }} />{' '}
                  {s.freshness === 'green' ? 'verified' : s.freshness === 'red' ? 'stale' : 'imported'}
                </td>
                <td className="num">{s.records_through?.slice(0, 10) ?? '-'}</td>
                <td className="num">{fmtStamp(s.last_import_at, tz)}</td>
                <td>
                  <div className="row" style={{ gap: 6 }}>
                    <button className="small" onClick={() => verify(s.key)}>
                      Verify
                    </button>
                    {s.kind !== 'integration' && (
                      <button className="small primary" onClick={() => setUploadFor(s)}>
                        Upload CSV
                      </button>
                    )}
                    {s.kind === 'webhook' && (
                      <button className="small" onClick={() => rotateSecret(s.key)}>
                        Signing secret
                      </button>
                    )}
                    {s.kind === 'csv' && (
                      <button className="small" onClick={() => removeSource(s)}>
                        Remove
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
            {sources.length === 0 && (
              <tr>
                <td colSpan={6} className="muted">
                  No sources yet. Add one to start uploading CSVs.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {adding && (
        <AddSourceForm
          onDone={() => {
            setAdding(false);
            refreshSources();
          }}
          toast={toast}
        />
      )}

      {secret && (
        <div className="card stack" style={{ borderColor: 'var(--amber)' }}>
          <p className="muted" style={{ fontSize: 13 }}>
            New signing secret — copy it now, it is shown only once.
          </p>
          <CodeBox label="Signing secret" hint="Keep this private." code={secret} defaultOpen />
          <button className="small" onClick={() => setSecret(null)}>
            I saved it
          </button>
        </div>
      )}

      {uploadFor && (
        <UploadForm source={uploadFor} onDone={() => setUploadFor(null)} refreshSources={refreshSources} toast={toast} />
      )}

      <div className="stack" style={{ gap: 6 }}>
        <span className="muted" style={{ fontSize: 13 }}>
          Optional website tracking snippet:
        </span>
        <CodeBox
          label="Website tracking script"
          hint="Optional — your developer can add this later."
          code={`<script async src="${origin}/t.js"></script>`}
          language="html"
        />
      </div>
    </section>
  );
}

// Add a source. For a CSV the only required field is a name of where the
// data comes from; the parser defaults to AI auto-detect.
function AddSourceForm({ onDone, toast }: { onDone: () => void; toast: (s: string) => void }) {
  const [name, setName] = useState('');
  const [connectorType, setConnectorType] = useState('auto');
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    setBusy(true);
    try {
      await api('/api/tenant/sources', { method: 'POST', json: { name: name.trim(), connectorType } });
      toast('Source added');
      onDone();
    } catch (err) {
      toast(err instanceof ApiError ? err.message : 'could not add source');
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="card stack" style={{ borderColor: 'var(--accent)' }} onSubmit={submit}>
      <h3 style={{ fontSize: 16 }}>Add a source</h3>
      <label>
        Where does this data come from?
        <input placeholder="e.g. Go High Level, Acme Spreadsheet" value={name} onChange={(e) => setName(e.target.value)} />
      </label>
      <label>
        Format
        <select value={connectorType} onChange={(e) => setConnectorType(e.target.value)} style={{ width: 'auto' }}>
          {PARSER_OPTIONS.map((o) => (
            <option key={o.key} value={o.key}>
              {o.label}
            </option>
          ))}
        </select>
      </label>
      <div className="row">
        <button className="primary" type="submit" disabled={busy}>
          {busy ? 'Adding…' : 'Add source'}
        </button>
        <button type="button" onClick={onDone}>
          Cancel
        </button>
      </div>
    </form>
  );
}

// Upload a CSV for a source, with an AI detection step that reads the file
// and suggests how to parse it before the import runs.
function UploadForm({
  source,
  onDone,
  refreshSources,
  toast,
}: {
  source: SourceInfo;
  onDone: () => void;
  refreshSources: () => void;
  toast: (s: string) => void;
}) {
  const [month, setMonth] = useState(new Date().toISOString().slice(0, 7));
  const [file, setFile] = useState<File | null>(null);
  const [parser, setParser] = useState<string>(source.connector_type ?? 'auto');
  const [detecting, setDetecting] = useState(false);
  const [suggestion, setSuggestion] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const onPick = async (f: File) => {
    setFile(f);
    setSuggestion(null);
    // If the source has no fixed parser, ask the AI to read the file and
    // suggest one before the user commits.
    if (!source.connector_type) {
      setDetecting(true);
      try {
        const csv = await f.text();
        const res = await api<{
          suggestion: { parser: string; role: string; confidence: number | null; reason: string } | null;
          reason: string;
        }>('/api/imports/detect', { method: 'POST', json: { csv } });
        if (res.suggestion) {
          setParser(res.suggestion.parser);
          setSuggestion(
            `Looks like ${res.suggestion.parser} (${res.suggestion.role})${
              res.suggestion.reason ? ` — ${res.suggestion.reason}` : ''
            }. You can change this below.`
          );
        } else {
          setSuggestion(res.reason || 'Could not auto-detect; please choose a format below.');
        }
      } catch {
        setSuggestion('Auto-detect is unavailable; please choose a format below.');
      } finally {
        setDetecting(false);
      }
    }
  };

  const upload = async () => {
    if (!file) return;
    if (parser === 'auto') {
      toast('Pick a format (auto-detect could not decide).');
      return;
    }
    setBusy(true);
    try {
      const csv = await file.text();
      const res = await api<{ rowCount: number }>('/api/imports', {
        method: 'POST',
        json: { sourceKey: source.key, month, csv, parser },
      });
      toast(`Imported ${res.rowCount} rows for ${month}`);
      onDone();
      refreshSources();
    } catch (err) {
      toast(err instanceof ApiError ? err.message : 'upload failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="card stack" style={{ borderColor: 'var(--accent)' }}>
      <h3 style={{ fontSize: 16 }}>Upload {source.name}</h3>
      {source.how_to && <p className="muted" style={{ fontSize: 13 }}>{source.how_to}</p>}
      <label>
        Month
        <input type="month" value={month} onChange={(e) => setMonth(e.target.value)} style={{ maxWidth: 200 }} />
      </label>
      <input type="file" accept=".csv,text/csv" disabled={busy} onChange={(e) => e.target.files?.[0] && onPick(e.target.files[0])} />
      {detecting && <p className="muted" style={{ fontSize: 13 }}>Reading your file…</p>}
      {suggestion && <p style={{ fontSize: 13 }}>{suggestion}</p>}
      {file && (
        <label>
          Format
          <select value={parser} onChange={(e) => setParser(e.target.value)} style={{ width: 'auto' }}>
            {PARSER_OPTIONS.map((o) => (
              <option key={o.key} value={o.key}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
      )}
      <div className="row">
        <button className="primary" disabled={!file || busy} onClick={upload}>
          {busy ? 'Importing…' : 'Import CSV'}
        </button>
        <button onClick={onDone}>Cancel</button>
      </div>
    </div>
  );
}

function IntegrationsSection({ toast, refreshSources }: { toast: (s: string) => void; refreshSources: () => void }) {
  const [integrations, setIntegrations] = useState<IntegrationInfo[]>([]);
  const [requirements, setRequirements] = useState<Record<string, Requirements>>({});
  const [editing, setEditing] = useState<string | null>(null);
  const [creds, setCreds] = useState<Record<string, string>>({});
  const [testResult, setTestResult] = useState<Record<string, string>>({});

  const load = useCallback(() => {
    api<{ integrations: IntegrationInfo[]; requirements: Record<string, Requirements> }>(
      '/api/tenant/integrations'
    ).then((res) => {
      setIntegrations(res.integrations);
      setRequirements(res.requirements);
    }).catch(() => undefined);
  }, []);

  useEffect(load, [load]);

  const save = async (provider: string) => {
    await api(`/api/tenant/integrations/${provider}/credentials`, {
      method: 'PUT',
      json: { provider, credentials: creds },
    });
    toast('Credentials saved');
    setEditing(null);
    setCreds({});
    load();
  };

  const test = async (key: string) => {
    const res = await api<{ ok: boolean; message: string | null; connectedAs: string | null; failure: string | null }>(
      `/api/tenant/integrations/${key}/test`,
      { method: 'POST', json: {} }
    );
    setTestResult((prev) => ({
      ...prev,
      [key]: res.ok
        ? `Connected as ${res.connectedAs}. Your plan supports this.`
        : res.failure === 'insufficient_plan'
          ? `Upgrade needed: ${res.message}`
          : `Failed: ${res.message}`,
    }));
    load();
  };

  const sync = async (key: string) => {
    const month = new Date().toISOString().slice(0, 7);
    try {
      const res = await api<{ stats: Record<string, number> }>(`/api/tenant/integrations/${key}/sync`, {
        method: 'POST',
        json: { month },
      });
      toast(`Synced: ${JSON.stringify(res.stats)}`);
      refreshSources();
    } catch (err) {
      toast(err instanceof Error ? err.message : 'sync failed');
    }
    load();
  };

  return (
    <section className="card stack">
      <h3>Integrations</h3>
      <div className="stack">
        {Object.entries(requirements).map(([provider, req]) => {
          const row = integrations.find((i) => i.provider === provider);
          const status = row?.status ?? 'disconnected';
          return (
            <div key={provider} className="card stack" style={{ gap: 8 }}>
              <div className="row" style={{ justifyContent: 'space-between' }}>
                <strong>{req.displayName}</strong>
                <span
                  className="muted"
                  style={{ color: status === 'connected' ? 'var(--verified-green)' : status === 'error' ? 'var(--red-check)' : undefined }}
                >
                  {status}
                  {row?.connectedAs ? ` as ${row.connectedAs}` : ''}
                </span>
              </div>
              <p className="muted" style={{ fontSize: 13 }}>
                {req.planRequirement}{' '}
                <a href={req.planLink} target="_blank" rel="noreferrer">
                  Plan details
                </a>
              </p>
              {editing === provider ? (
                <div className="stack">
                  <ol style={{ margin: 0, paddingLeft: 18, fontSize: 13 }}>
                    {req.tokenGuide.map((step, i) => (
                      <li key={i}>{step}</li>
                    ))}
                  </ol>
                  {req.credentialFields.map((f) => (
                    <label key={f.key}>
                      {f.label}
                      <input
                        type={f.secret ? 'password' : 'text'}
                        value={creds[f.key] ?? ''}
                        onChange={(e) => setCreds((p) => ({ ...p, [f.key]: e.target.value }))}
                      />
                    </label>
                  ))}
                  <div className="row">
                    <button className="primary" onClick={() => save(provider)}>
                      Save credentials
                    </button>
                    <button onClick={() => setEditing(null)}>Cancel</button>
                  </div>
                </div>
              ) : (
                <div className="row">
                  <button className="small" onClick={() => setEditing(provider)}>
                    {status === 'disconnected' ? 'Connect' : 'Reconnect'}
                  </button>
                  {row && (
                    <>
                      <button className="small" onClick={() => test(provider)}>
                        Test connection
                      </button>
                      <button className="small" onClick={() => sync(provider)}>
                        Sync now
                      </button>
                    </>
                  )}
                </div>
              )}
              {testResult[provider] && <p style={{ fontSize: 13 }}>{testResult[provider]}</p>}
              {row?.lastSyncAt && (
                <p className="muted" style={{ fontSize: 12 }}>
                  Last sync {fmtStamp(row.lastSyncAt)}: {row.lastSyncResult?.slice(0, 120)}
                </p>
              )}
              {req.defaultStageMap.length > 0 && <StageMapEditor provider={provider} req={req} toast={toast} />}
            </div>
          );
        })}
      </div>
    </section>
  );
}

function StageMapEditor({ provider, req, toast }: { provider: string; req: Requirements; toast: (s: string) => void }) {
  const [open, setOpen] = useState(false);
  const [mappings, setMappings] = useState(req.defaultStageMap);
  const stages = ['lead', 'scheduled', 'completed', 'purchase'];
  if (!open) {
    return (
      <button className="small" style={{ alignSelf: 'flex-start' }} onClick={() => setOpen(true)}>
        Stage mapping
      </button>
    );
  }
  return (
    <div className="stack" style={{ gap: 6 }}>
      {mappings.map((m, i) => (
        <div className="row" key={m.externalEvent}>
          <span style={{ minWidth: 170, fontSize: 13 }}>{m.externalEvent}</span>
          <select
            value={m.stage}
            style={{ width: 'auto' }}
            onChange={(e) =>
              setMappings((prev) => prev.map((x, j) => (j === i ? { ...x, stage: e.target.value } : x)))
            }
          >
            {stages.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>
      ))}
      <div className="row">
        <button
          className="small primary"
          onClick={async () => {
            await api(`/api/tenant/integrations/${provider}/stage-map`, { method: 'PUT', json: { mappings } });
            toast('Stage mapping saved');
            setOpen(false);
          }}
        >
          Save mapping
        </button>
        <button className="small" onClick={() => setOpen(false)}>
          Close
        </button>
      </div>
    </div>
  );
}

function ImportsSection({ tz }: { tz: string }) {
  const [imports, setImports] = useState<Array<Record<string, unknown>>>([]);
  useEffect(() => {
    api<{ imports: Array<Record<string, unknown>> }>('/api/imports').then((r) => setImports(r.imports)).catch(() => undefined);
  }, []);
  return (
    <section className="card stack">
      <h3>Recent imports</h3>
      {imports.length === 0 && <p className="muted">No imports yet.</p>}
      {imports.length > 0 && (
        <table className="data">
          <thead>
            <tr>
              <th>Source</th>
              <th>Month</th>
              <th>Rows</th>
              <th>Uploaded</th>
            </tr>
          </thead>
          <tbody>
            {imports.slice(0, 10).map((imp) => (
              <tr key={String(imp.id)}>
                <td>{String(imp.source_key)}</td>
                <td className="num">{String(imp.period_month)}</td>
                <td className="num">{String(imp.row_count)}</td>
                <td className="num">{fmtStamp(String(imp.uploaded_at), tz)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

function TeamSection({ toast }: { toast: (s: string) => void }) {
  const [users, setUsers] = useState<TeamUser[]>([]);
  const [invite, setInvite] = useState({ email: '', name: '', role: 'viewer' as 'viewer' | 'account_admin' });
  const [tempPassword, setTempPassword] = useState<string | null>(null);
  const [configFor, setConfigFor] = useState<TeamUser | null>(null);

  const load = useCallback(() => {
    api<{ users: TeamUser[] }>('/api/tenant/users').then((r) => setUsers(r.users)).catch(() => undefined);
  }, []);
  useEffect(load, [load]);

  const sendInvite = async () => {
    try {
      const res = await api<{ tempPassword: string }>('/api/tenant/users', { method: 'POST', json: invite });
      setTempPassword(res.tempPassword);
      toast('User invited');
      setInvite({ email: '', name: '', role: 'viewer' });
      load();
    } catch (err) {
      toast(err instanceof Error ? err.message : 'invite failed');
    }
  };

  // Nothing is emailed (the API Worker has no mail provider), so a reset
  // hands the admin a new temp password to pass on themselves. Reuses the
  // same shown-once panel as an invite.
  const resetPassword = async (u: TeamUser) => {
    if (!confirm(`Issue a new temporary password for ${u.name}? Their current one stops working.`)) {
      return;
    }
    try {
      const res = await api<{ tempPassword: string }>(`/api/tenant/users/${u.id}/reset-password`, {
        method: 'POST',
        json: {},
      });
      setTempPassword(res.tempPassword);
      toast(`New password issued for ${u.email}`);
    } catch (err) {
      toast(err instanceof Error ? err.message : 'reset failed');
    }
  };

  return (
    <section className="card stack">
      <h3>Team</h3>
      <table className="data">
        <thead>
          <tr>
            <th>Name</th>
            <th>Email</th>
            <th>Role</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {users.map((u) => (
            <tr key={u.id}>
              <td>{u.name}</td>
              <td>{u.email}</td>
              <td>{u.role}</td>
              <td>
                <div className="row-actions">
                  {u.role === 'viewer' && (
                    <button className="small" onClick={() => setConfigFor(u)}>
                      View config
                    </button>
                  )}
                  <button className="small" onClick={() => resetPassword(u)}>
                    Reset password
                  </button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="row" style={{ alignItems: 'flex-end' }}>
        <label style={{ flex: 1 }}>
          Name
          <input value={invite.name} onChange={(e) => setInvite((p) => ({ ...p, name: e.target.value }))} />
        </label>
        <label style={{ flex: 1 }}>
          Email
          <input value={invite.email} onChange={(e) => setInvite((p) => ({ ...p, email: e.target.value }))} />
        </label>
        <label>
          Role
          <select
            value={invite.role}
            style={{ width: 'auto' }}
            onChange={(e) => setInvite((p) => ({ ...p, role: e.target.value as 'viewer' | 'account_admin' }))}
          >
            <option value="viewer">Viewer</option>
            <option value="account_admin">Admin</option>
          </select>
        </label>
        <button className="primary" onClick={sendInvite}>
          Invite
        </button>
      </div>
      {tempPassword && (
        <div className="card stack" style={{ borderColor: 'var(--amber)' }}>
          <p className="muted" style={{ fontSize: 13 }}>
            Temp password — share it with the new user. Shown only once.
          </p>
          <CodeBox label="Temporary password" hint="Copy and share securely." code={tempPassword} defaultOpen />
          <button className="small" onClick={() => setTempPassword(null)}>
            I saved it
          </button>
        </div>
      )}

      {configFor && <ViewConfigEditor user={configFor} onClose={() => { setConfigFor(null); load(); }} toast={toast} />}
    </section>
  );
}

function ViewConfigEditor({ user, onClose, toast }: { user: TeamUser; onClose: () => void; toast: (s: string) => void }) {
  const existing = user.view_config_json ? JSON.parse(user.view_config_json) : { tabs: ['performance'], months: 'all', channels: 'all' };
  // Present and Data and Team are never offered. KPIs and Goals are
  // hidden from the nav entirely right now, see CLIENT_SECTIONS in
  // AppShell.tsx. Keys are storage names; labels match the client
  // profile nav.
  const grantable = [
    { key: 'performance', label: 'Main Dashboard' },
    { key: 'meta', label: 'Meta' },
    { key: 'google', label: 'Google Ads' },
  ];
  const [tabs, setTabs] = useState<string[]>(existing.tabs ?? ['performance']);
  const [monthsText, setMonthsText] = useState(existing.months === 'all' ? '' : (existing.months ?? []).join(', '));
  const [channelsText, setChannelsText] = useState(existing.channels === 'all' ? '' : (existing.channels ?? []).join(', '));

  const save = async () => {
    const viewConfig = {
      tabs,
      months: monthsText.trim() ? monthsText.split(',').map((s: string) => s.trim()) : 'all',
      channels: channelsText.trim() ? channelsText.split(',').map((s: string) => s.trim()) : 'all',
    };
    await api(`/api/tenant/users/${user.id}/view-config`, { method: 'PUT', json: { viewConfig } });
    toast('View config saved');
    onClose();
  };

  return (
    <div className="card stack" style={{ borderColor: 'var(--accent)' }}>
      <h3>View config for {user.name}</h3>
      <div className="row">
        {grantable.map((t) => (
          <label key={t.key} className="row" style={{ gap: 4, width: 'auto' }}>
            <input
              type="checkbox"
              style={{ minHeight: 20, width: 20 }}
              checked={tabs.includes(t.key)}
              onChange={(e) => setTabs((prev) => (e.target.checked ? [...prev, t.key] : prev.filter((x) => x !== t.key)))}
            />
            {t.label}
          </label>
        ))}
      </div>
      <label>
        Allowed months (comma separated YYYY-MM, blank for all)
        <input value={monthsText} onChange={(e) => setMonthsText(e.target.value)} />
      </label>
      <label>
        Allowed channels (comma separated, blank for all)
        <input value={channelsText} onChange={(e) => setChannelsText(e.target.value)} />
      </label>
      <div className="row">
        <button className="primary" onClick={save}>
          Save
        </button>
        <button onClick={onClose}>Cancel</button>
      </div>
    </div>
  );
}

// What this client's dashboard is for.
//
// The platform started as marketing attribution, so every client inherited
// spend, channels, Meta and Google. A door to door client runs none of
// that: showing them an empty Meta section and a spend KPI of zero
// describes somebody else's business. This is the switch.
const SECTION_CHOICES: Array<{ key: string; label: string; note: string }> = [
  { key: 'performance', label: 'Main Dashboard', note: 'Spend, leads and revenue across channels' },
  { key: 'field', label: 'Door to Door', note: 'Knocks, outcomes and rep leaderboard' },
  { key: 'meta', label: 'Meta', note: 'Meta campaigns and ads' },
  { key: 'google', label: 'Google Ads', note: 'Google campaigns and ads' },
  { key: 'present', label: 'Present', note: 'Internal, client presentation view' },
];

const PRESETS: Array<{ label: string; sections: string[] }> = [
  { label: 'Ads client', sections: ['performance', 'meta', 'google', 'present', 'data-team'] },
  { label: 'Door to door client', sections: ['field', 'present', 'data-team'] },
  { label: 'Both', sections: ['performance', 'field', 'meta', 'google', 'present', 'data-team'] },
];

function SectionsSection({
  settings,
  toast,
  refreshSettings,
}: {
  settings: TenantSettings;
  toast: (s: string) => void;
  refreshSettings: () => void;
}) {
  const [chosen, setChosen] = useState<string[]>(
    settings.tenant.sections ?? ['performance', 'meta', 'google', 'present', 'data-team']
  );
  const [busy, setBusy] = useState(false);

  const toggle = (key: string) =>
    setChosen((current) =>
      current.includes(key) ? current.filter((k) => k !== key) : [...current, key]
    );

  const save = async (sections: string[]) => {
    setBusy(true);
    try {
      // Data and Team is always reachable, since it is where this very
      // setting lives. Sending it keeps the stored list honest about what
      // the client actually has.
      const payload = sections.includes('data-team') ? sections : [...sections, 'data-team'];
      await api('/api/tenant/settings/sections', { method: 'PUT', json: { sections: payload } });
      setChosen(payload);
      toast('Dashboard sections saved');
      refreshSettings();
    } catch (err) {
      toast(err instanceof Error ? err.message : 'could not save');
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="card stack">
      <h3>What this client&apos;s dashboard shows</h3>
      <p className="muted" style={{ margin: 0, maxWidth: 640 }}>
        Hide the sections this client does not run. A door to door client has no ad accounts, so
        spend and channel reporting describe a business that is not theirs.
      </p>

      <div className="type-filters">
        {PRESETS.map((p) => (
          <button key={p.label} disabled={busy} onClick={() => void save(p.sections)}>
            {p.label}
          </button>
        ))}
      </div>

      <div className="stack" style={{ gap: 8 }}>
        {SECTION_CHOICES.map((choice) => (
          <label key={choice.key} className="row" style={{ gap: 10, alignItems: 'flex-start' }}>
            <input
              type="checkbox"
              style={{ width: 18, minHeight: 18, marginTop: 3 }}
              checked={chosen.includes(choice.key)}
              onChange={() => toggle(choice.key)}
            />
            <span>
              <strong>{choice.label}</strong>
              <br />
              <span className="muted" style={{ fontSize: 12.5 }}>
                {choice.note}
              </span>
            </span>
          </label>
        ))}
      </div>

      <button
        className="primary"
        style={{ alignSelf: 'flex-start' }}
        disabled={busy || chosen.length === 0}
        onClick={() => void save(chosen)}
      >
        {busy ? 'Saving' : 'Save sections'}
      </button>
    </section>
  );
}

function TargetsSection({ labels, toast }: { labels: FunnelLabels; toast: (s: string) => void }) {
  const [month, setMonth] = useState(new Date().toISOString().slice(0, 7));
  const [values, setValues] = useState<Record<string, string>>({});

  useEffect(() => {
    api<{ targets: Array<{ metric: string; value: number }> }>(`/api/tenant/targets/${month}`)
      .then((r) => setValues(Object.fromEntries(r.targets.map((t) => [t.metric, String(t.value)]))))
      .catch(() => setValues({}));
  }, [month]);

  const metrics = [
    { key: 'leads', label: labels.lead },
    { key: 'scheduled', label: labels.scheduled },
    { key: 'completed', label: labels.completed },
    { key: 'revenue', label: 'Revenue' },
    { key: 'spend', label: 'Spend budget' },
  ];

  const save = async () => {
    const targets: Record<string, number> = {};
    for (const [k, v] of Object.entries(values)) {
      if (v.trim()) targets[k] = Number(v);
    }
    await api('/api/tenant/targets', { method: 'PUT', json: { month, targets } });
    toast('Targets saved');
  };

  return (
    <section className="card stack">
      <h3>Targets</h3>
      <label>
        Month
        <input type="month" value={month} onChange={(e) => setMonth(e.target.value)} style={{ maxWidth: 200 }} />
      </label>
      <div className="kpi-grid">
        {metrics.map((m) => (
          <label key={m.key} className="kpi" style={{ display: 'block' }}>
            <div className="label">{m.label}</div>
            <input
              type="number"
              value={values[m.key] ?? ''}
              onChange={(e) => setValues((p) => ({ ...p, [m.key]: e.target.value }))}
            />
          </label>
        ))}
      </div>
      <button className="primary" style={{ alignSelf: 'flex-start' }} onClick={save}>
        Save targets
      </button>
    </section>
  );
}

// Agency admin only: this client's committed ad spend budget and platform
// mix, moved here from the Clients roster so that list can stay a plain
// selection list instead of a dashboard.
function ClientBudgetSection({ tenantId }: { tenantId: string }) {
  const [tenant, setTenant] = useState<TenantCard | null>(null);

  const load = useCallback(() => {
    api<{ tenants: TenantCard[] }>('/api/agency/overview')
      .then((r) => setTenant(r.tenants.find((t) => t.id === tenantId) ?? null))
      .catch(() => undefined);
  }, [tenantId]);

  useEffect(load, [load]);

  if (!tenant) return null;

  const budget = tenant.monthly_ad_spend_budget;
  const pacePct = budget && budget > 0 ? ((tenant.spend ?? 0) / budget) * 100 : null;
  const paceState = pacePct === null ? null : pacePct >= 100 ? 'under' : pacePct >= 85 ? 'watch' : 'top';

  return (
    <section className="card stack">
      <h3>Ad budget</h3>
      <div className="stack" style={{ gap: 4 }}>
        <div className="row" style={{ justifyContent: 'space-between', fontSize: 13 }}>
          <span className="muted">Ad spend this month</span>
          <span className="num">
            {fmtMoney(tenant.spend ?? 0)}
            {budget ? ` of ${fmtMoney(budget)} budget` : ''}
          </span>
        </div>
        {budget && pacePct !== null && (
          <div className="pacing-bar">
            <div className={`pacing-fill ${paceState}`} style={{ width: `${Math.min(100, pacePct)}%` }} />
          </div>
        )}
        {!budget && <span className="muted" style={{ fontSize: 12 }}>No budget set yet</span>}
      </div>
      <BudgetForm tenant={tenant} onSaved={load} />
    </section>
  );
}

function SettingsSection({
  settings,
  labels,
  toast,
  isAgency,
  refreshSettings,
}: {
  settings: TenantSettings;
  labels: FunnelLabels;
  toast: (s: string) => void;
  isAgency: boolean;
  refreshSettings: () => void;
}) {
  // An unbranded tenant reports no theme at all (see the settings route), so
  // the editor seeds from the defaults it would otherwise be saving. Without
  // this every swatch opens on black and one save would write that.
  const theme = settings.tenant.theme ?? {};
  const [tokens, setTokens] = useState<Record<string, string>>({
    ...DEFAULT_THEME_TOKENS,
    ...(theme as Record<string, string>),
  });
  const [labelDraft, setLabelDraft] = useState<FunnelLabels>(labels);
  const [tzDraft, setTzDraft] = useState(settings.tenant.timezone);
  const [mode, setMode] = useState<ThemeMode>('light');
  useEffect(() => setMode(getThemeMode()), []);
  const setThemeMode = (m: ThemeMode) => {
    applyThemeMode(m);
    setMode(m);
  };
  const [domain, setDomain] = useState('');
  const [domainStatus, setDomainStatus] = useState<{ hostname: string | null; status?: string; cnameTarget?: string; txt?: { name: string; value: string } | null } | null>(null);
  const [footerCredit, setFooterCredit] = useState(settings.tenant.footerCredit);

  useEffect(() => {
    api<typeof domainStatus & object>('/api/tenant/settings/custom-domain').then((r) => setDomainStatus(r as never)).catch(() => undefined);
  }, []);

  const colorKeys = [
    'paper', 'card', 'ink', 'inkSoft', 'hairline', 'accent', 'accentSoft', 'positive', 'negative',
    'amber', 'verifiedGreen', 'grayCheck', 'redCheck', 'channelGoogle', 'channelMeta', 'channelWebsite',
  ];

  const saveTheme = async () => {
    const full = { ...DEFAULT_THEME_TOKENS, ...tokens };
    await api('/api/tenant/settings/theme', { method: 'PUT', json: full });
    toast('Theme saved');
    refreshSettings();
  };

  const saveLabels = async () => {
    await api('/api/tenant/settings/funnel-labels', { method: 'PUT', json: labelDraft });
    toast('Funnel labels saved');
    refreshSettings();
  };

  const saveTimezone = async () => {
    try {
      await api('/api/tenant/settings/timezone', { method: 'PUT', json: { timezone: tzDraft.trim() } });
      toast('Timezone saved');
      refreshSettings();
    } catch (err) {
      // The API's 400 body names why it was rejected; the bare message is
      // just "invalid timezone", which does not help anyone fix it.
      const detail =
        err instanceof ApiError
          ? ((err.body.details as { fieldErrors?: Record<string, string[]> } | undefined)?.fieldErrors
              ?.timezone?.[0] ?? err.message)
          : err instanceof Error
            ? err.message
            : 'save failed';
      toast(detail);
    }
  };

  // The api helper does not handle binary bodies; the logo goes raw.
  const uploadLogo = async (file: File) => {
    if (isDemoMode()) {
      toast('Preview demo mode: uploads are disabled');
      return;
    }
    const res = await fetch('/api/tenant/settings/logo', {
      method: 'PUT',
      headers: { 'content-type': file.type, 'x-csrf-token': getCsrf() ?? '' },
      body: file,
      credentials: 'same-origin',
    });
    if (res.ok) {
      toast('Logo uploaded');
      refreshSettings();
    } else {
      toast('Logo upload failed');
    }
  };

  const requestDomain = async () => {
    try {
      const res = await api<{ status: string; cnameTarget: string; txt: { name: string; value: string } | null }>(
        '/api/tenant/settings/custom-domain',
        { method: 'POST', json: { hostname: domain } }
      );
      setDomainStatus({ hostname: domain, ...res });
      toast('Custom hostname requested');
    } catch (err) {
      toast(err instanceof Error ? err.message : 'request failed');
    }
  };

  const pollDomain = async () => {
    const res = await api<NonNullable<typeof domainStatus>>('/api/tenant/settings/custom-domain');
    setDomainStatus(res);
  };

  return (
    <section className="card stack">
      <h3>Settings</h3>

      <div className="stack">
        <h3 style={{ fontSize: 16 }}>Appearance</h3>
        <p className="muted" style={{ fontSize: 13 }}>
          Choose a light or dark interface. This is personal to you and saved on this device.
        </p>
        <div className="row" style={{ gap: 8 }}>
          <button className={mode === 'light' ? 'primary small' : 'small'} onClick={() => setThemeMode('light')}>
            ☀ Light
          </button>
          <button className={mode === 'dark' ? 'primary small' : 'small'} onClick={() => setThemeMode('dark')}>
            🌙 Dark
          </button>
        </div>
      </div>

      <div className="stack">
        <h3 style={{ fontSize: 16 }}>Logo</h3>
        <p className="muted" style={{ fontSize: 13 }}>
          Rendered top left. For tall or emblem logos, set a text wordmark below; the full logo is reserved
          for the footer.
        </p>
        <input type="file" accept="image/png,image/jpeg,image/svg+xml,image/webp" onChange={(e) => e.target.files?.[0] && uploadLogo(e.target.files[0])} />
        <label>
          Wordmark (text fallback for the nav)
          <input
            value={tokens.wordmark ?? ''}
            onChange={(e) => setTokens((p) => ({ ...p, wordmark: e.target.value }))}
          />
        </label>
      </div>

      <div className="stack">
        <h3 style={{ fontSize: 16 }}>Theme</h3>
        <div className="kpi-grid">
          {colorKeys.map((key) => (
            <label key={key} className="row" style={{ gap: 8 }}>
              <input
                type="color"
                style={{ width: 44, minHeight: 36, padding: 2 }}
                value={(tokens[key] as string) ?? '#000000'}
                onChange={(e) => setTokens((p) => ({ ...p, [key]: e.target.value }))}
              />
              <span style={{ fontSize: 13 }}>{key}</span>
            </label>
          ))}
        </div>
        <label>
          Custom CSS (scoped to your dashboard)
          <textarea
            value={tokens.customCss ?? ''}
            onChange={(e) => setTokens((p) => ({ ...p, customCss: e.target.value }))}
          />
        </label>
        <button className="primary" style={{ alignSelf: 'flex-start' }} onClick={saveTheme}>
          Save theme
        </button>
      </div>

      {/* Dates across this client's dashboard are formatted in this zone. It
          is validated on save: an unresolvable value used to be accepted and
          then crashed every page that rendered a date. */}
      <div className="stack">
        <h3 style={{ fontSize: 16 }}>Timezone</h3>
        <div className="row" style={{ alignItems: 'flex-end' }}>
          <label style={{ flex: 1 }}>
            IANA name
            <input
              value={tzDraft}
              list="tz-suggestions"
              placeholder="America/Los_Angeles"
              onChange={(e) => setTzDraft(e.target.value)}
            />
          </label>
          <button className="primary" onClick={saveTimezone}>
            Save timezone
          </button>
        </div>
        <datalist id="tz-suggestions">
          {[
            'America/Los_Angeles',
            'America/Denver',
            'America/Phoenix',
            'America/Chicago',
            'America/New_York',
            'UTC',
          ].map((tz) => (
            <option key={tz} value={tz} />
          ))}
        </datalist>
      </div>

      <div className="stack">
        <h3 style={{ fontSize: 16 }}>Funnel labels</h3>
        <div className="kpi-grid">
          {(['lead', 'scheduled', 'completed', 'purchase'] as const).map((stage) => (
            <label key={stage}>
              {stage}
              <input
                value={labelDraft[stage]}
                onChange={(e) => setLabelDraft((p) => ({ ...p, [stage]: e.target.value }))}
              />
            </label>
          ))}
        </div>
        <button className="primary" style={{ alignSelf: 'flex-start' }} onClick={saveLabels}>
          Save labels
        </button>
      </div>

      <div className="stack">
        <h3 style={{ fontSize: 16 }}>Custom domain</h3>
        {settings.tenant.plan !== 'whitelabel' ? (
          <p className="muted">Custom domains are part of the whitelabel plan.</p>
        ) : (
          <>
            {domainStatus?.hostname ? (
              <div className="stack" style={{ gap: 6 }}>
                <p>
                  <b>{domainStatus.hostname}</b>: {domainStatus.status}
                </p>
                {domainStatus.status !== 'active' && (
                  <>
                    <p style={{ fontSize: 13 }}>Add these DNS records at your domain provider:</p>
                    <CodeBox
                      label="DNS records"
                      hint="Hand these to whoever manages your domain."
                      defaultOpen
                      code={[
                        `CNAME  ${domainStatus.hostname}  ->  ${domainStatus.cnameTarget}`,
                        domainStatus.txt ? `TXT    ${domainStatus.txt.name}  =  ${domainStatus.txt.value}` : '',
                      ]
                        .filter(Boolean)
                        .join('\n')}
                    />
                    <button className="small" onClick={pollDomain}>
                      Check status
                    </button>
                  </>
                )}
              </div>
            ) : (
              <div className="row" style={{ alignItems: 'flex-end' }}>
                <label style={{ flex: 1 }}>
                  Domain (for example bi.yourcompany.com)
                  <input value={domain} onChange={(e) => setDomain(e.target.value)} />
                </label>
                <button className="primary" onClick={requestDomain}>
                  Set up
                </button>
              </div>
            )}
          </>
        )}
      </div>

      {isAgency && (
        <div className="stack">
          <h3 style={{ fontSize: 16 }}>Agency</h3>
          <label className="row" style={{ gap: 8 }}>
            <input
              type="checkbox"
              style={{ minHeight: 20, width: 20 }}
              checked={footerCredit}
              onChange={async (e) => {
                setFooterCredit(e.target.checked);
                await api('/api/tenant/settings/footer-credit', { method: 'PUT', json: { footerCredit: e.target.checked } });
                toast('Footer credit updated');
                refreshSettings();
              }}
            />
            Show Managed by Stopply footer credit
          </label>
        </div>
      )}
    </section>
  );
}
