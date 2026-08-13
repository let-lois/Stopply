// Field sales: reading a workspace's doors, and recording a knock.

import { json, readJson, clientIp, notFound } from '@server/http';
import type { RouteContext } from '@server/router';
import { requireSession, requireClientInScope, requireModuleEnabled } from '@server/db/scope';
import { recordAudit } from '@server/db/audit';
import { newId } from '@server/crypto/tokens';
import {
  fieldSalesDataSchema,
  logVisitRequestSchema,
  logVisitResponseSchema,
} from '@/modules/field-sales/contracts';
import type { z } from 'zod';

type FieldSalesData = z.infer<typeof fieldSalesDataSchema>;
type LogVisitResponse = z.infer<typeof logVisitResponseSchema>;
type Visit = FieldSalesData['visits'][number];

const MODULE_ID = 'field_sales';

export async function getFieldSalesData(ctx: RouteContext): Promise<Response> {
  const session = await requireSession(ctx.request, ctx.env);
  const clientId = await requireClientInScope(ctx.env.DB, session, ctx.params['clientId']);
  // Entitlement, checked against the row the invoice is about. ModuleGuard in
  // the browser is a courtesy; this is the decision.
  await requireModuleEnabled(ctx.env.DB, clientId, MODULE_ID);

  const [territories, reps, properties, visits] = await Promise.all([
    ctx.env.DB.prepare('SELECT * FROM territories WHERE client_id = ?1 ORDER BY name')
      .bind(clientId)
      .all<{
        id: string;
        name: string;
        north: number;
        south: number;
        east: number;
        west: number;
        assigned_rep_id: string | null;
      }>(),
    ctx.env.DB.prepare('SELECT * FROM reps WHERE client_id = ?1 ORDER BY name')
      .bind(clientId)
      .all<{ id: string; name: string; territory_id: string | null }>(),
    ctx.env.DB.prepare('SELECT * FROM properties WHERE client_id = ?1 ORDER BY address')
      .bind(clientId)
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
    // Bounded, newest first. A workspace that has been knocking for a year
    // has more visits than a dashboard needs to compute a month of KPIs.
    ctx.env.DB.prepare(
      'SELECT * FROM visits WHERE client_id = ?1 ORDER BY occurred_at DESC LIMIT 5000'
    )
      .bind(clientId)
      .all<{
        id: string;
        property_id: string;
        rep_id: string;
        disposition: string;
        notes: string | null;
        occurred_at: string;
      }>(),
  ]);

  const payload: FieldSalesData = {
    territories: territories.results.map((t) => ({
      id: t.id,
      name: t.name,
      bounds: { north: t.north, south: t.south, east: t.east, west: t.west },
      assignedRepId: t.assigned_rep_id,
    })),
    reps: reps.results.map((r) => ({ id: r.id, name: r.name, territoryId: r.territory_id })),
    properties: properties.results.map((p) => ({
      id: p.id,
      address: p.address,
      city: p.city,
      state: p.state,
      postalCode: p.postal_code,
      lat: p.lat,
      lng: p.lng,
      territoryId: p.territory_id,
      disposition: p.disposition as FieldSalesData['properties'][number]['disposition'],
      ownerName: p.owner_name,
      ownerPhone: p.owner_phone,
      notes: p.notes,
    })),
    visits: visits.results.map(
      (v): Visit => ({
        id: v.id,
        propertyId: v.property_id,
        repId: v.rep_id,
        disposition: v.disposition as Visit['disposition'],
        notes: v.notes,
        occurredAt: v.occurred_at,
      })
    ),
  };

  return json(payload);
}

/**
 * Record a knock.
 *
 * Three properties of this handler are load-bearing and were learned the hard
 * way on the platform that is already live:
 *
 *  - A resend of a knock already recorded answers 200 with duplicate: true.
 *    The device's outbox retries until it sees a success, so an error here
 *    means it retries forever and the rep's phone never drains.
 *  - occurred_at is the device's clock, recorded_at is the server's. Reporting
 *    reads occurred_at, so a knock uploaded hours later stays on its own day.
 *  - do_not_knock never rolls back. Offline uploads arrive out of order, and
 *    a later-arriving older knock must not undo a household's request to be
 *    left alone.
 */
export async function logVisit(ctx: RouteContext): Promise<Response> {
  const session = await requireSession(ctx.request, ctx.env);
  const clientId = await requireClientInScope(ctx.env.DB, session, ctx.params['clientId']);
  await requireModuleEnabled(ctx.env.DB, clientId, MODULE_ID);
  const body = await readJson(ctx.request, logVisitRequestSchema);

  // Both must belong to this client. Without these two checks a caller could
  // attach a knock to another tenant's door by sending its id.
  const property = await ctx.env.DB.prepare(
    'SELECT id, disposition FROM properties WHERE id = ?1 AND client_id = ?2'
  )
    .bind(body.propertyId, clientId)
    .first<{ id: string; disposition: string }>();
  if (!property) throw notFound('No such property in this workspace.');

  const rep = await ctx.env.DB.prepare('SELECT id FROM reps WHERE id = ?1 AND client_id = ?2')
    .bind(body.repId, clientId)
    .first<{ id: string }>();
  if (!rep) throw notFound('No such rep in this workspace.');

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
        repId: body.repId,
        disposition: body.disposition,
        notes: body.notes,
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
       (id, device_visit_id, client_id, property_id, rep_id, disposition, notes, occurred_at, recorded_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)`
  )
    .bind(
      id,
      body.deviceVisitId,
      clientId,
      body.propertyId,
      body.repId,
      body.disposition,
      body.notes,
      body.occurredAt,
      now
    )
    .run();

  // Sticky. The WHERE clause is what enforces it: an out-of-order upload
  // simply matches nothing rather than relying on the caller to check first.
  await ctx.env.DB.prepare(
    `UPDATE properties SET disposition = ?1, updated_at = ?2
      WHERE id = ?3 AND client_id = ?4 AND disposition <> 'do_not_knock'`
  )
    .bind(body.disposition, now, body.propertyId, clientId)
    .run();

  await recordAudit(ctx.env.DB, {
    session,
    action: 'LOG_VISIT',
    details: `Logged ${body.disposition.replace(/_/g, ' ')}`,
    clientId,
    moduleId: MODULE_ID,
    ipAddress: clientIp(ctx.request),
  });

  const payload: LogVisitResponse = {
    visit: {
      id,
      propertyId: body.propertyId,
      repId: body.repId,
      disposition: body.disposition,
      notes: body.notes,
      occurredAt: body.occurredAt,
    },
    duplicate: false,
  };
  return json(payload);
}
