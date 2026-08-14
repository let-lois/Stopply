// The field app's own API: what a door to door rep's phone talks to.
//
// Scoped tightly on purpose. A rep can log a visit, read back their own
// work, look up what the team already knows about a door in front of them,
// and see their own numbers. Nothing here exposes client reporting, spend,
// or any other rep's contact details.

import { Hono } from 'hono';
import { z } from 'zod';
import type { FieldRepRow } from '@letlois/db';
import { dispositionIndex, formatAddress, summarize } from '@letlois/field';
import type { AppContext } from '../env';
import { fieldScope } from '../middleware';
import { tenantD1Client } from '../provisioning';
import { verifyPassword, hashPassword } from '../crypto';
import {
  buildFieldCookie,
  clearFieldCookie,
  createSession,
  destroySession,
  renewSession,
} from '../session';
import { isAppOrigin } from '../cors';
import { LIMITS, rateLimit } from '../ratelimit';
import {
  isMissingFieldTables,
  listVisitFacts,
  listVisits,
  loadDispositions,
  recordVisit,
} from '../field/repo';

export const fieldRoutes = new Hono<AppContext>();

function dbId(c: { get: (k: 'tenant') => { d1_database_id: string | null } | null }): string {
  const tenant = c.get('tenant');
  if (!tenant?.d1_database_id) throw new Error('tenant database missing');
  return tenant.d1_database_id;
}

const loginSchema = z
  .object({ email: z.string().email().max(254), password: z.string().min(1).max(256) })
  .strict();

// Reps sign in on their own tenant's hostname. There is no agency host
// equivalent: a rep belongs to exactly one client.
fieldRoutes.post('/login', async (c) => {
  if (c.get('hostContext') !== 'tenant') return c.json({ error: 'not found' }, 404);
  const tenant = c.get('tenant');
  if (!tenant?.d1_database_id || tenant.status !== 'active') return c.json({ error: 'not found' }, 404);

  const body = loginSchema.safeParse(await c.req.json().catch(() => null));
  if (!body.success) return c.json({ error: 'invalid request' }, 400);
  const email = body.data.email.toLowerCase().trim();

  const ip = c.req.header('cf-connecting-ip') ?? 'unknown';
  const ipOk = await rateLimit(c.env, LIMITS.loginIp, `field:${ip}`);
  const emailOk = await rateLimit(c.env, LIMITS.loginEmail, `field:${email}`);
  if (!ipOk || !emailOk) return c.json({ error: 'too many attempts, try again later' }, 429);

  // Session fixation defense, same as the dashboard: any field token
  // presented at login is destroyed before a new one is minted.
  const presented = c.get('fieldToken');
  if (presented) await destroySession(c.env, presented);

  const d1 = tenantD1Client(c.env);
  const found = await d1
    .query<FieldRepRow>(
      tenant.d1_database_id,
      `SELECT * FROM field_reps WHERE email = ? AND active = 1`,
      [email]
    )
    .catch((err) => {
      if (isMissingFieldTables(err)) return null;
      throw err;
    });
  // This client's database has not had the field migration applied, so
  // there is no roster to check against. Saying so is better than a bare
  // failure: a rep standing at a door needs to know it is not their
  // password that is wrong.
  if (!found) {
    return c.json({ error: 'field tracking is not set up for this client yet' }, 503);
  }
  const rep = found.results[0] ?? null;
  // Derived even for an unknown email so timing does not reveal who is on
  // the roster.
  const ok = await verifyPassword(body.data.password, rep?.password_hash ?? null);
  if (!ok || !rep) return c.json({ error: 'invalid email or password' }, 401);

  const { token, csrf } = await createSession(c.env, {
    userType: 'field',
    userId: rep.id,
    role: rep.role,
    tenantId: tenant.id,
    assignedTenants: null,
  });
  await d1.query(
    tenant.d1_database_id,
    `UPDATE field_reps SET last_login_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?`,
    [rep.id]
  );

  const secure = new URL(c.req.url).protocol === 'https:';
  c.header('set-cookie', buildFieldCookie(token, secure));
  return c.json({
    ok: true,
    csrf,
    // The store builds cannot receive a cookie across their WebView origin,
    // so they get the token in the body and hold it themselves. Handed back
    // only to those origins: a browser on the dashboard host keeps its
    // HttpOnly cookie, where script cannot read it.
    ...(isAppOrigin(c.req.header('origin')) ? { token } : {}),
    rep: { id: rep.id, name: rep.name, email: rep.email, role: rep.role, team: rep.team },
  });
});

fieldRoutes.post('/logout', async (c) => {
  const token = c.get('fieldToken');
  if (token) await destroySession(c.env, token);
  const secure = new URL(c.req.url).protocol === 'https:';
  c.header('set-cookie', clearFieldCookie(secure));
  return c.json({ ok: true });
});

// Everything below requires a signed in rep on their own tenant's host.
fieldRoutes.use('/me', fieldScope);
fieldRoutes.use('/visits', fieldScope);
fieldRoutes.use('/visits/*', fieldScope);
fieldRoutes.use('/addresses/*', fieldScope);
fieldRoutes.use('/stats', fieldScope);
fieldRoutes.use('/password', fieldScope);

// The app's whole bootstrap in one call: who the rep is, what to call this
// client, and the outcome buttons to render. One request means the app is
// usable the moment it opens, which matters on a phone at the curb.
fieldRoutes.get('/me', async (c) => {
  const session = c.get('fieldSession')!;
  const tenant = c.get('tenant')!;
  const d1 = tenantD1Client(c.env);
  const [repRes, dispositions] = await Promise.all([
    d1.query<FieldRepRow>(
      dbId(c),
      `SELECT id, email, name, phone, role, team, active, last_login_at, created_at
       FROM field_reps WHERE id = ?`,
      [session.userId]
    ),
    loadDispositions(d1, dbId(c)),
  ]);
  const rep = repRes.results[0];
  if (!rep || rep.active !== 1) return c.json({ error: 'unauthorized' }, 401);

  // Push the expiry back out for the standalone app, which has no cookie to
  // renew and whose rep opens it every working day. See renewSession: an
  // idle session still lapses, and a rep deactivated above is refused here
  // before this line is reached.
  if (c.get('fieldAuth') === 'bearer') {
    await renewSession(c.env, c.get('fieldToken')!, session);
  }

  return c.json({
    rep: { id: rep.id, name: rep.name, email: rep.email, role: rep.role, team: rep.team },
    tenant: { name: tenant.name, slug: tenant.slug, timezone: tenant.timezone },
    dispositions: dispositions.filter((d) => d.active),
    csrf: session.csrf,
  });
});

// A visit as the phone sends it. occurredAt is the phone's clock at the
// door; it can be well behind now() if the app was offline. It is accepted
// as sent within a sane window, because the alternative, stamping arrival
// time, would move a rep's knocks onto the wrong day.
const visitSchema = z
  .object({
    clientUuid: z.string().min(8).max(64),
    street: z.string().min(1).max(200),
    unit: z.string().max(40).nullish(),
    city: z.string().max(80).nullish(),
    state: z.string().max(40).nullish(),
    postalCode: z.string().max(16).nullish(),
    disposition: z.string().min(1).max(60),
    notes: z.string().max(2000).nullish(),
    contactName: z.string().max(120).nullish(),
    contactPhone: z.string().max(40).nullish(),
    contactEmail: z.string().max(254).nullish(),
    occurredAt: z.string().datetime(),
    lat: z.number().min(-90).max(90).nullish(),
    lng: z.number().min(-180).max(180).nullish(),
    accuracyM: z.number().min(0).max(100000).nullish(),
    followUpAt: z.string().datetime().nullish(),
  })
  .strict();

const MAX_BACKDATE_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_FUTURE_MS = 60 * 60 * 1000;

fieldRoutes.post('/visits', async (c) => {
  const session = c.get('fieldSession')!;
  const body = visitSchema.safeParse(await c.req.json().catch(() => null));
  if (!body.success) return c.json({ error: 'invalid request', details: body.error.flatten() }, 400);

  const occurred = Date.parse(body.data.occurredAt);
  const now = Date.now();
  // A phone with a badly wrong clock would otherwise park knocks in a month
  // nobody is looking at, or in the future where they never age out.
  if (occurred < now - MAX_BACKDATE_MS || occurred > now + MAX_FUTURE_MS) {
    return c.json({ error: 'occurredAt is outside the accepted window' }, 400);
  }

  const d1 = tenantD1Client(c.env);
  const dispositions = await loadDispositions(d1, dbId(c));
  const index = dispositionIndex(dispositions);
  const chosen = index.get(body.data.disposition);
  if (!chosen || !chosen.active) return c.json({ error: 'unknown disposition' }, 400);

  const recorded = await recordVisit(d1, dbId(c), session.userId, body.data, index);
  return c.json(recorded, recorded.duplicate ? 200 : 201);
});

// Editing is limited to the rep's own visit and to a short window after the
// door. Reps fix a typo or add a note they did not have time for; they do
// not restate last week's outcomes.
const EDIT_WINDOW_MS = 24 * 60 * 60 * 1000;

const editSchema = z
  .object({
    disposition: z.string().min(1).max(60).optional(),
    notes: z.string().max(2000).nullish(),
    contactName: z.string().max(120).nullish(),
    contactPhone: z.string().max(40).nullish(),
    contactEmail: z.string().max(254).nullish(),
    followUpAt: z.string().datetime().nullish(),
  })
  .strict();

fieldRoutes.patch('/visits/:id', async (c) => {
  const session = c.get('fieldSession')!;
  const body = editSchema.safeParse(await c.req.json().catch(() => null));
  if (!body.success) return c.json({ error: 'invalid request' }, 400);

  const d1 = tenantD1Client(c.env);
  const { results } = await d1.query<{ id: string; rep_id: string; occurred_at: string; address_id: string }>(
    dbId(c),
    `SELECT id, rep_id, occurred_at, address_id FROM field_visits WHERE id = ?`,
    [c.req.param('id')]
  );
  const visit = results[0];
  // Same answer for "not yours" and "does not exist": a rep cannot probe
  // for another rep's visit ids.
  if (!visit || visit.rep_id !== session.userId) return c.json({ error: 'not found' }, 404);
  if (Date.now() - Date.parse(visit.occurred_at) > EDIT_WINDOW_MS) {
    return c.json({ error: 'this visit is too old to edit' }, 403);
  }

  const sets: string[] = [];
  const params: unknown[] = [];
  const dispositions = await loadDispositions(d1, dbId(c));
  const index = dispositionIndex(dispositions);

  if (body.data.disposition !== undefined) {
    const chosen = index.get(body.data.disposition);
    if (!chosen || !chosen.active) return c.json({ error: 'unknown disposition' }, 400);
    sets.push('disposition = ?');
    params.push(body.data.disposition);
  }
  if (body.data.notes !== undefined) (sets.push('notes = ?'), params.push(body.data.notes ?? null));
  if (body.data.contactName !== undefined)
    (sets.push('contact_name = ?'), params.push(body.data.contactName ?? null));
  if (body.data.contactPhone !== undefined)
    (sets.push('contact_phone = ?'), params.push(body.data.contactPhone ?? null));
  if (body.data.contactEmail !== undefined)
    (sets.push('contact_email = ?'), params.push(body.data.contactEmail ?? null));
  if (body.data.followUpAt !== undefined)
    (sets.push('follow_up_at = ?'), params.push(body.data.followUpAt ?? null));
  if (sets.length === 0) return c.json({ error: 'nothing to update' }, 400);

  sets.push(`edited_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')`);
  await d1.query(dbId(c), `UPDATE field_visits SET ${sets.join(', ')} WHERE id = ?`, [
    ...params,
    visit.id,
  ]);

  // A correction to "do not knock" still has to reach the door, or the rest
  // of the team keeps knocking a house that asked them to stop.
  if (body.data.disposition && index.get(body.data.disposition)?.marksDoNotKnock) {
    await d1.query(dbId(c), `UPDATE field_addresses SET do_not_knock = 1 WHERE id = ?`, [
      visit.address_id,
    ]);
  }
  // Keep the door's latest outcome honest when the edited visit is the
  // latest one on it.
  if (body.data.disposition) {
    await d1.query(
      dbId(c),
      `UPDATE field_addresses SET last_disposition = ? WHERE id = ? AND last_visited_at <= ?`,
      [body.data.disposition, visit.address_id, visit.occurred_at]
    );
  }
  return c.json({ ok: true });
});

// The rep's own recent work, newest first. A rep never reads another rep's
// visits from here, whatever they pass.
fieldRoutes.get('/visits', async (c) => {
  const session = c.get('fieldSession')!;
  const limit = Math.min(Math.max(Number(c.req.query('limit') ?? 50), 1), 200);
  const from = c.req.query('from');
  const to = c.req.query('to');
  const d1 = tenantD1Client(c.env);
  const visits = await listVisits(d1, dbId(c), {
    repId: session.userId,
    from: from && /^\d{4}-\d{2}-\d{2}/.test(from) ? from : undefined,
    to: to && /^\d{4}-\d{2}-\d{2}/.test(to) ? to : undefined,
    limit,
  });
  return c.json({ visits: visits.map(toAppVisit) });
});

function toAppVisit(v: {
  id: string;
  client_uuid: string;
  address_id: string;
  disposition: string;
  notes: string | null;
  contact_name: string | null;
  contact_phone: string | null;
  contact_email: string | null;
  occurred_at: string;
  follow_up_at: string | null;
  street: string;
  unit: string | null;
  city: string | null;
  state: string | null;
  postal_code: string | null;
}) {
  return {
    id: v.id,
    clientUuid: v.client_uuid,
    addressId: v.address_id,
    address: formatAddress({
      street: v.street,
      unit: v.unit,
      city: v.city,
      state: v.state,
      postalCode: v.postal_code,
    }),
    street: v.street,
    unit: v.unit,
    city: v.city,
    state: v.state,
    postalCode: v.postal_code,
    disposition: v.disposition,
    notes: v.notes,
    contactName: v.contact_name,
    contactPhone: v.contact_phone,
    contactEmail: v.contact_email,
    occurredAt: v.occurred_at,
    followUpAt: v.follow_up_at,
  };
}

// What the team already knows about the doors around the rep right now.
//
// This is the feature that stops a crew re-knocking a house that asked to
// be left alone, and lets a rep walk up already knowing the last outcome.
// A bounding box on lat/lng, not a true radius: it is an index friendly
// query and the difference at this scale is a few houses at the corners.
fieldRoutes.get('/addresses/nearby', async (c) => {
  const lat = Number(c.req.query('lat'));
  const lng = Number(c.req.query('lng'));
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return c.json({ error: 'lat and lng are required' }, 400);
  }
  // Roughly a quarter mile box, which is about as far as a rep can see
  // down a street.
  const dLat = 0.004;
  const dLng = dLat / Math.max(0.1, Math.cos((lat * Math.PI) / 180));
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
     FROM field_addresses
     WHERE lat BETWEEN ? AND ? AND lng BETWEEN ? AND ?
     ORDER BY last_visited_at DESC LIMIT 100`,
    [lat - dLat, lat + dLat, lng - dLng, lng + dLng]
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
      street: a.street,
      unit: a.unit,
      city: a.city,
      state: a.state,
      postalCode: a.postal_code,
      lat: a.lat,
      lng: a.lng,
      lastDisposition: a.last_disposition,
      lastVisitedAt: a.last_visited_at,
      visitCount: a.visit_count,
      doNotKnock: a.do_not_knock === 1,
    })),
  });
});

// The rep's own scoreboard: today and the trailing week. Managers also get
// the team's totals, which is the only place a field session sees anyone
// else's numbers, and even then only aggregates.
fieldRoutes.get('/stats', async (c) => {
  const session = c.get('fieldSession')!;
  const d1 = tenantD1Client(c.env);
  const dispositions = await loadDispositions(d1, dbId(c));
  const index = dispositionIndex(dispositions);

  const now = Date.now();
  const weekAgo = new Date(now - 7 * 86400000).toISOString();
  const dayAgo = new Date(now - 86400000).toISOString();
  const nowIso = new Date(now).toISOString();

  const mine = await listVisitFacts(d1, dbId(c), {
    from: weekAgo,
    to: nowIso,
    repId: session.userId,
  });
  const payload: Record<string, unknown> = {
    today: summarize(
      mine.filter((v) => v.occurredAt >= dayAgo),
      index
    ),
    week: summarize(mine, index),
  };

  if (session.role === 'manager') {
    const team = await listVisitFacts(d1, dbId(c), { from: weekAgo, to: nowIso });
    payload.team = summarize(team, index);
  }
  return c.json(payload);
});

const passwordSchema = z
  .object({ currentPassword: z.string().min(1).max(256), newPassword: z.string().min(8).max(256) })
  .strict();

fieldRoutes.put('/password', async (c) => {
  const session = c.get('fieldSession')!;
  const body = passwordSchema.safeParse(await c.req.json().catch(() => null));
  if (!body.success) return c.json({ error: 'password must be at least 8 characters' }, 400);
  const d1 = tenantD1Client(c.env);
  const { results } = await d1.query<{ password_hash: string }>(
    dbId(c),
    `SELECT password_hash FROM field_reps WHERE id = ? AND active = 1`,
    [session.userId]
  );
  const ok = await verifyPassword(body.data.currentPassword, results[0]?.password_hash ?? null);
  if (!ok) return c.json({ error: 'current password is incorrect' }, 403);
  await d1.query(dbId(c), `UPDATE field_reps SET password_hash = ? WHERE id = ?`, [
    await hashPassword(body.data.newPassword),
    session.userId,
  ]);
  return c.json({ ok: true });
});
