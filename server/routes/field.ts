// The rep app's API.
//
// Everything here is scoped from the field session and nothing from the
// request. A rep's phone cannot name a workspace, cannot name a rep, and
// cannot ask for a territory that is not theirs, because none of those are
// inputs.
//
// The knock handler is deliberately a second implementation rather than a
// shared one with the dashboard's. They differ in who may attribute a knock to
// whom, which is exactly the kind of difference that gets lost when two callers
// share a function and one of them grows a flag.

import type { D1Database } from '@cloudflare/workers-types';
import { json, readJson, clientIp, notFound, ApiError } from '@server/http';
import type { RouteContext } from '@server/router';
import { hashSessionToken, mintSessionToken, newId } from '@server/crypto/tokens';
import { hashPassword, needsRehash, verifyPassword } from '@server/crypto/password';
import { readCookie } from '@server/db/scope';
import {
  FIELD_COOKIE,
  requireFieldSession,
  repTerritoryFilter,
  type FieldSession,
} from '@server/db/fieldScope';
import { verifyTurnstile } from '@server/turnstile';
import {
  fieldDoorsSchema,
  fieldLoginRequestSchema,
  logVisitRequestSchema,
  logVisitResponseSchema,
} from '@/modules/field-sales/contracts';
import type { z } from 'zod';

type FieldDoors = z.infer<typeof fieldDoorsSchema>;
type LogVisitResponse = z.infer<typeof logVisitResponseSchema>;

// Thirty days. A rep re-authenticating at a door, outdoors, one-handed, is a
// tax on every knock behind them in the day. The mitigation for the longer
// window is that deactivating a rep takes effect on their next request rather
// than when the session lapses.
const FIELD_TTL_MS = 30 * 24 * 60 * 60 * 1000;

function fieldCookie(token: string, maxAgeSeconds: number): string {
  return [
    `${FIELD_COOKIE}=${encodeURIComponent(token)}`,
    'Path=/',
    'HttpOnly',
    'Secure',
    'SameSite=Lax',
    `Max-Age=${maxAgeSeconds}`,
  ].join('; ');
}

interface RepRow {
  id: string;
  name: string;
  client_id: string;
  status: string;
  password_hash: string | null;
  territory_id: string | null;
}

async function loadDoors(db: D1Database, session: FieldSession): Promise<FieldDoors> {
  const scope = await repTerritoryFilter(db, session);

  const [client, rep, properties, visits] = await Promise.all([
    db
      .prepare('SELECT name, logo FROM clients WHERE id = ?1')
      .bind(session.clientId)
      .first<{ name: string; logo: string | null }>(),
    db
      .prepare(
        `SELECT t.name AS territory_name FROM reps r
           LEFT JOIN territories t ON t.id = r.territory_id
          WHERE r.id = ?1`
      )
      .bind(session.repId)
      .first<{ territory_name: string | null }>(),
    db
      .prepare(`SELECT * FROM properties WHERE ${scope.sql} ORDER BY address`)
      .bind(...scope.bindings)
      .all<{
        id: string;
        address: string;
        city: string;
        state: string;
        postal_code: string;
        lat: number;
        lng: number;
        territory_id: string;
        disposition: string;
        owner_name: string | null;
        owner_phone: string | null;
        notes: string | null;
      }>(),
    // This rep's own recent knocks, for their running tally. Not the crew's:
    // a rep's phone has no business carrying a colleague's day.
    db
      .prepare(
        `SELECT * FROM visits WHERE client_id = ?1 AND rep_id = ?2
          ORDER BY occurred_at DESC LIMIT 500`
      )
      .bind(session.clientId, session.repId)
      .all<{
        id: string;
        property_id: string;
        rep_id: string;
        disposition: string;
        notes: string | null;
        vehicle_present: number | null;
        occurred_at: string;
      }>(),
  ]);

  return {
    session: {
      repId: session.repId,
      repName: session.repName,
      clientId: session.clientId,
      clientName: client?.name ?? '',
      clientLogo: client?.logo ?? null,
      territoryName: rep?.territory_name ?? null,
    },
    properties: properties.results.map((p) => ({
      id: p.id,
      address: p.address,
      city: p.city,
      state: p.state,
      postalCode: p.postal_code,
      lat: p.lat,
      lng: p.lng,
      territoryId: p.territory_id,
      disposition: p.disposition as FieldDoors['properties'][number]['disposition'],
      ownerName: p.owner_name,
      ownerPhone: p.owner_phone,
      notes: p.notes,
    })),
    visits: visits.results.map((v) => ({
      id: v.id,
      propertyId: v.property_id,
      repId: v.rep_id,
      disposition: v.disposition as FieldDoors['visits'][number]['disposition'],
      notes: v.notes,
      vehiclePresent: v.vehicle_present === null ? null : v.vehicle_present === 1,
      occurredAt: v.occurred_at,
    })),
  };
}

export async function fieldLogin(ctx: RouteContext): Promise<Response> {
  const body = await readJson(ctx.request, fieldLoginRequestSchema);
  await verifyTurnstile(ctx.env, ctx.request, body.turnstileToken ?? '');

  const email = body.email.trim().toLowerCase();
  const rep = await ctx.env.DB.prepare(
    'SELECT id, name, client_id, status, password_hash, territory_id FROM reps WHERE email = ?1'
  )
    .bind(email)
    .first<RepRow>();

  // One answer for every failure, as on the dashboard: distinguishing an
  // unknown rep from a wrong password is an account enumeration endpoint.
  const reject = () =>
    new ApiError(401, 'unauthorized', 'That email and password do not match.');

  if (!rep || !rep.password_hash || rep.status !== 'active') {
    // Spend comparable time, so the clock does not answer the question the
    // message was careful not to.
    if (!rep?.password_hash) hashPassword(body.password);
    throw reject();
  }

  if (!(await verifyPassword(body.password, rep.password_hash))) throw reject();

  if (needsRehash(rep.password_hash)) {
    try {
      await ctx.env.DB.prepare('UPDATE reps SET password_hash = ?1 WHERE id = ?2')
        .bind(hashPassword(body.password), rep.id)
        .run();
    } catch (error) {
      console.error('[field] could not upgrade password hash', error);
    }
  }

  const token = mintSessionToken();
  const now = new Date();
  await ctx.env.DB.prepare(
    `INSERT INTO field_sessions
       (id, rep_id, client_id, created_at, expires_at, last_seen_at, ip_address, user_agent)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)`
  )
    .bind(
      await hashSessionToken(token),
      rep.id,
      rep.client_id,
      now.toISOString(),
      new Date(now.getTime() + FIELD_TTL_MS).toISOString(),
      now.toISOString(),
      clientIp(ctx.request),
      ctx.request.headers.get('user-agent')?.slice(0, 300) ?? null
    )
    .run();

  const payload = await loadDoors(ctx.env.DB, {
    sessionId: '',
    repId: rep.id,
    repName: rep.name,
    clientId: rep.client_id,
  });

  return json(payload, {
    headers: { 'set-cookie': fieldCookie(token, FIELD_TTL_MS / 1000) },
  });
}

export async function fieldLogout(ctx: RouteContext): Promise<Response> {
  const token = readCookie(ctx.request, FIELD_COOKIE);
  if (token) {
    await ctx.env.DB.prepare('DELETE FROM field_sessions WHERE id = ?1')
      .bind(await hashSessionToken(token))
      .run();
  }
  return json({ ok: true }, { headers: { 'set-cookie': fieldCookie('', 0) } });
}

/** The rep's doors. Also serves as "am I still signed in". */
export async function fieldDoors(ctx: RouteContext): Promise<Response> {
  const session = await requireFieldSession(ctx.request, ctx.env);
  return json(await loadDoors(ctx.env.DB, session));
}

/**
 * Record a knock from a rep's phone.
 *
 * The rep comes from the session, never from the body, so a phone cannot
 * attribute a knock to a colleague. Everything else is the same contract the
 * dashboard honours, including the one that matters most: a resend of a knock
 * already recorded is a 200, so the outbox drains instead of retrying forever.
 */
export async function fieldLogVisit(ctx: RouteContext): Promise<Response> {
  const session = await requireFieldSession(ctx.request, ctx.env);
  const body = await readJson(ctx.request, logVisitRequestSchema);

  // The door must be inside the rep's own scope, not merely inside the client.
  const scope = await repTerritoryFilter(ctx.env.DB, session);
  const property = await ctx.env.DB.prepare(
    `SELECT id FROM properties WHERE id = ?${scope.bindings.length + 1} AND ${scope.sql}`
  )
    .bind(...scope.bindings, body.propertyId)
    .first<{ id: string }>();
  if (!property) throw notFound('That door is not in your territory.');

  const existing = await ctx.env.DB.prepare(
    'SELECT id, occurred_at FROM visits WHERE device_visit_id = ?1'
  )
    .bind(body.deviceVisitId)
    .first<{ id: string; occurred_at: string }>();

  if (existing) {
    const payload: LogVisitResponse = {
      visit: {
        id: existing.id,
        propertyId: body.propertyId,
        repId: session.repId,
        disposition: body.disposition,
        notes: body.notes,
        vehiclePresent: body.vehiclePresent ?? null,
        occurredAt: existing.occurred_at,
      },
      duplicate: true,
    };
    return json(payload);
  }

  const id = newId('vis');
  const now = new Date().toISOString();

  await ctx.env.DB.prepare(
    `INSERT INTO visits
       (id, device_visit_id, client_id, property_id, rep_id, disposition, notes, vehicle_present, occurred_at, recorded_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)`
  )
    .bind(
      id,
      body.deviceVisitId,
      session.clientId,
      body.propertyId,
      session.repId,
      body.disposition,
      body.notes,
      body.vehiclePresent === null || body.vehiclePresent === undefined
        ? null
        : body.vehiclePresent
          ? 1
          : 0,
      body.occurredAt,
      now
    )
    .run();

  // Sticky, enforced by the WHERE clause rather than by the caller checking
  // first, because offline uploads arrive out of order.
  await ctx.env.DB.prepare(
    `UPDATE properties SET disposition = ?1, updated_at = ?2
      WHERE id = ?3 AND client_id = ?4 AND disposition <> 'do_not_knock'`
  )
    .bind(body.disposition, now, body.propertyId, session.clientId)
    .run();

  // Deliberately no audit_log row. That table's actor is a users row and a rep
  // is not one; forcing a rep in would either break the foreign key or require
  // making it nullable, which would weaken the trail for everyone else. The
  // knock is its own record, with the rep, both clocks and the device id on it.

  const payload: LogVisitResponse = {
    visit: {
      id,
      propertyId: body.propertyId,
      repId: session.repId,
      disposition: body.disposition,
      notes: body.notes,
      vehiclePresent: body.vehiclePresent ?? null,
      occurredAt: body.occurredAt,
    },
    duplicate: false,
  };
  return json(payload);
}
