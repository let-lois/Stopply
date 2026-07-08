// Door-to-door accounts import, end to end: CSV through the import route,
// the rollup, and the months endpoint. Covers the two-channel split (Door
// to Door vs Dispatch), the cross-month close (knocked in May, closed in
// June, imported as two separate monthly uploads), and the rep leaderboard
// payload.

import { describe, it, expect, beforeEach } from 'vitest';
import { app } from '../src/index';
import { FakeD1, makeEnv } from './helpers';
import { SqliteTenantD1 } from './sqliteTenant';
import { clearResolverCache } from '../src/tenantResolver';
import { createSession } from '../src/session';
import type { Env } from '../src/env';

const TENANT_ROW = {
  id: 't_rogue',
  slug: 'rogue-solar',
  name: 'Rogue Solar',
  status: 'active',
  plan: 'pro',
  timezone: 'America/New_York',
  d1_database_id: 'db-rogue',
  d1_database_name: 'lbi-tenant-rogue-solar',
  schema_version: 4,
  theme_json: null,
  layout_json: null,
  custom_hostname: 'rogue.example.com',
  hostname_status: 'active',
  footer_credit: 1,
  funnel_labels_json: JSON.stringify({ lead: 'Knocks', scheduled: 'Appointments', completed: 'Sits', purchase: 'Closes' }),
  created_at: '2026-01-01T00:00:00Z',
};

const HEADER =
  'accountId,source,owner.name,closer.name,resident.firstName,resident.lastName,resident.email,resident.phone,createdDate,workflowStage,Start,Knock ,Pitch ,Appointment,Sit,Closed,Installed,Appointment ,Not Home';

const CSV = [
  HEADER,
  // Knocked May 10, appointment May 12, sat and closed June 2.
  'Account.1,,Jacob Gibson,Caleb Stolz,Melvin,Boone,,8047291827,2026-05-10T10:00:00.000+00:00,Closed,2026-05-10T10:00:00.000+00:00,2026-05-10T10:00:00.000+00:00,2026-05-10T10:05:00.000+00:00,2026-05-12T17:00:00.000+00:00,2026-06-02T17:00:00.000+00:00,2026-06-02T18:00:00.000+00:00,,,',
  // Knocked May 11, not home.
  'Account.2,,George Sanders,,Ann,Lee,,7571112222,2026-05-11T12:00:00.000+00:00,Not Home,2026-05-11T12:00:00.000+00:00,2026-05-11T12:00:00.000+00:00,,,,,,,2026-05-11T12:00:00.000+00:00',
  // Dispatch origin (no knock), appointment in the duplicate column, sat May 20.
  'Account.3,ReadyMode,Zaniyah Bright,Lauren McAvoy,Bob,Hill,bob@x.com,7573334444,2026-05-01T09:00:00.000+00:00,Sat - No Close,2026-05-01T09:00:00.000+00:00,,,,2026-05-20T15:00:00.000+00:00,,,2026-05-18T10:00:00.000+00:00,',
  // Purchased list, no activity: excluded.
  'Account.4,Terros,,,Dora,None,,,2026-05-02T08:00:00.000+00:00,Does Not Qualify - Other,2026-05-02T08:00:00.000+00:00,,,,,,,,',
].join('\n');

describe('d2d accounts import', () => {
  let env: ReturnType<typeof makeEnv>;
  let tenantDb: SqliteTenantD1;
  let headers: Record<string, string>;

  beforeEach(async () => {
    clearResolverCache();
    tenantDb = new SqliteTenantD1();
    env = makeEnv({ __tenantD1: tenantDb, CSV_BUCKET: { put: async () => undefined } });
    (env.CONTROL_DB as FakeD1).on(/FROM tenants WHERE custom_hostname = \?/, (params) => ({
      first: params[0] === 'rogue.example.com' ? TENANT_ROW : null,
    }));
    (env.CONTROL_DB as FakeD1).on(/INSERT INTO audit_log/, () => ({}));
    await tenantDb.query(
      'db-rogue',
      `INSERT INTO sources (key, name, kind, connector_type) VALUES
       ('d2d-csv', 'Door to door accounts', 'csv', 'd2d-accounts')`
    );
    const { token, csrf } = await createSession(env as unknown as Env, {
      userType: 'tenant',
      userId: 'u_admin',
      role: 'account_admin',
      tenantId: 't_rogue',
      assignedTenants: null,
    });
    headers = {
      cookie: `lbi_session=${token}`,
      'x-csrf-token': csrf,
      'content-type': 'application/json',
    };
  });

  function importMonth(month: string) {
    return app.request(
      'https://rogue.example.com/api/imports',
      { method: 'POST', headers, body: JSON.stringify({ sourceKey: 'd2d-csv', month, csv: CSV }) },
      env as unknown as Env
    );
  }

  function getMonth(month: string) {
    return app.request(`https://rogue.example.com/api/tenant/months/${month}`, { headers }, env as unknown as Env);
  }

  it('imports May: two channels, correct funnel, rep leaderboard', async () => {
    const res = await importMonth('2026-05');
    expect(res.status).toBe(201);

    const body = await (await getMonth('2026-05')).json();
    const byChannel = Object.fromEntries(body.channels.map((r: Record<string, unknown>) => [r.channel, r]));
    // Door to Door: Account.1 (knock, appointment) and Account.2 (knock).
    expect(byChannel['Door to Door']).toMatchObject({ leads: 2, scheduled: 1, completed: 0, purchases: 0 });
    // Dispatch: Account.3 (lead at created, appointment via the duplicate
    // column, sat in May).
    expect(byChannel['Dispatch']).toMatchObject({ leads: 1, scheduled: 1, completed: 1 });

    const reps = Object.fromEntries(body.reps.map((r: Record<string, unknown>) => [r.rep, r]));
    expect(reps['Jacob Gibson']).toMatchObject({ knocks: 1, pitches: 1, appointments_set: 1 });
    expect(reps['Lauren McAvoy']).toMatchObject({ sits_run: 1 });
  });

  it('cross-month close: June import lands the sit and close on the May contact', async () => {
    await importMonth('2026-05');
    await importMonth('2026-06');

    const june = await (await getMonth('2026-06')).json();
    const byChannel = Object.fromEntries(june.channels.map((r: Record<string, unknown>) => [r.channel, r]));
    // Account.1 was knocked in May, so June has no new leads, but its sit
    // and close land in June under the Door to Door channel.
    expect(byChannel['Door to Door']).toMatchObject({ leads: 0, completed: 1, purchases: 1 });

    const reps = Object.fromEntries(june.reps.map((r: Record<string, unknown>) => [r.rep, r]));
    expect(reps['Caleb Stolz']).toMatchObject({ sits_run: 1, closes: 1 });
  });

  it('re-importing the same month replaces rather than duplicates', async () => {
    await importMonth('2026-05');
    await importMonth('2026-05');
    const body = await (await getMonth('2026-05')).json();
    const byChannel = Object.fromEntries(body.channels.map((r: Record<string, unknown>) => [r.channel, r]));
    expect(byChannel['Door to Door']).toMatchObject({ leads: 2, scheduled: 1 });
    const rows = await tenantDb.query('db-rogue', `SELECT COUNT(*) AS n FROM rep_metrics WHERE period_month = '2026-05'`);
    expect((rows.results[0] as { n: number }).n).toBeLessThanOrEqual(4);
  });

  it('purchased-list rows with no funnel activity never become contacts', async () => {
    await importMonth('2026-05');
    const contacts = await tenantDb.query('db-rogue', `SELECT id FROM contacts ORDER BY id`);
    expect(contacts.results.map((r) => (r as { id: string }).id)).toEqual([
      'Account.1',
      'Account.2',
      'Account.3',
    ]);
  });
});
