// The credential store.
//
// Read the file and note what is absent: there is no handler that returns a
// secret, and there is no import of anything that could decrypt one. §7 asks
// for a store that is write-only by design, and the way to deliver that is
// for the read path not to exist rather than for it to exist and be guarded.
//
// The audit finding this replaces is worth remembering. The prototype's page
// masked a value, dropped the real one on the floor, and rendered the same
// hardcoded string for every credential behind a reveal toggle, under copy
// promising an encrypted vault. It was dangerous because it was convincing:
// somebody would have pasted a live Meta token into it.

import { json, readJson, clientIp, forbidden, notFound, ApiError } from '@server/http';
import type { RouteContext } from '@server/router';
import { requireSession, requireClientInScope, scopeFilter } from '@server/db/scope';
import { recordAudit } from '@server/db/audit';
import { sealSecret, last4 } from '@server/crypto/seal';
import { newId } from '@server/crypto/tokens';
import { verifyTurnstile } from '@server/turnstile';
import {
  createCredentialRequestSchema,
  type credentialsResponseSchema,
  type createCredentialResponseSchema,
} from '@/lib/api/contracts';
import type { z } from 'zod';

type CredentialsResponse = z.infer<typeof credentialsResponseSchema>;
type CreateCredentialResponse = z.infer<typeof createCredentialResponseSchema>;

/**
 * List credential references.
 *
 * The column list is written out rather than SELECT *, and `sealed` is not in
 * it. A future `SELECT *` here would pull ciphertext into a response
 * assembler, and the only thing standing between that and a leak would be
 * whoever writes the mapping remembering to drop it.
 */
export async function listCredentials(ctx: RouteContext): Promise<Response> {
  const session = await requireSession(ctx.request, ctx.env);
  const scope = scopeFilter(session, 'cr.client_id');

  const rows = await ctx.env.DB.prepare(
    `SELECT cr.id, cr.client_id, cr.provider, cr.key_name, cr.last4, cr.updated_at, cr.status,
            c.name AS client_name
       FROM credential_refs cr JOIN clients c ON c.id = cr.client_id
      WHERE ${scope.sql}
      ORDER BY c.name, cr.provider, cr.key_name`
  )
    .bind(...scope.bindings)
    .all<{
      id: string;
      client_id: string;
      provider: string;
      key_name: string;
      last4: string;
      updated_at: string;
      status: string;
      client_name: string;
    }>();

  const payload: CredentialsResponse = {
    credentials: rows.results.map((r) => ({
      id: r.id,
      clientId: r.client_id,
      clientName: r.client_name,
      provider: r.provider,
      keyName: r.key_name,
      last4: r.last4,
      updatedAt: r.updated_at,
      status: r.status as CredentialsResponse['credentials'][number]['status'],
    })),
  };
  return json(payload);
}

/**
 * Store a credential.
 *
 * The value arrives once, is sealed, and is never read back by anything in
 * this codebase. The response is a reference, the same shape the list
 * endpoint returns.
 */
export async function createCredential(ctx: RouteContext): Promise<Response> {
  const session = await requireSession(ctx.request, ctx.env);
  const body = await readJson(ctx.request, createCredentialRequestSchema);
  const clientId = await requireClientInScope(ctx.env.DB, session, body.clientId);

  if (session.user.role !== 'super_admin' && session.user.role !== 'client_admin') {
    throw forbidden('Only an admin can store a credential.');
  }

  await verifyTurnstile(ctx.env, ctx.request, body.turnstileToken ?? '');

  const client = await ctx.env.DB.prepare('SELECT name FROM clients WHERE id = ?1')
    .bind(clientId)
    .first<{ name: string }>();

  const sealed = await sealSecret(ctx.env, body.value);
  const now = new Date().toISOString();
  const id = newId('cred');

  try {
    await ctx.env.DB.prepare(
      `INSERT INTO credential_refs
         (id, client_id, provider, key_name, last4, sealed, status, created_at, updated_at, created_by)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, 'active', ?7, ?8, ?9)`
    )
      .bind(id, clientId, body.provider, body.keyName, last4(body.value), sealed, now, now, session.user.id)
      .run();
  } catch (error) {
    // The UNIQUE index refusing a second value for the same key is the
    // mechanism behind "rotation is delete and recreate": there is no
    // read-modify-write path, because there is no way to write over one.
    if (String(error).includes('UNIQUE')) {
      throw new ApiError(
        409,
        'already_exists',
        'A credential with that name already exists for this workspace. Remove it first, then add the new one.'
      );
    }
    throw error;
  }

  await recordAudit(ctx.env.DB, {
    session,
    action: 'ADD_CREDENTIAL',
    // The provider and the key's name, never the value and never the last
    // four: an audit trail is read by more people than the store itself.
    details: `Stored ${body.provider} credential ${body.keyName}`,
    clientId,
    clientName: client?.name ?? null,
    ipAddress: clientIp(ctx.request),
  });

  const payload: CreateCredentialResponse = {
    credential: {
      id,
      clientId,
      clientName: client?.name ?? '',
      provider: body.provider,
      keyName: body.keyName,
      last4: last4(body.value),
      updatedAt: now,
      status: 'active',
    },
  };
  return json(payload, { status: 201 });
}

/** Remove a credential. Half of rotation, and all of revocation. */
export async function deleteCredential(ctx: RouteContext): Promise<Response> {
  const session = await requireSession(ctx.request, ctx.env);

  if (session.user.role !== 'super_admin' && session.user.role !== 'client_admin') {
    throw forbidden('Only an admin can remove a credential.');
  }

  const id = ctx.params['id'];
  if (!id) throw notFound('No such credential.');

  const row = await ctx.env.DB.prepare(
    'SELECT id, client_id, provider, key_name FROM credential_refs WHERE id = ?1'
  )
    .bind(id)
    .first<{ id: string; client_id: string; provider: string; key_name: string }>();
  if (!row) throw notFound('No such credential.');

  // Scope checked against the row's client, not against anything the caller
  // sent, so an id belonging to another tenant reads as absent.
  const clientId = await requireClientInScope(ctx.env.DB, session, row.client_id);

  await ctx.env.DB.prepare('DELETE FROM credential_refs WHERE id = ?1 AND client_id = ?2')
    .bind(id, clientId)
    .run();

  await recordAudit(ctx.env.DB, {
    session,
    action: 'REMOVE_CREDENTIAL',
    details: `Removed ${row.provider} credential ${row.key_name}`,
    clientId,
    ipAddress: clientIp(ctx.request),
  });

  return json({ ok: true });
}
