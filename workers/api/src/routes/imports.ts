import { Hono } from 'hono';
import { z } from 'zod';
import { PARSER_REGISTRY } from '@letlois/connectors';
import type { ParseResult } from '@letlois/connectors';
import type { TenantD1 } from '@letlois/tenant-d1';
import type { AppContext } from '../env';
import { tenantScope, tenantWrite } from '../middleware';
import { tenantD1Client } from '../provisioning';
import { randomToken, sha256Hex } from '../crypto';
import { writeAudit } from '../audit';
import { upsertContact } from '../ingest/contacts';
import { runTenantRollup } from '../rollup';

export const importRoutes = new Hono<AppContext>();
importRoutes.use('*', tenantScope, tenantWrite);

const MAX_CSV_BYTES = 10 * 1024 * 1024;

const importSchema = z
  .object({
    sourceKey: z.string().regex(/^[a-z0-9-]{1,60}$/),
    month: z.string().regex(/^\d{4}-\d{2}$/),
    csv: z.string().min(1).max(MAX_CSV_BYTES),
    parser: z.string().regex(/^[a-z0-9-]{1,40}$/).optional(),
  })
  .strict();

// CSV upload, the universal fallback for every source. Stores the raw
// file in R2 and replays it through the parser registry into the same
// events and stage_events tables the live paths feed. Re uploading a
// month replaces that period's rows and resets the source to unverified.
importRoutes.post('/', async (c) => {
  const tenant = c.get('tenant')!;
  const session = c.get('session')!;
  if (!tenant.d1_database_id) return c.json({ error: 'not found' }, 404);
  const body = importSchema.safeParse(await c.req.json().catch(() => null));
  if (!body.success) return c.json({ error: 'invalid request', details: body.error.flatten() }, 400);
  const { sourceKey, month, csv } = body.data;

  const d1 = tenantD1Client(c.env);
  const databaseId = tenant.d1_database_id;
  const { results } = await d1.query<{ key: string; connector_type: string | null }>(
    databaseId,
    `SELECT key, connector_type FROM sources WHERE key = ?`,
    [sourceKey]
  );
  const source = results[0];
  if (!source) return c.json({ error: 'unknown source' }, 404);

  const parserKey = body.data.parser ?? source.connector_type ?? '';
  const parser = PARSER_REGISTRY[parserKey];
  if (!parser) return c.json({ error: `no parser for source (tried ${parserKey || 'none'})` }, 400);

  const uploadId = randomToken(8);
  const r2Key = `raw/${tenant.slug}/${sourceKey}/${month}/${uploadId}.csv`;
  await c.env.CSV_BUCKET.put(r2Key, csv);

  let parsed: ParseResult;
  try {
    parsed = parser(csv, month);
  } catch (err) {
    return c.json({ error: `parse failed: ${err instanceof Error ? err.message : 'unknown'}` }, 422);
  }

  await applyParseResult(d1, databaseId, sourceKey, month, parsed);

  // Record the import and reset verification: a fresh import goes gray.
  await d1.query(
    databaseId,
    `INSERT INTO csv_imports (id, source_key, period_month, r2_key, row_count, records_from, records_through, uploaded_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      `imp_${uploadId}`,
      sourceKey,
      month,
      r2Key,
      parsed.rowCount,
      parsed.recordsFrom,
      parsed.recordsThrough,
      session.userId,
    ]
  );
  await d1.query(
    databaseId,
    `UPDATE sources SET verified_by = NULL, verified_at = NULL,
       last_import_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
       records_through = COALESCE(?, records_through)
     WHERE key = ?`,
    [parsed.recordsThrough, sourceKey]
  );

  await writeAudit(c.env, {
    actorType: session.userType,
    actorId: session.userId,
    tenantId: tenant.id,
    action: 'import.csv',
    target: `${sourceKey}/${month}`,
    after: { rowCount: parsed.rowCount, kind: parsed.kind, r2Key },
  });

  // Imports recompute the month inline so the dashboard is current the
  // moment the upload returns.
  await runTenantRollup(c.env, databaseId, month);
  return c.json(
    {
      ok: true,
      importId: `imp_${uploadId}`,
      kind: parsed.kind,
      rowCount: parsed.rowCount,
      recordsFrom: parsed.recordsFrom,
      recordsThrough: parsed.recordsThrough,
    },
    201
  );
});

importRoutes.get('/', async (c) => {
  const tenant = c.get('tenant')!;
  if (!tenant.d1_database_id) return c.json({ error: 'not found' }, 404);
  const d1 = tenantD1Client(c.env);
  const { results } = await d1.query(
    tenant.d1_database_id,
    `SELECT id, source_key, period_month, row_count, records_from, records_through, uploaded_by, uploaded_at
     FROM csv_imports ORDER BY uploaded_at DESC LIMIT 100`
  );
  return c.json({ imports: results });
});

export async function applyParseResult(
  d1: TenantD1,
  databaseId: string,
  sourceKey: string,
  month: string,
  parsed: ParseResult
): Promise<void> {
  const monthStart = `${month}-01`;
  const monthEnd = nextMonthStart(month);

  if (parsed.kind === 'ad-spend' && parsed.adSpend) {
    const channels = [...new Set(parsed.adSpend.map((r) => r.channel))];
    for (const channel of channels) {
      await d1.query(databaseId, `DELETE FROM raw_ad_spend WHERE period_month = ? AND channel = ?`, [
        month,
        channel,
      ]);
    }
    for (const row of parsed.adSpend) {
      await d1.query(
        databaseId,
        `INSERT INTO raw_ad_spend (period_month, channel, campaign, spend, leads_reported)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT (period_month, channel, campaign) DO UPDATE SET
           spend = excluded.spend, leads_reported = excluded.leads_reported`,
        [row.periodMonth, row.channel, row.campaign, row.spend, row.leadsReported]
      );
    }
  }

  if (parsed.kind === 'contacts' && parsed.contacts) {
    // Replace this source's lead stage events for the month, then replay.
    await d1.query(
      databaseId,
      `DELETE FROM stage_events WHERE source_key = ? AND stage = 'lead' AND occurred_at >= ? AND occurred_at < ?`,
      [sourceKey, monthStart, monthEnd]
    );
    for (const contact of parsed.contacts) {
      // Deterministic event id so replays do not duplicate the event log.
      const eventId = `ev_imp_${(await sha256Hex(`${sourceKey}:${contact.externalRef}`)).slice(0, 32)}`;
      await d1.query(
        databaseId,
        `INSERT OR IGNORE INTO events (id, occurred_at, source_key, event_type, contact_id, payload_json,
           utm_source, utm_medium, utm_campaign, utm_term, utm_content, gclid)
         VALUES (?, ?, ?, 'integration_event', ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          eventId,
          contact.createdAt,
          sourceKey,
          contact.externalRef,
          JSON.stringify({ followupStage: contact.followupStage, treatment: contact.treatment, channel: contact.channel }),
          contact.utm.source ?? null,
          contact.utm.medium ?? null,
          contact.utm.campaign ?? null,
          contact.utm.term ?? null,
          contact.utm.content ?? null,
          contact.clickId,
        ]
      );
      await upsertContact(
        d1,
        databaseId,
        {
          externalRef: contact.externalRef,
          firstName: contact.firstName,
          lastName: contact.lastName,
          email: contact.email,
          phone: contact.phoneLast10,
          createdAt: contact.createdAt,
          followupStage: contact.followupStage,
          treatment: contact.treatment,
        },
        {
          at: contact.createdAt,
          channel: contact.channel,
          source: contact.sourceRaw,
          campaign: contact.campaign,
          json: { utm: contact.utm, clickId: contact.clickId },
          sourceKey,
          eventId,
        }
      );
      await d1.query(
        databaseId,
        `INSERT OR IGNORE INTO stage_events (id, contact_id, external_ref, stage, occurred_at, source_key, raw_json)
         VALUES (?, ?, ?, 'lead', ?, ?, ?)`,
        [
          `se_${randomToken(8)}`,
          contact.externalRef,
          `lead:${contact.externalRef}`,
          contact.createdAt,
          sourceKey,
          JSON.stringify({ followupStage: contact.followupStage, treatment: contact.treatment }),
        ]
      );
    }
  }

  if (parsed.kind === 'stage-events' && parsed.stageEvents) {
    const stages = [...new Set(parsed.stageEvents.map((e) => e.stage))];
    for (const stage of stages) {
      await d1.query(
        databaseId,
        `DELETE FROM stage_events WHERE source_key = ? AND stage = ? AND occurred_at >= ? AND occurred_at < ?`,
        [sourceKey, stage, monthStart, monthEnd]
      );
    }
    for (const ev of parsed.stageEvents) {
      await d1.query(
        databaseId,
        `INSERT OR IGNORE INTO stage_events (id, contact_id, external_ref, stage, occurred_at, amount, source_key, raw_json)
         VALUES (?, NULL, ?, ?, ?, ?, ?, ?)`,
        [
          `se_${randomToken(8)}`,
          ev.externalRef,
          ev.stage,
          ev.occurredAt,
          ev.amount,
          sourceKey,
          JSON.stringify({
            clientId: ev.clientId ?? null,
            email: ev.email ?? null,
            phoneLast10: ev.phoneLast10 ?? null,
            nameNorm: ev.nameNorm ?? null,
          }),
        ]
      );
    }
  }

  if (parsed.kind === 'client-records' && parsed.clientRecords) {
    for (const record of parsed.clientRecords) {
      await d1.query(
        databaseId,
        `INSERT INTO client_records (client_id, email_norm, phone_last10, name_norm, source_key)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT (client_id) DO UPDATE SET email_norm = excluded.email_norm,
           phone_last10 = excluded.phone_last10, name_norm = excluded.name_norm`,
        [record.clientId, record.email, record.phoneLast10, record.nameNorm, sourceKey]
      );
    }
  }
}

function nextMonthStart(month: string): string {
  const [y, m] = month.split('-').map((n) => Number(n));
  return new Date(Date.UTC(y ?? 2000, m ?? 1, 1)).toISOString().slice(0, 10);
}
