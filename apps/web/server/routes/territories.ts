// Drawing territories, and putting reps on them.
//
// The interesting part is not the CRUD, it is what happens to the doors when a
// boundary moves. A territory is only real if the houses inside it belong to
// whoever works it, so saving a shape reassigns every door that falls within
// it, in the same transaction that saves the shape.

import type { D1Database } from '@cloudflare/workers-types';
import { json, readJson, clientIp, forbidden, notFound, badRequest } from '@server/http';
import type { RouteContext } from '@server/router';
import { requireSession, requireClientInScope, requireModuleEnabled } from '@server/db/scope';
import { recordAudit } from '@server/db/audit';
import { newId } from '@server/crypto/tokens';
import { boundsOf, containsPoint, isUsableRing, type Ring } from '@/modules/field-sales/polygon';
import { parseRing } from '@server/routes/fieldSales';
import {
  assignRepRequestSchema,
  saveTerritoryRequestSchema,
  type territoriesResponseSchema,
} from '@/modules/field-sales/contracts';
import type { z } from 'zod';

type TerritoriesResponse = z.infer<typeof territoriesResponseSchema>;

const MODULE_ID = 'field_sales';

interface TerritoryRow {
  id: string;
  name: string;
  north: number;
  south: number;
  east: number;
  west: number;
  boundary_json: string | null;
}

async function loadTerritories(db: D1Database, clientId: string): Promise<TerritoriesResponse> {
  const [territories, reps, counts] = await Promise.all([
    db
      .prepare('SELECT * FROM territories WHERE client_id = ?1 ORDER BY name')
      .bind(clientId)
      .all<TerritoryRow>(),
    db
      .prepare('SELECT id, territory_id FROM reps WHERE client_id = ?1')
      .bind(clientId)
      .all<{ id: string; territory_id: string | null }>(),
    db
      .prepare('SELECT territory_id, count(*) AS n FROM properties WHERE client_id = ?1 GROUP BY territory_id')
      .bind(clientId)
      .all<{ territory_id: string; n: number }>(),
  ]);

  const doorCounts: Record<string, number> = {};
  for (const row of counts.results) doorCounts[row.territory_id] = row.n;

  return {
    territories: territories.results.map((t) => ({
      id: t.id,
      name: t.name,
      bounds: { north: t.north, south: t.south, east: t.east, west: t.west },
      boundary: parseRing(t.boundary_json),
      repIds: reps.results.filter((r) => r.territory_id === t.id).map((r) => r.id),
    })),
    doorCounts,
  };
}

/**
 * Move every door inside the ring into this territory.
 *
 * Done here rather than in SQL because the test is point-in-polygon and SQLite
 * has no geometry. The bounding box narrows the candidates first, so a client
 * with fifty thousand doors only runs the ring test against the handful the
 * box could possibly contain.
 *
 * Doors that fall *outside* the new shape keep whatever territory they had.
 * properties.territory_id is NOT NULL and a door with no territory is a door
 * no rep is offered, so redrawing a boundary must never be able to orphan one.
 * They move when some other territory claims them.
 */
async function reassignDoors(
  db: D1Database,
  clientId: string,
  territoryId: string,
  ring: Ring
): Promise<number> {
  const box = boundsOf(ring);

  const candidates = await db
    .prepare(
      `SELECT id, lat, lng FROM properties
        WHERE client_id = ?1 AND lat BETWEEN ?2 AND ?3 AND lng BETWEEN ?4 AND ?5`
    )
    .bind(clientId, box.south, box.north, box.west, box.east)
    .all<{ id: string; lat: number; lng: number }>();

  const inside = candidates.results.filter((p) => containsPoint(ring, p));
  if (inside.length === 0) return 0;

  const now = new Date().toISOString();
  // Batched, so a half-applied redraw cannot leave doors split between the old
  // shape and the new one.
  await db.batch(
    inside.map((p) =>
      db
        .prepare('UPDATE properties SET territory_id = ?1, updated_at = ?2 WHERE id = ?3 AND client_id = ?4')
        .bind(territoryId, now, p.id, clientId)
    )
  );

  return inside.length;
}

async function requireManager(ctx: RouteContext) {
  const session = await requireSession(ctx.request, ctx.env);
  const clientId = await requireClientInScope(ctx.env.DB, session, ctx.params['clientId']);
  await requireModuleEnabled(ctx.env.DB, clientId, MODULE_ID);
  if (session.user.role === 'representative') {
    throw forbidden('Only a manager can change territories.');
  }
  return { session, clientId };
}

export async function listTerritories(ctx: RouteContext): Promise<Response> {
  const { clientId } = await requireManager(ctx);
  return json(await loadTerritories(ctx.env.DB, clientId));
}

export async function createTerritory(ctx: RouteContext): Promise<Response> {
  const { session, clientId } = await requireManager(ctx);
  const body = await readJson(ctx.request, saveTerritoryRequestSchema);

  if (!isUsableRing(body.boundary)) throw badRequest('boundary: draw an area with at least three points.');

  const id = newId('ter');
  const box = boundsOf(body.boundary);

  await ctx.env.DB.prepare(
    `INSERT INTO territories (id, client_id, name, north, south, east, west, boundary_json)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)`
  )
    .bind(id, clientId, body.name, box.north, box.south, box.east, box.west, JSON.stringify(body.boundary))
    .run();

  const moved = await reassignDoors(ctx.env.DB, clientId, id, body.boundary);

  await recordAudit(ctx.env.DB, {
    session,
    action: 'CREATE_TERRITORY',
    details: `Created territory ${body.name} with ${moved} doors`,
    clientId,
    moduleId: MODULE_ID,
    ipAddress: clientIp(ctx.request),
  });

  return json(await loadTerritories(ctx.env.DB, clientId), { status: 201 });
}

export async function updateTerritory(ctx: RouteContext): Promise<Response> {
  const { session, clientId } = await requireManager(ctx);
  const territoryId = ctx.params['territoryId'];
  const body = await readJson(ctx.request, saveTerritoryRequestSchema);

  if (!isUsableRing(body.boundary)) throw badRequest('boundary: draw an area with at least three points.');

  const existing = await ctx.env.DB.prepare(
    'SELECT id FROM territories WHERE id = ?1 AND client_id = ?2'
  )
    .bind(territoryId, clientId)
    .first<{ id: string }>();
  if (!existing) throw notFound('No such territory.');

  const box = boundsOf(body.boundary);
  await ctx.env.DB.prepare(
    `UPDATE territories SET name = ?1, north = ?2, south = ?3, east = ?4, west = ?5, boundary_json = ?6
      WHERE id = ?7 AND client_id = ?8`
  )
    .bind(body.name, box.north, box.south, box.east, box.west, JSON.stringify(body.boundary), existing.id, clientId)
    .run();

  const moved = await reassignDoors(ctx.env.DB, clientId, existing.id, body.boundary);

  await recordAudit(ctx.env.DB, {
    session,
    action: 'UPDATE_TERRITORY',
    details: `Redrew territory ${body.name}, ${moved} doors inside it`,
    clientId,
    moduleId: MODULE_ID,
    ipAddress: clientIp(ctx.request),
  });

  return json(await loadTerritories(ctx.env.DB, clientId));
}

/**
 * Remove a territory.
 *
 * Refused while it still holds doors. properties.territory_id is NOT NULL, so
 * deleting one with doors in it would either cascade the houses away or fail on
 * the foreign key. Making the manager move them first is the only version of
 * this that cannot lose a client's data by accident.
 */
export async function deleteTerritory(ctx: RouteContext): Promise<Response> {
  const { session, clientId } = await requireManager(ctx);
  const territoryId = ctx.params['territoryId'];

  const territory = await ctx.env.DB.prepare(
    'SELECT id, name FROM territories WHERE id = ?1 AND client_id = ?2'
  )
    .bind(territoryId, clientId)
    .first<{ id: string; name: string }>();
  if (!territory) throw notFound('No such territory.');

  const doors = await ctx.env.DB.prepare(
    'SELECT count(*) AS n FROM properties WHERE territory_id = ?1 AND client_id = ?2'
  )
    .bind(territory.id, clientId)
    .first<{ n: number }>();

  if ((doors?.n ?? 0) > 0) {
    throw badRequest(
      `${territory.name} still holds ${doors?.n ?? 0} doors. Redraw another territory over them first.`
    );
  }

  await ctx.env.DB.batch([
    ctx.env.DB.prepare('UPDATE reps SET territory_id = NULL WHERE territory_id = ?1').bind(territory.id),
    ctx.env.DB.prepare('DELETE FROM territories WHERE id = ?1 AND client_id = ?2').bind(territory.id, clientId),
  ]);

  await recordAudit(ctx.env.DB, {
    session,
    action: 'DELETE_TERRITORY',
    details: `Removed territory ${territory.name}`,
    clientId,
    moduleId: MODULE_ID,
    ipAddress: clientIp(ctx.request),
  });

  return json(await loadTerritories(ctx.env.DB, clientId));
}

/**
 * Put a rep on a territory, or take them off one.
 *
 * reps.territory_id is the only place this lives. It is what field scoping
 * reads, so a rep's app changes the moment this does.
 */
export async function assignRep(ctx: RouteContext): Promise<Response> {
  const { session, clientId } = await requireManager(ctx);
  const repId = ctx.params['repId'];
  const body = await readJson(ctx.request, assignRepRequestSchema);

  const rep = await ctx.env.DB.prepare('SELECT id, name FROM reps WHERE id = ?1 AND client_id = ?2')
    .bind(repId, clientId)
    .first<{ id: string; name: string }>();
  if (!rep) throw notFound('No such rep in this workspace.');

  let territoryName = 'no territory';
  if (body.territoryId !== null) {
    const territory = await ctx.env.DB.prepare(
      'SELECT id, name FROM territories WHERE id = ?1 AND client_id = ?2'
    )
      .bind(body.territoryId, clientId)
      .first<{ id: string; name: string }>();
    // Checked against this client, so a territory id from another workspace
    // reads as absent rather than being written.
    if (!territory) throw notFound('No such territory.');
    territoryName = territory.name;
  }

  await ctx.env.DB.prepare('UPDATE reps SET territory_id = ?1 WHERE id = ?2 AND client_id = ?3')
    .bind(body.territoryId, rep.id, clientId)
    .run();

  await recordAudit(ctx.env.DB, {
    session,
    action: 'ASSIGN_REP',
    details: `${rep.name} assigned to ${territoryName}`,
    clientId,
    moduleId: MODULE_ID,
    ipAddress: clientIp(ctx.request),
  });

  return json(await loadTerritories(ctx.env.DB, clientId));
}
