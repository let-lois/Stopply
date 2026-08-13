// Clients, team, and the audit trail: everything scoped by the session.
//
// Every SELECT here either filters on scopeFilter() or on a client id that
// requireClientInScope() has already validated. There is no query in this
// file that reads a client id straight from the URL.

import type { D1Database } from '@cloudflare/workers-types';
import { json, readJson, clientIp, forbidden, ApiError } from '@server/http';
import type { RouteContext } from '@server/router';
import {
  requireSession,
  requireClientInScope,
  scopeFilter,
  type Session,
} from '@server/db/scope';
import { recordAudit } from '@server/db/audit';
import { newId } from '@server/crypto/tokens';
import { moduleName } from '@/modules/catalog';
import {
  createClientRequestSchema,
  setDataModeRequestSchema,
  setModuleRequestSchema,
  type SessionUser,
  type auditResponseSchema,
  type clientsResponseSchema,
  type teamResponseSchema,
} from '@/lib/api/contracts';
import type { z } from 'zod';

type ClientsResponse = z.infer<typeof clientsResponseSchema>;
type TeamResponse = z.infer<typeof teamResponseSchema>;
type AuditResponse = z.infer<typeof auditResponseSchema>;
type ClientPayload = ClientsResponse['clients'][number];

interface ClientRow {
  id: string;
  code: string;
  name: string;
  industry: string;
  status: string;
  plan: string;
  data_mode: string;
  contact_name: string;
  contact_email: string;
  created_at: string;
  last_active: string;
  timezone: string | null;
}

interface ModuleRow {
  client_id: string;
  module_id: string;
}

interface IntegrationRow {
  id: string;
  client_id: string;
  name: string;
  provider: string;
  connected: number;
  data_mode: string;
  account_name: string | null;
  last_synced_at: string | null;
}

/**
 * Assemble clients with their modules and integrations.
 *
 * Three queries and a join in memory rather than one query per client. The
 * prototype's shape would have been N+1 against a list that grows with the
 * business.
 */
async function loadClients(db: D1Database, session: Session): Promise<ClientPayload[]> {
  const scope = scopeFilter(session, 'id');
  const clients = await db
    .prepare(`SELECT * FROM clients WHERE ${scope.sql} ORDER BY name`)
    .bind(...scope.bindings)
    .all<ClientRow>();

  const ids = clients.results.map((c) => c.id);
  if (ids.length === 0) return [];

  const placeholders = ids.map((_, i) => `?${i + 1}`).join(', ');
  const [modules, integrations] = await Promise.all([
    db
      .prepare(`SELECT client_id, module_id FROM client_modules WHERE client_id IN (${placeholders})`)
      .bind(...ids)
      .all<ModuleRow>(),
    db
      .prepare(`SELECT * FROM integrations WHERE client_id IN (${placeholders})`)
      .bind(...ids)
      .all<IntegrationRow>(),
  ]);

  return clients.results.map((row): ClientPayload => {
    const enabledModules = modules.results
      .filter((m) => m.client_id === row.id)
      .map((m) => m.module_id as ClientPayload['enabledModules'][number]);

    return {
      id: row.id,
      code: row.code,
      name: row.name,
      industry: row.industry,
      status: row.status as ClientPayload['status'],
      plan: row.plan as ClientPayload['plan'],
      dataMode: row.data_mode as ClientPayload['dataMode'],
      enabledModules,
      integrations: integrations.results
        .filter((i) => i.client_id === row.id)
        .map((i) => ({
          id: i.id,
          name: i.name,
          provider: i.provider as ClientPayload['integrations'][number]['provider'],
          connected: i.connected === 1,
          dataMode: i.data_mode as ClientPayload['dataMode'],
          ...(i.last_synced_at ? { lastSynced: i.last_synced_at } : {}),
          ...(i.account_name ? { accountName: i.account_name } : {}),
        })),
      createdAt: row.created_at,
      lastActive: row.last_active,
      contactEmail: row.contact_email,
      contactName: row.contact_name,
      // The column is NOT NULL with a default, so this fallback is for a
      // database that has not had migration 0005 applied rather than for a row
      // that could legitimately be missing one.
      timezone: row.timezone ?? 'America/Los_Angeles',
    };
  });
}

export async function listClients(ctx: RouteContext): Promise<Response> {
  const session = await requireSession(ctx.request, ctx.env);
  const payload: ClientsResponse = { clients: await loadClients(ctx.env.DB, session) };
  return json(payload);
}

/**
 * Enable or disable a module for a client.
 *
 * Entitlement is what this platform sells, so changing it is restricted to
 * roles that can hold a commercial conversation, and every change is on the
 * trail with who made it and from where.
 */
export async function setClientModule(ctx: RouteContext): Promise<Response> {
  const session = await requireSession(ctx.request, ctx.env);
  const clientId = await requireClientInScope(ctx.env.DB, session, ctx.params['clientId']);
  const body = await readJson(ctx.request, setModuleRequestSchema);

  if (session.user.role !== 'super_admin' && session.user.role !== 'client_admin') {
    throw forbidden('Only an admin can change which modules a workspace has.');
  }

  const client = await ctx.env.DB.prepare('SELECT name FROM clients WHERE id = ?1')
    .bind(clientId)
    .first<{ name: string }>();

  if (body.enabled) {
    await ctx.env.DB.prepare(
      'INSERT OR IGNORE INTO client_modules (client_id, module_id, enabled_at) VALUES (?1, ?2, ?3)'
    )
      .bind(clientId, body.moduleId, new Date().toISOString())
      .run();
  } else {
    await ctx.env.DB.prepare('DELETE FROM client_modules WHERE client_id = ?1 AND module_id = ?2')
      .bind(clientId, body.moduleId)
      .run();
  }

  await recordAudit(ctx.env.DB, {
    session,
    action: body.enabled ? 'ENABLE_MODULE' : 'DISABLE_MODULE',
    details: `${body.enabled ? 'Enabled' : 'Disabled'} ${moduleName(body.moduleId) ?? body.moduleId}`,
    clientId,
    clientName: client?.name ?? null,
    moduleId: body.moduleId,
    ipAddress: clientIp(ctx.request),
  });

  const payload: ClientsResponse = { clients: await loadClients(ctx.env.DB, session) };
  return json(payload);
}

/**
 * Switch a workspace between demo and live data.
 *
 * The prototype's equivalent toggled a flag that five of six modules never
 * read, so the badge changed and the numbers did not, and it still wrote an
 * audit entry claiming the source had changed. Here the flag is what
 * useModuleData resolves against, and the entry is written by the server that
 * actually changed it.
 */
export async function setClientDataMode(ctx: RouteContext): Promise<Response> {
  const session = await requireSession(ctx.request, ctx.env);
  const clientId = await requireClientInScope(ctx.env.DB, session, ctx.params['clientId']);
  const body = await readJson(ctx.request, setDataModeRequestSchema);

  if (session.user.role !== 'super_admin' && session.user.role !== 'client_admin') {
    throw forbidden('Only an admin can change a workspace data source.');
  }

  const client = await ctx.env.DB.prepare('SELECT name FROM clients WHERE id = ?1')
    .bind(clientId)
    .first<{ name: string }>();

  await ctx.env.DB.batch([
    ctx.env.DB.prepare('UPDATE clients SET data_mode = ?1 WHERE id = ?2').bind(body.dataMode, clientId),
    // Integrations follow the workspace. Leaving them behind is how a client
    // ends up in live mode with every integration still reading demo.
    ctx.env.DB.prepare('UPDATE integrations SET data_mode = ?1 WHERE client_id = ?2').bind(
      body.dataMode,
      clientId
    ),
  ]);

  await recordAudit(ctx.env.DB, {
    session,
    action: 'SWITCH_DATA_MODE',
    details: `Data mode set to ${body.dataMode}`,
    clientId,
    clientName: client?.name ?? null,
    ipAddress: clientIp(ctx.request),
  });

  const payload: ClientsResponse = { clients: await loadClients(ctx.env.DB, session) };
  return json(payload);
}

/** Create a workspace. Platform-level, so only a super admin may do it. */
export async function createClient(ctx: RouteContext): Promise<Response> {
  const session = await requireSession(ctx.request, ctx.env);
  const body = await readJson(ctx.request, createClientRequestSchema);

  if (session.user.role !== 'super_admin') {
    throw forbidden('Only a platform admin can create a workspace.');
  }

  const id = newId('cl');
  const now = new Date().toISOString();

  const statements = [
    ctx.env.DB.prepare(
      `INSERT INTO clients
         (id, code, name, industry, status, plan, data_mode, contact_name, contact_email, created_at, last_active)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, 'demo', ?7, ?8, ?9, ?10)`
    ).bind(
      id,
      body.code.toUpperCase(),
      body.name,
      body.industry,
      body.status,
      body.plan,
      body.contactName,
      body.contactEmail,
      now,
      now
    ),
    ...body.enabledModules.map((moduleId) =>
      ctx.env.DB.prepare(
        'INSERT INTO client_modules (client_id, module_id, enabled_at) VALUES (?1, ?2, ?3)'
      ).bind(id, moduleId, now)
    ),
  ];

  try {
    // One batch, so a workspace cannot exist with half its entitlements.
    await ctx.env.DB.batch(statements);
  } catch (error) {
    if (String(error).includes('UNIQUE')) {
      throw new ApiError(409, 'already_exists', 'That workspace code is already in use.');
    }
    throw error;
  }

  await recordAudit(ctx.env.DB, {
    session,
    action: 'CREATE_CLIENT',
    details: `Created workspace ${body.name}`,
    clientId: id,
    clientName: body.name,
    ipAddress: clientIp(ctx.request),
  });

  const payload: ClientsResponse = { clients: await loadClients(ctx.env.DB, session) };
  return json(payload, { status: 201 });
}

export async function listTeam(ctx: RouteContext): Promise<Response> {
  const session = await requireSession(ctx.request, ctx.env);
  const scope = scopeFilter(session, 'u.client_id');

  const rows = await ctx.env.DB.prepare(
    `SELECT u.id, u.name, u.email, u.role, u.client_id, u.status, c.name AS client_name
       FROM users u LEFT JOIN clients c ON c.id = u.client_id
      WHERE ${scope.sql}
      ORDER BY u.name`
  )
    .bind(...scope.bindings)
    .all<{
      id: string;
      name: string;
      email: string;
      role: string;
      client_id: string | null;
      status: string;
      client_name: string | null;
    }>();

  const payload: TeamResponse = {
    users: rows.results.map(
      (r): SessionUser => ({
        id: r.id,
        name: r.name,
        email: r.email,
        role: r.role as SessionUser['role'],
        clientId: r.client_id,
        ...(r.client_name ? { clientName: r.client_name } : {}),
        status: r.status as SessionUser['status'],
      })
    ),
  };
  return json(payload);
}

export async function listAudit(ctx: RouteContext): Promise<Response> {
  const session = await requireSession(ctx.request, ctx.env);
  const scope = scopeFilter(session, 'client_id');

  // Bounded. An audit table only grows, and a page that fetches all of it
  // works for a year and then does not.
  const limitRaw = Number(ctx.url.searchParams.get('limit') ?? '100');
  const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(limitRaw, 1), 500) : 100;

  const rows = await ctx.env.DB.prepare(
    `SELECT * FROM audit_log WHERE ${scope.sql} ORDER BY occurred_at DESC LIMIT ${limit}`
  )
    .bind(...scope.bindings)
    .all<{
      id: string;
      occurred_at: string;
      user_id: string;
      user_name: string;
      client_id: string | null;
      client_name: string | null;
      module_id: string | null;
      action: string;
      details: string;
      ip_address: string | null;
    }>();

  const payload: AuditResponse = {
    entries: rows.results.map((r) => ({
      id: r.id,
      timestamp: r.occurred_at,
      userId: r.user_id,
      userName: r.user_name,
      ...(r.client_id ? { clientId: r.client_id } : {}),
      ...(r.client_name ? { clientName: r.client_name } : {}),
      ...(r.module_id ? { moduleId: r.module_id as NonNullable<AuditResponse['entries'][number]['moduleId']> } : {}),
      // A column, so its type is whatever SQLite holds. Everything that
      // writes it is typed against the closed set, and the client validates
      // the response against the same set, so a row from an older deploy
      // fails loudly at the boundary rather than rendering as a blank action.
      action: r.action as AuditResponse['entries'][number]['action'],
      details: r.details,
      ...(r.ip_address ? { ipAddress: r.ip_address } : {}),
    })),
  };
  return json(payload);
}
