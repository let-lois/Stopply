// Field tracking as the client and the agency see it: the roster of reps,
// and the reporting built on what those reps logged.
//
// Mounted under /api/tenant/field, so every route here inherits tenantScope
// and is reachable only by a dashboard session with access to this tenant.
// A rep's own session is refused here, the same as anywhere else under
// /api/tenant.

import { Hono } from 'hono';
import { z } from 'zod';
import type { FieldRepRow } from '@letlois/db';
import {
  byDay,
  byDisposition,
  byRep,
  dispositionIndex,
  formatAddress,
  summarize,
  zonedDayRangeUtc,
} from '@letlois/field';
import type { AppContext } from '../env';
import { tenantScope, tenantWrite } from '../middleware';
import { tenantD1Client } from '../provisioning';
import { hashPassword, randomToken } from '../crypto';
import { writeAudit } from '../audit';
import { listVisitFacts, listVisits, loadDispositions } from '../field/repo';

export const fieldAdminRoutes = new Hono<AppContext>();
fieldAdminRoutes.use('*', tenantScope);

function dbId(c: { get: (k: 'tenant') => { d1_database_id: string | null } | null }): string {
  const tenant = c.get('tenant');
  if (!tenant?.d1_database_id) throw new Error('tenant database missing');
  return tenant.d1_database_id;
}

// Reporting windows arrive as calendar dates in the client's own timezone
// and are converted to the UTC instants that bound them. Visits are stored
// as instants, and the daily buckets are cut in the client's timezone, so
// the filter has to be cut the same way or the headline totals and the
// chart under them disagree about which day a given evening belongs to.
const dateParam = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

function range(
  c: { req: { query: (k: string) => string | undefined } },
  timeZone: string
): { from: string; to: string; fromDay: string; toDay: string } {
  const today = new Date().toISOString().slice(0, 10);
  const defaultFrom = new Date(Date.now() - 29 * 86400000).toISOString().slice(0, 10);
  const fromDay = dateParam.safeParse(c.req.query('from')).success
    ? (c.req.query('from') as string)
    : defaultFrom;
  const toDay = dateParam.safeParse(c.req.query('to')).success ? (c.req.query('to') as string) : today;
  const bounds = zonedDayRangeUtc(fromDay, toDay, timeZone);
  return { ...bounds, fromDay, toDay };
}

function tenantTimezone(c: { get: (k: 'tenant') => { timezone: string } | null }): string {
  return c.get('tenant')?.timezone || 'UTC';
}

// One call backs the whole reporting tab: headline numbers, the rep
// leaderboard, the outcome breakdown, and the daily trend.
fieldAdminRoutes.get('/overview', async (c) => {
  const timezone = tenantTimezone(c);
  const window = range(c, timezone);
  const d1 = tenantD1Client(c.env);
  const [dispositions, facts] = await Promise.all([
    loadDispositions(d1, dbId(c)),
    listVisitFacts(d1, dbId(c), { from: window.from, to: window.to }),
  ]);
  const index = dispositionIndex(dispositions);

  return c.json({
    range: { from: window.fromDay, to: window.toDay },
    timezone,
    totals: summarize(facts, index),
    reps: byRep(facts, index, timezone),
    dispositions: byDisposition(facts, dispositions),
    daily: byDay(facts, index, timezone, { from: window.fromDay, to: window.toDay }),
  });
});

// The visit log itself. Capped hard: this is a browsable table, not an
// export path. Use the CSV route for a full pull.
fieldAdminRoutes.get('/visits', async (c) => {
  const window = range(c, tenantTimezone(c));
  const limit = Math.min(Math.max(Number(c.req.query('limit') ?? 200), 1), 500);
  const d1 = tenantD1Client(c.env);
  const visits = await listVisits(d1, dbId(c), {
    from: window.from,
    to: window.to,
    repId: c.req.query('repId') || undefined,
    disposition: c.req.query('disposition') || undefined,
    limit,
  });
  return c.json({
    visits: visits.map((v) => ({
      id: v.id,
      repId: v.rep_id,
      repName: v.rep_name,
      address: formatAddress({
        street: v.street,
        unit: v.unit,
        city: v.city,
        state: v.state,
        postalCode: v.postal_code,
      }),
      lat: v.lat,
      lng: v.lng,
      disposition: v.disposition,
      notes: v.notes,
      contactName: v.contact_name,
      contactPhone: v.contact_phone,
      contactEmail: v.contact_email,
      occurredAt: v.occurred_at,
      recordedAt: v.recorded_at,
      followUpAt: v.follow_up_at,
      editedAt: v.edited_at,
      doNotKnock: v.do_not_knock === 1,
    })),
  });
});

function csvCell(value: unknown): string {
  const s = value === null || value === undefined ? '' : String(value);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

// Full export of a window. Clients ask for this constantly, and without it
// the answer is "screenshot the table".
fieldAdminRoutes.get('/visits.csv', async (c) => {
  const window = range(c, tenantTimezone(c));
  const d1 = tenantD1Client(c.env);
  const visits = await listVisits(d1, dbId(c), {
    from: window.from,
    to: window.to,
    repId: c.req.query('repId') || undefined,
    disposition: c.req.query('disposition') || undefined,
    limit: 20000,
  });
  const header = [
    'occurred_at',
    'recorded_at',
    'rep',
    'address',
    'city',
    'state',
    'postal_code',
    'disposition',
    'contact_name',
    'contact_phone',
    'contact_email',
    'follow_up_at',
    'notes',
  ];
  const lines = [header.join(',')];
  for (const v of visits) {
    lines.push(
      [
        v.occurred_at,
        v.recorded_at,
        v.rep_name ?? v.rep_id,
        formatAddress({ street: v.street, unit: v.unit }),
        v.city,
        v.state,
        v.postal_code,
        v.disposition,
        v.contact_name,
        v.contact_phone,
        v.contact_email,
        v.follow_up_at,
        v.notes,
      ]
        .map(csvCell)
        .join(',')
    );
  }
  return c.body(lines.join('\n'), 200, {
    'content-type': 'text/csv; charset=utf-8',
    'content-disposition': `attachment; filename="field-visits-${window.fromDay}-to-${window.toDay}.csv"`,
  });
});

// Doors, not visits: the coverage view, plus every household that asked not
// to be knocked again.
fieldAdminRoutes.get('/addresses', async (c) => {
  const limit = Math.min(Math.max(Number(c.req.query('limit') ?? 200), 1), 500);
  const onlyDnk = c.req.query('doNotKnock') === '1';
  const d1 = tenantD1Client(c.env);
  const { results } = await d1.query<{
    id: string;
    street: string;
    unit: string | null;
    city: string | null;
    state: string | null;
    postal_code: string | null;
    lat: number | null;
    lng: number | null;
    last_disposition: string | null;
    last_visited_at: string | null;
    visit_count: number;
    do_not_knock: number;
  }>(
    dbId(c),
    `SELECT id, street, unit, city, state, postal_code, lat, lng, last_disposition,
       last_visited_at, visit_count, do_not_knock
     FROM field_addresses ${onlyDnk ? 'WHERE do_not_knock = 1' : ''}
     ORDER BY last_visited_at DESC LIMIT ?`,
    [limit]
  );
  return c.json({
    addresses: results.map((a) => ({
      id: a.id,
      address: formatAddress({
        street: a.street,
        unit: a.unit,
        city: a.city,
        state: a.state,
        postalCode: a.postal_code,
      }),
      lat: a.lat,
      lng: a.lng,
      lastDisposition: a.last_disposition,
      lastVisitedAt: a.last_visited_at,
      visitCount: a.visit_count,
      doNotKnock: a.do_not_knock === 1,
    })),
  });
});

// Roster.
fieldAdminRoutes.get('/reps', async (c) => {
  const d1 = tenantD1Client(c.env);
  const { results } = await d1.query<Omit<FieldRepRow, 'password_hash'>>(
    dbId(c),
    `SELECT id, email, name, phone, role, team, active, last_login_at, created_at
     FROM field_reps ORDER BY active DESC, name`
  );
  return c.json({ reps: results });
});

const createRepSchema = z
  .object({
    email: z.string().email().max(254),
    name: z.string().min(1).max(120),
    phone: z.string().max(40).nullish(),
    role: z.enum(['rep', 'manager']).default('rep'),
    team: z.string().max(80).nullish(),
  })
  .strict();

// A rep's first password is generated here and shown exactly once. No email
// provider is bound to this Worker, so it is handed over in person, which
// is how a crew gets onboarded anyway.
fieldAdminRoutes.post('/reps', tenantWrite, async (c) => {
  const tenant = c.get('tenant')!;
  const session = c.get('session')!;
  const body = createRepSchema.safeParse(await c.req.json().catch(() => null));
  if (!body.success) return c.json({ error: 'invalid request', details: body.error.flatten() }, 400);
  const email = body.data.email.toLowerCase().trim();

  const d1 = tenantD1Client(c.env);
  const existing = await d1.query(dbId(c), `SELECT id FROM field_reps WHERE email = ?`, [email]);
  if (existing.results.length > 0) return c.json({ error: 'email already exists' }, 409);

  const tempPassword = randomToken(6);
  const id = `fr_${randomToken(8)}`;
  await d1.query(
    dbId(c),
    `INSERT INTO field_reps (id, email, name, phone, role, team, password_hash, active)
     VALUES (?, ?, ?, ?, ?, ?, ?, 1)`,
    [
      id,
      email,
      body.data.name,
      body.data.phone ?? null,
      body.data.role,
      body.data.team ?? null,
      await hashPassword(tempPassword),
    ]
  );
  // Deliberately NOT added to tenant_directory: that table routes dashboard
  // logins, and a rep has no dashboard to be routed to.
  await writeAudit(c.env, {
    actorType: session.userType === 'agency' ? 'agency' : 'tenant',
    actorId: session.userId,
    tenantId: tenant.id,
    action: 'field_rep.create',
    target: email,
    after: { id, role: body.data.role, team: body.data.team ?? null },
  });
  return c.json({ id, email, tempPassword }, 201);
});

const updateRepSchema = z
  .object({
    name: z.string().min(1).max(120).optional(),
    phone: z.string().max(40).nullish(),
    role: z.enum(['rep', 'manager']).optional(),
    team: z.string().max(80).nullish(),
    active: z.boolean().optional(),
  })
  .strict();

fieldAdminRoutes.patch('/reps/:id', tenantWrite, async (c) => {
  const tenant = c.get('tenant')!;
  const session = c.get('session')!;
  const body = updateRepSchema.safeParse(await c.req.json().catch(() => null));
  if (!body.success) return c.json({ error: 'invalid request' }, 400);

  const sets: string[] = [];
  const params: unknown[] = [];
  if (body.data.name !== undefined) (sets.push('name = ?'), params.push(body.data.name));
  if (body.data.phone !== undefined) (sets.push('phone = ?'), params.push(body.data.phone ?? null));
  if (body.data.role !== undefined) (sets.push('role = ?'), params.push(body.data.role));
  if (body.data.team !== undefined) (sets.push('team = ?'), params.push(body.data.team ?? null));
  if (body.data.active !== undefined) (sets.push('active = ?'), params.push(body.data.active ? 1 : 0));
  if (sets.length === 0) return c.json({ error: 'nothing to update' }, 400);

  const d1 = tenantD1Client(c.env);
  await d1.query(dbId(c), `UPDATE field_reps SET ${sets.join(', ')} WHERE id = ?`, [
    ...params,
    c.req.param('id'),
  ]);
  await writeAudit(c.env, {
    actorType: session.userType === 'agency' ? 'agency' : 'tenant',
    actorId: session.userId,
    tenantId: tenant.id,
    action: 'field_rep.update',
    target: c.req.param('id'),
    after: body.data,
  });
  // Deactivating does not end a session the rep already holds: sessions are
  // keyed by token alone in KV with no per user index. /me re-checks active
  // on every app open, so a deactivated rep is locked out at next launch
  // and cannot log new visits in the meantime.
  return c.json({ ok: true });
});

fieldAdminRoutes.post('/reps/:id/reset-password', tenantWrite, async (c) => {
  const tenant = c.get('tenant')!;
  const session = c.get('session')!;
  const d1 = tenantD1Client(c.env);
  const { results } = await d1.query<{ id: string; email: string }>(
    dbId(c),
    `SELECT id, email FROM field_reps WHERE id = ?`,
    [c.req.param('id')]
  );
  const rep = results[0];
  if (!rep) return c.json({ error: 'not found' }, 404);

  const tempPassword = randomToken(6);
  await d1.query(dbId(c), `UPDATE field_reps SET password_hash = ? WHERE id = ?`, [
    await hashPassword(tempPassword),
    rep.id,
  ]);
  await writeAudit(c.env, {
    actorType: session.userType === 'agency' ? 'agency' : 'tenant',
    actorId: session.userId,
    tenantId: tenant.id,
    action: 'field_rep.password_reset',
    target: rep.email,
  });
  return c.json({ id: rep.id, email: rep.email, tempPassword });
});

// The outcome vocabulary, editable by the client. Reporting reads the flags
// rather than the keys, so renaming an outcome here does not detach it from
// the funnel.
fieldAdminRoutes.get('/dispositions', async (c) => {
  const d1 = tenantD1Client(c.env);
  return c.json({ dispositions: await loadDispositions(d1, dbId(c)) });
});

const dispositionSchema = z
  .object({
    label: z.string().min(1).max(80).optional(),
    sortOrder: z.number().int().min(0).max(9999).optional(),
    isContact: z.boolean().optional(),
    isLead: z.boolean().optional(),
    isAppointment: z.boolean().optional(),
    isSale: z.boolean().optional(),
    marksDoNotKnock: z.boolean().optional(),
    color: z.string().max(20).nullish(),
    active: z.boolean().optional(),
  })
  .strict();

fieldAdminRoutes.put('/dispositions/:key', tenantWrite, async (c) => {
  const tenant = c.get('tenant')!;
  const session = c.get('session')!;
  const key = String(c.req.param('key') ?? '');
  if (!/^[a-z0-9_]{1,60}$/.test(key)) return c.json({ error: 'invalid disposition key' }, 400);
  const body = dispositionSchema.safeParse(await c.req.json().catch(() => null));
  if (!body.success) return c.json({ error: 'invalid request' }, 400);

  const d1 = tenantD1Client(c.env);
  const existing = await d1.query(dbId(c), `SELECT key FROM field_dispositions WHERE key = ?`, [key]);
  if (existing.results.length === 0) {
    // Creating one needs a label: an outcome button with no text on it is
    // not something a rep can use.
    if (!body.data.label) return c.json({ error: 'label is required for a new outcome' }, 400);
    await d1.query(
      dbId(c),
      `INSERT INTO field_dispositions
         (key, label, sort_order, is_contact, is_lead, is_appointment, is_sale, marks_do_not_knock, color, active)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        key,
        body.data.label,
        body.data.sortOrder ?? 100,
        body.data.isContact ? 1 : 0,
        body.data.isLead ? 1 : 0,
        body.data.isAppointment ? 1 : 0,
        body.data.isSale ? 1 : 0,
        body.data.marksDoNotKnock ? 1 : 0,
        body.data.color ?? null,
        body.data.active === false ? 0 : 1,
      ]
    );
  } else {
    const sets: string[] = [];
    const params: unknown[] = [];
    const set = (column: string, value: unknown) => {
      sets.push(`${column} = ?`);
      params.push(value);
    };
    if (body.data.label !== undefined) set('label', body.data.label);
    if (body.data.sortOrder !== undefined) set('sort_order', body.data.sortOrder);
    if (body.data.isContact !== undefined) set('is_contact', body.data.isContact ? 1 : 0);
    if (body.data.isLead !== undefined) set('is_lead', body.data.isLead ? 1 : 0);
    if (body.data.isAppointment !== undefined) set('is_appointment', body.data.isAppointment ? 1 : 0);
    if (body.data.isSale !== undefined) set('is_sale', body.data.isSale ? 1 : 0);
    if (body.data.marksDoNotKnock !== undefined)
      set('marks_do_not_knock', body.data.marksDoNotKnock ? 1 : 0);
    if (body.data.color !== undefined) set('color', body.data.color ?? null);
    if (body.data.active !== undefined) set('active', body.data.active ? 1 : 0);
    if (sets.length === 0) return c.json({ error: 'nothing to update' }, 400);
    await d1.query(dbId(c), `UPDATE field_dispositions SET ${sets.join(', ')} WHERE key = ?`, [
      ...params,
      key,
    ]);
  }

  await writeAudit(c.env, {
    actorType: session.userType === 'agency' ? 'agency' : 'tenant',
    actorId: session.userId,
    tenantId: tenant.id,
    action: 'field_disposition.update',
    target: key,
    after: body.data,
  });
  return c.json({ ok: true });
});
