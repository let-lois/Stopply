'use client';

// Door to door reporting: what the crew did, who did it, and what came of
// it. Reads entirely from what reps logged in the field app, so this is the
// other half of that build rather than a separate data source.
//
// The section is only rendered for clients that actually knock doors, which
// AppShell decides by asking whether the tenant has any reps on its roster.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '@/lib/api';
import { fmtNum, fmtPct, fmtStamp } from '@/lib/format';
import { useToast } from '../Toasts';
import { CodeBox } from '../CodeBox';

// Applies pending tenant migrations from the console.
//
// The Worker holds the account API token, so this needs no terminal and no
// checkout. Agency admins only: it changes a client's database schema.
function MigrateButton({ onDone }: { onDone: () => void }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [tenantId, setTenantId] = useState<string | null>(null);

  useEffect(() => {
    api<{ tenant: { id: string } }>('/api/tenant/settings')
      .then((s) => setTenantId(s.tenant.id))
      .catch(() => undefined);
  }, []);

  const run = async () => {
    if (!tenantId) return;
    setBusy(true);
    try {
      const res = await api<{ applied: number }>(`/api/agency/tenants/${tenantId}/migrate`, {
        method: 'POST',
        json: {},
      });
      toast(res.applied > 0 ? 'Database updated' : 'Already up to date');
      onDone();
    } catch (err) {
      toast(
        err instanceof Error && err.message === 'forbidden'
          ? 'An agency admin has to run this'
          : err instanceof Error
            ? err.message
            : 'the migration did not run'
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="stack" style={{ gap: 8, alignItems: 'flex-start' }}>
      <button className="primary" disabled={busy || !tenantId} onClick={() => void run()}>
        {busy ? 'Setting up' : 'Set up field tracking for this client'}
      </button>
      <details className="disclosure">
        <summary>Or run it from a terminal</summary>
        <CodeBox
          code="CONTROL_DB_ID=... CF_API_TOKEN=... CF_ACCOUNT_ID=... pnpm migrate:tenants"
          label="Migration command"
          hint="Applies pending migrations to every client database."
        />
      </details>
    </div>
  );
}

interface Totals {
  visits: number;
  doors: number;
  contacts: number;
  leads: number;
  appointments: number;
  sales: number;
  contactRate: number;
  leadRate: number;
  closeRate: number;
  knocksPerSale: number | null;
}

interface RepRow extends Totals {
  repId: string;
  repName: string;
  activeDays: number;
}

interface DispositionRow {
  key: string;
  label: string;
  color: string | null;
  count: number;
  share: number;
}

interface DayPoint {
  day: string;
  visits: number;
  contacts: number;
  appointments: number;
  sales: number;
}

interface Overview {
  // False when this client's database has not had the field tracking
  // migration applied yet. Distinct from "no activity": one is waiting on
  // an ops step, the other is waiting on a rep.
  ready?: boolean;
  range: { from: string; to: string };
  timezone: string;
  totals: Totals;
  reps: RepRow[];
  dispositions: DispositionRow[];
  daily: DayPoint[];
}

interface VisitRow {
  id: string;
  repName: string | null;
  address: string;
  disposition: string;
  notes: string | null;
  contactName: string | null;
  contactPhone: string | null;
  occurredAt: string;
  followUpAt: string | null;
  doNotKnock: boolean;
}

interface RepRecord {
  id: string;
  email: string;
  name: string;
  phone: string | null;
  role: 'rep' | 'manager';
  team: string | null;
  active: number;
  last_login_at: string | null;
}

const PRESETS: Array<{ label: string; days: number }> = [
  { label: '7 days', days: 7 },
  { label: '30 days', days: 30 },
  { label: '90 days', days: 90 },
];

function isoDay(offsetDays = 0): string {
  return new Date(Date.now() - offsetDays * 86400000).toISOString().slice(0, 10);
}

export function FieldActivityTab({ canWrite, timezone }: { canWrite: boolean; timezone?: string }) {
  const [days, setDays] = useState(30);
  const [overview, setOverview] = useState<Overview | null>(null);
  const [visits, setVisits] = useState<VisitRow[] | null>(null);
  const [reps, setReps] = useState<RepRecord[] | null>(null);
  const [repFilter, setRepFilter] = useState('');
  const [showRoster, setShowRoster] = useState(false);
  const [fieldAppUrl, setFieldAppUrl] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const range = useMemo(() => ({ from: isoDay(days - 1), to: isoDay(0) }), [days]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const query = `from=${range.from}&to=${range.to}${repFilter ? `&repId=${encodeURIComponent(repFilter)}` : ''}`;
    try {
      const [o, v] = await Promise.all([
        api<Overview>(`/api/tenant/field/overview?${query}`),
        api<{ visits: VisitRow[] }>(`/api/tenant/field/visits?${query}&limit=200`),
      ]);
      setOverview(o);
      setVisits(v.visits);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'could not load field activity');
    } finally {
      setLoading(false);
    }
  }, [range.from, range.to, repFilter]);

  useEffect(() => {
    void load();
  }, [load]);

  const loadReps = useCallback(() => {
    api<{ reps: RepRecord[]; fieldAppUrl: string }>('/api/tenant/field/reps')
      .then((r) => {
        setReps(r.reps);
        setFieldAppUrl(r.fieldAppUrl);
      })
      .catch(() => setReps([]));
  }, []);

  useEffect(loadReps, [loadReps]);

  const t = overview?.totals;

  // This client's database predates the field tables. Nothing here can work
  // until the tenant migration runs, and saying so beats a bare error: the
  // person reading this is the one who can get it run.
  if (overview && overview.ready === false) {
    return (
      <div className="card stack">
        <h3 className="section-title">Not set up on this client yet</h3>
        <p className="muted" style={{ margin: 0, maxWidth: 640 }}>
          Door to door tracking is deployed, but this client&apos;s database has not had the
          field tables created yet. That is a one time migration an agency admin runs, after
          which reps can be added here.
        </p>
        <MigrateButton onDone={() => window.location.reload()} />
      </div>
    );
  }

  if (error) return <p className="delta-down">{error}</p>;

  // No crew yet. Rather than an empty funnel of zeros, this explains what
  // the section is and gives the one action that starts it. Reporting has
  // nothing to say until somebody has knocked a door.
  if (reps !== null && reps.length === 0) {
    return (
      <div className="stack">
        <div className="card stack">
          <h3 className="section-title">No field crew yet</h3>
          <p className="muted" style={{ margin: 0, maxWidth: 620 }}>
            Add a rep and this section fills with their door to door activity: knocks,
            conversations, appointments and sales, a leaderboard, and the full visit log.
          </p>
          <FieldAppLink url={fieldAppUrl} />
          {canWrite ? (
            <button className="primary" style={{ alignSelf: 'flex-start' }} onClick={() => setShowRoster(true)}>
              Add your first rep
            </button>
          ) : (
            <p className="muted" style={{ margin: 0 }}>
              An account admin adds reps from Data and Team.
            </p>
          )}
        </div>
        {canWrite && showRoster && <Roster reps={reps} fieldAppUrl={fieldAppUrl} onChanged={loadReps} />}
      </div>
    );
  }

  return (
    <div className="stack">
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
        <div className="type-filters">
          {PRESETS.map((p) => (
            <button
              key={p.days}
              className={days === p.days ? 'active' : ''}
              onClick={() => setDays(p.days)}
            >
              {p.label}
            </button>
          ))}
        </div>
        <div className="row" style={{ gap: 8, alignItems: 'center' }}>
          <select
            className="small"
            value={repFilter}
            onChange={(e) => setRepFilter(e.target.value)}
            aria-label="Filter by rep"
          >
            <option value="">All reps</option>
            {(reps ?? []).map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </select>
          <a
            className="button small"
            href={`/api/tenant/field/visits.csv?from=${range.from}&to=${range.to}${repFilter ? `&repId=${encodeURIComponent(repFilter)}` : ''}`}
          >
            Export CSV
          </a>
          {canWrite && (
            <button className="small" onClick={() => setShowRoster((v) => !v)}>
              {showRoster ? 'Hide reps' : 'Manage reps'}
            </button>
          )}
        </div>
      </div>

      {loading && !overview && <div className="skeleton" style={{ minHeight: 160 }} />}

      <SampleBanner />

      {t && (
        <>
          <div className="kpi-grid">
            <Kpi label="Knocks" value={fmtNum(t.visits)} note={`${fmtNum(t.doors)} doors`} />
            <Kpi
              label="Conversations"
              value={fmtNum(t.contacts)}
              note={`${fmtPct(t.contactRate)} of knocks answered`}
            />
            <Kpi
              label="Appointments"
              value={fmtNum(t.appointments)}
              note={`${fmtPct(t.leadRate)} of conversations became leads`}
            />
            <Kpi
              label="Sales"
              value={fmtNum(t.sales)}
              note={
                t.knocksPerSale !== null
                  ? `${fmtNum(Math.round(t.knocksPerSale))} knocks per sale`
                  : 'no closes in this range'
              }
            />
          </div>

          {t.visits === 0 && (
            <div className="card stack">
              <p className="muted" style={{ margin: 0 }}>
                No door to door activity logged in this range.
              </p>
              <FieldAppLink url={fieldAppUrl} />
            </div>
          )}

          {overview.daily.length > 0 && t.visits > 0 && (
            <div className="card stack">
              <h3 className="section-title">Daily activity</h3>
              <DailyChart points={overview.daily} timezone={overview.timezone} />
            </div>
          )}

          {overview.reps.length > 0 && (
            <div className="card stack">
              <h3 className="section-title">Rep leaderboard</h3>
              <div style={{ overflowX: 'auto' }}>
                <table className="data">
                  <thead>
                    <tr>
                      <th>Rep</th>
                      <th className="num">Days</th>
                      <th className="num">Knocks</th>
                      <th className="num">Doors</th>
                      <th className="num">Conversations</th>
                      <th className="num">Contact rate</th>
                      <th className="num">Appointments</th>
                      <th className="num">Sales</th>
                      <th className="num">Close rate</th>
                    </tr>
                  </thead>
                  <tbody>
                    {overview.reps.map((r) => (
                      <tr key={r.repId}>
                        <td>{r.repName}</td>
                        <td className="num">{fmtNum(r.activeDays)}</td>
                        <td className="num">{fmtNum(r.visits)}</td>
                        <td className="num">{fmtNum(r.doors)}</td>
                        <td className="num">{fmtNum(r.contacts)}</td>
                        <td className="num">{fmtPct(r.contactRate)}</td>
                        <td className="num">{fmtNum(r.appointments)}</td>
                        <td className="num">{fmtNum(r.sales)}</td>
                        <td className="num">{fmtPct(r.closeRate)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {overview.dispositions.length > 0 && (
            <div className="card stack">
              <h3 className="section-title">Outcomes</h3>
              <div className="field-outcome-bar">
                {overview.dispositions.map((d) => (
                  <span
                    key={d.key}
                    className="field-outcome-seg"
                    style={{ width: `${d.share * 100}%`, background: d.color ?? 'var(--ink-soft)' }}
                    title={`${d.label}: ${fmtNum(d.count)}`}
                  />
                ))}
              </div>
              <div className="field-outcome-legend">
                {overview.dispositions.map((d) => (
                  <span key={d.key}>
                    <i style={{ background: d.color ?? 'var(--ink-soft)' }} />
                    {d.label} <strong>{fmtNum(d.count)}</strong>{' '}
                    <span className="muted">{fmtPct(d.share)}</span>
                  </span>
                ))}
              </div>
            </div>
          )}
        </>
      )}

      {canWrite && showRoster && <Roster reps={reps} fieldAppUrl={fieldAppUrl} onChanged={loadReps} />}

      {visits && visits.length > 0 && (
        <div className="card stack">
          <h3 className="section-title">Visit log</h3>
          <div style={{ overflowX: 'auto' }}>
            <table className="data">
              <thead>
                <tr>
                  <th>When</th>
                  <th>Rep</th>
                  <th>Address</th>
                  <th>Outcome</th>
                  <th>Contact</th>
                  <th>Notes</th>
                </tr>
              </thead>
              <tbody>
                {visits.map((v) => (
                  <tr key={v.id}>
                    <td>{fmtStamp(v.occurredAt, timezone)}</td>
                    <td>{v.repName ?? 'Unknown'}</td>
                    <td>
                      {v.address}
                      {v.doNotKnock && (
                        <>
                          {' '}
                          <span className="status-word status-word-under">do not knock</span>
                        </>
                      )}
                    </td>
                    <td>{labelFor(overview, v.disposition)}</td>
                    <td>
                      {v.contactName ?? ''}
                      {v.contactPhone ? ` · ${v.contactPhone}` : ''}
                    </td>
                    <td className="muted">{v.notes ?? ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {visits.length >= 200 && (
            <p className="muted" style={{ margin: 0 }}>
              Showing the 200 most recent visits in this range. Export the CSV for the full log.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function labelFor(overview: Overview | null, key: string): string {
  return overview?.dispositions.find((d) => d.key === key)?.label ?? key;
}

function Kpi({ label, value, note }: { label: string; value: string; note: string }) {
  return (
    <div className="kpi">
      <span className="label">{label}</span>
      <span className="value num">{value}</span>
      <span className="muted" style={{ fontSize: 12 }}>
        {note}
      </span>
    </div>
  );
}

// Deliberately a plain stacked bar rather than a charting library: it is
// four series over at most 90 points, and the static export has no room for
// a dependency this small a job.
function DailyChart({ points, timezone }: { points: DayPoint[]; timezone: string }) {
  const peak = Math.max(1, ...points.map((p) => p.visits));
  return (
    <div className="field-daily">
      {points.map((p) => (
        <div className="field-daily-col" key={p.day} title={dayTitle(p, timezone)}>
          <div className="field-daily-stack" style={{ height: `${(p.visits / peak) * 100}%` }}>
            <span
              className="field-daily-seg field-daily-sales"
              style={{ height: pctOf(p.sales, p.visits) }}
            />
            <span
              className="field-daily-seg field-daily-appts"
              style={{ height: pctOf(p.appointments - p.sales, p.visits) }}
            />
            <span
              className="field-daily-seg field-daily-contacts"
              style={{ height: pctOf(p.contacts - p.appointments, p.visits) }}
            />
            <span
              className="field-daily-seg field-daily-knocks"
              style={{ height: pctOf(p.visits - p.contacts, p.visits) }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

function pctOf(part: number, whole: number): string {
  if (whole <= 0) return '0%';
  return `${Math.max(0, (part / whole) * 100)}%`;
}

function dayTitle(p: DayPoint, timezone: string): string {
  return `${p.day} (${timezone}): ${p.visits} knocks, ${p.contacts} conversations, ${p.appointments} appointments, ${p.sales} sales`;
}

// The roster as its own card for the Data and Team setup area.
//
// It lives there as well as here for a reason that is not cosmetic: the
// client-facing Door to Door section only appears once a client has a crew,
// so without a home in the always-available setup area there would be no
// way to add the first rep.
export function FieldRepsSection({ onRosterChanged }: { onRosterChanged?: () => void }) {
  const [reps, setReps] = useState<RepRecord[] | null>(null);
  const [fieldAppUrl, setFieldAppUrl] = useState('');

  const load = useCallback(() => {
    api<{ reps: RepRecord[]; fieldAppUrl: string }>('/api/tenant/field/reps')
      .then((r) => {
        setReps(r.reps);
        setFieldAppUrl(r.fieldAppUrl);
      })
      // A tenant database provisioned before the field tables existed has
      // no roster to read. An empty crew is the honest answer.
      .catch(() => setReps([]));
  }, []);

  useEffect(load, [load]);

  return (
    <Roster
      reps={reps}
      fieldAppUrl={fieldAppUrl}
      onChanged={() => {
        load();
        onRosterChanged?.();
      }}
    />
  );
}

// Says so, plainly, whenever what is on screen is a demonstration. A
// client mistaking fabricated activity for their own crew's is the only
// real harm sample data can do.
function SampleBanner() {
  const [state, setState] = useState<{ sampleVisits: number } | null>(null);
  useEffect(() => {
    api<{ sampleVisits: number }>('/api/tenant/field/sample')
      .then(setState)
      .catch(() => setState(null));
  }, []);
  if (!state || state.sampleVisits === 0) return null;
  return (
    <div className="field-sample-note">
      Showing sample data. These knocks were generated to demonstrate the reporting and are not
      your crew&apos;s work. Remove them from Data and Team.
    </div>
  );
}

// Sample activity: load it to show the reporting working before a crew
// exists, remove it when the real knocks start.
//
// The removal only ever matches rows flagged is_sample in the database, so
// it cannot reach a real rep's day. The banner exists because the opposite
// mistake is the dangerous one: a client reading fabricated numbers as
// their own.
export function SampleDataControls({ onChanged }: { onChanged?: () => void }) {
  const toast = useToast();
  const [state, setState] = useState<{ ready: boolean; sampleVisits: number; realVisits: number } | null>(
    null
  );
  const [busy, setBusy] = useState(false);
  const [issued, setIssued] = useState<{ samplePassword: string; sampleEmails: string[] } | null>(null);

  const load = useCallback(() => {
    api<{ ready: boolean; sampleVisits: number; realVisits: number }>('/api/tenant/field/sample')
      .then(setState)
      .catch(() => setState(null));
  }, []);

  useEffect(load, [load]);

  const run = async (action: 'load' | 'clear') => {
    setBusy(true);
    try {
      if (action === 'load') {
        const res = await api<{ visits: number; samplePassword: string; sampleEmails: string[] }>(
          '/api/tenant/field/sample',
          { method: 'POST', json: { days: 30 } }
        );
        setIssued({ samplePassword: res.samplePassword, sampleEmails: res.sampleEmails });
        toast(`Loaded ${res.visits.toLocaleString('en-US')} sample knocks`);
      } else {
        await api('/api/tenant/field/sample', { method: 'DELETE' });
        setIssued(null);
        toast('Sample data removed');
      }
      load();
      onChanged?.();
    } catch (err) {
      toast(err instanceof Error ? err.message : 'that did not work');
    } finally {
      setBusy(false);
    }
  };

  if (!state?.ready) return null;
  const hasSample = state.sampleVisits > 0;

  return (
    <div className="card stack">
      <h3>Sample data</h3>
      <p className="muted" style={{ margin: 0, maxWidth: 640 }}>
        {hasSample
          ? `This client is showing ${state.sampleVisits.toLocaleString('en-US')} sample knocks alongside ${state.realVisits.toLocaleString('en-US')} real ones. Remove the sample data before the client reads these numbers as their own.`
          : 'Load a month of realistic door to door activity so the reporting can be demonstrated before a crew exists. Removing it later only deletes rows marked as sample, never a real knock.'}
      </p>

      {issued && (
        <div className="field-issued">
          <p style={{ margin: 0 }}>
            The sample reps can sign into the field app with this password, shown once:
          </p>
          <code>{issued.samplePassword}</code>
          <button className="small" onClick={() => setIssued(null)}>
            Done
          </button>
        </div>
      )}

      <div className="row" style={{ gap: 8 }}>
        <button className="primary" disabled={busy} onClick={() => void run('load')}>
          {busy ? 'Working' : hasSample ? 'Regenerate sample data' : 'Load sample data'}
        </button>
        {hasSample && (
          <button disabled={busy} onClick={() => void run('clear')}>
            Remove sample data
          </button>
        )}
      </div>
    </div>
  );
}

// The address reps actually open. Worth showing plainly wherever somebody
// is adding a rep, because it is the one piece of setup that happens off
// this screen and on somebody else's phone.
function FieldAppLink({ url }: { url: string }) {
  if (!url) return null;
  return (
    <p className="muted" style={{ margin: 0 }}>
      Reps sign in at <a href={url}>{url}</a>. It installs to a phone home screen and keeps
      working with no signal.
    </p>
  );
}

// Rep roster: add somebody, hand them a first password, change their role,
// or take them off the crew.
function Roster({
  reps,
  fieldAppUrl,
  onChanged,
}: {
  reps: RepRecord[] | null;
  fieldAppUrl: string;
  onChanged: () => void;
}) {
  const toast = useToast();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<'rep' | 'manager'>('rep');
  const [team, setTeam] = useState('');
  const [busy, setBusy] = useState(false);
  // Shown until the admin dismisses it: this is the only time the password
  // is ever visible, so it must not vanish on the next render.
  const [issued, setIssued] = useState<{ email: string; tempPassword: string } | null>(null);

  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const res = await api<{ email: string; tempPassword: string }>('/api/tenant/field/reps', {
        method: 'POST',
        json: { name, email, role, team: team || null },
      });
      setIssued(res);
      setName('');
      setEmail('');
      setTeam('');
      onChanged();
    } catch (err) {
      toast(err instanceof Error ? err.message : 'could not add the rep');
    } finally {
      setBusy(false);
    }
  };

  const reset = async (rep: RepRecord) => {
    try {
      const res = await api<{ email: string; tempPassword: string }>(
        `/api/tenant/field/reps/${rep.id}/reset-password`,
        { method: 'POST', json: {} }
      );
      setIssued(res);
    } catch (err) {
      toast(err instanceof Error ? err.message : 'could not reset the password');
    }
  };

  const setActive = async (rep: RepRecord, active: boolean) => {
    try {
      await api(`/api/tenant/field/reps/${rep.id}`, { method: 'PATCH', json: { active } });
      onChanged();
    } catch (err) {
      toast(err instanceof Error ? err.message : 'could not update the rep');
    }
  };

  return (
    <div className="card stack">
      <h3>Field reps</h3>
      <p className="muted" style={{ margin: 0 }}>
        Reps log door to door activity from the field app, signing in with the password
        issued here rather than a dashboard login.
      </p>
      <FieldAppLink url={fieldAppUrl} />

      {issued && (
        <div className="field-issued">
          <p style={{ margin: 0 }}>
            First password for <strong>{issued.email}</strong>. It is shown once, so pass it on now.
          </p>
          <code>{issued.tempPassword}</code>
          <button className="small" onClick={() => setIssued(null)}>
            Done
          </button>
        </div>
      )}

      <form className="row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'flex-end' }} onSubmit={add}>
        <label style={{ flex: '1 1 160px' }}>
          Name
          <input value={name} onChange={(e) => setName(e.target.value)} required />
        </label>
        <label style={{ flex: '1 1 200px' }}>
          Email
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </label>
        <label style={{ flex: '0 1 130px' }}>
          Role
          <select value={role} onChange={(e) => setRole(e.target.value as 'rep' | 'manager')}>
            <option value="rep">Rep</option>
            <option value="manager">Manager</option>
          </select>
        </label>
        <label style={{ flex: '0 1 140px' }}>
          Team
          <input value={team} onChange={(e) => setTeam(e.target.value)} placeholder="optional" />
        </label>
        <button className="primary" type="submit" disabled={busy}>
          {busy ? 'Adding' : 'Add rep'}
        </button>
      </form>

      <div style={{ overflowX: 'auto' }}>
        <table className="data">
          <thead>
            <tr>
              <th>Name</th>
              <th>Email</th>
              <th>Role</th>
              <th>Team</th>
              <th>Last sign in</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {(reps ?? []).map((r) => (
              <tr key={r.id} style={r.active ? undefined : { opacity: 0.55 }}>
                <td>{r.name}</td>
                <td>{r.email}</td>
                <td>{r.role === 'manager' ? 'Manager' : 'Rep'}</td>
                <td>{r.team ?? ''}</td>
                <td>{r.last_login_at ? fmtStamp(r.last_login_at) : 'never'}</td>
                <td>
                  <div className="row" style={{ gap: 6, flexWrap: 'nowrap' }}>
                    <button className="small" onClick={() => void reset(r)}>
                      Reset password
                    </button>
                    <button className="small" onClick={() => void setActive(r, !r.active)}>
                      {r.active ? 'Deactivate' : 'Reactivate'}
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
