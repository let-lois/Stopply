import { Hono } from 'hono';
import { z } from 'zod';
import Anthropic from '@anthropic-ai/sdk';
import { PARSER_REGISTRY, parseCsv } from '@letlois/connectors';
import type { ParseResult } from '@letlois/connectors';
import type { TenantD1 } from '@letlois/tenant-d1';
import type { AppContext } from '../env';
import { tenantScope, tenantWrite } from '../middleware';
import { tenantD1Client } from '../provisioning';
import { randomToken, sha256Hex } from '../crypto';
import { writeAudit } from '../audit';
import { upsertContact } from '../ingest/contacts';
import { runTenantRollup } from '../rollup';
import { getAgencySetting } from '../agencySettings';

// Friendly description of each parser so the AI detector can match a CSV to
// the right one. Adding a vendor export of an existing role is config, not
// code: extend this map and the registry.
const PARSER_CATALOG: Record<string, string> = {
  'meta-campaign': 'Meta / Facebook Ads campaign export. Ad spend and reported leads per campaign.',
  'google-campaign': 'Google Ads campaign export. Ad spend and reported leads per campaign.',
  'meta-ad-lineitem': 'Meta / Facebook Ads ad level export. Spend and reported leads per individual ad.',
  'google-ad-lineitem': 'Google Ads "Ads" report. Spend and reported leads per individual ad.',
  'ghl-contacts': 'Go High Level (GHL) full contacts export. Leads with created date, email, phone, UTMs.',
  'ghl-website': 'Go High Level website filtered contacts export. All rows attributed to the Website channel.',
  'blvd-appointments': 'Boulevard appointments export. Scheduling stage events (booked, shows).',
  'blvd-line-items': 'Boulevard line items / sales export. Purchase stage events with amounts.',
  'blvd-clients': 'Boulevard client records export. Identity bridge of client id to email/phone/name.',
  'd2d-accounts':
    'Door-to-door sales CRM accounts export. One row per account with timestamp columns per funnel stage (Knock, Pitch, Appointment, Sit, Closed, Installed) plus owner/setter and closer names.',
};

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

// AI assisted CSV understanding. Given a raw CSV, Claude reads the header
// row and a few sample rows and picks the parser that best fits, so a user
// uploading any export only has to confirm. The Anthropic key resolves
// through the agency settings vault, so an admin can rotate it from the
// console without a redeploy.
const detectSchema = z.object({ csv: z.string().min(1).max(MAX_CSV_BYTES) }).strict();

importRoutes.post('/detect', async (c) => {
  const body = detectSchema.safeParse(await c.req.json().catch(() => null));
  if (!body.success) return c.json({ error: 'invalid request' }, 400);

  const table = parseCsv(body.data.csv);
  if (table.headers.length === 0) return c.json({ error: 'no columns found in CSV' }, 422);
  const sample = {
    headers: table.headers,
    rows: table.rows.slice(0, 5),
    totalRows: table.rows.length,
  };

  const apiKey = await getAgencySetting(c.env, 'ANTHROPIC_API_KEY');
  if (!apiKey) {
    // No key configured: return the catalog so the user can still pick
    // manually, just without the suggestion.
    return c.json({ suggestion: null, options: catalogOptions(), reason: 'AI detection is not configured.' });
  }

  const catalog = Object.entries(PARSER_CATALOG)
    .map(([key, desc]) => `- ${key}: ${desc}`)
    .join('\n');
  const client = new Anthropic({ apiKey });
  try {
    const response = await client.messages.create({
      model: 'claude-opus-4-8',
      max_tokens: 400,
      system:
        'You map a marketing CSV export to one of a fixed set of parsers. ' +
        'Reply with ONLY a compact JSON object: ' +
        '{"parser": <one of the keys or null>, "role": "spend|leads|appointments|transactions|identity|unknown", ' +
        '"confidence": 0..1, "reason": <short>}. Pick null only if nothing fits.',
      messages: [
        {
          role: 'user',
          content: `Available parsers:\n${catalog}\n\nCSV sample (JSON):\n${JSON.stringify(sample)}`,
        },
      ],
    });
    const text = response.content.map((b) => (b.type === 'text' ? b.text : '')).join('');
    const parsed = safeJson(text);
    const parser = typeof parsed?.parser === 'string' && PARSER_CATALOG[parsed.parser] ? parsed.parser : null;
    return c.json({
      suggestion: parser
        ? {
            parser,
            role: typeof parsed?.role === 'string' ? parsed.role : 'unknown',
            confidence: typeof parsed?.confidence === 'number' ? parsed.confidence : null,
            reason: typeof parsed?.reason === 'string' ? parsed.reason : '',
          }
        : null,
      options: catalogOptions(),
      reason: parser ? '' : 'Could not confidently match a parser; please choose one.',
    });
  } catch (err) {
    console.error('CSV detect failed', err instanceof Error ? err.message : err);
    return c.json({ suggestion: null, options: catalogOptions(), reason: 'AI detection is unavailable right now.' });
  }
});

function catalogOptions(): Array<{ key: string; description: string }> {
  return Object.entries(PARSER_CATALOG).map(([key, description]) => ({ key, description }));
}

function safeJson(text: string): Record<string, unknown> | null {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end === -1 || end < start) return null;
  try {
    return JSON.parse(text.slice(start, end + 1)) as Record<string, unknown>;
  } catch {
    return null;
  }
}

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

  if (parsed.kind === 'ad-line-items' && parsed.adLineItems) {
    const channels = [...new Set(parsed.adLineItems.map((r) => r.channel))];
    for (const channel of channels) {
      await d1.query(databaseId, `DELETE FROM ad_line_items WHERE period_month = ? AND channel = ?`, [
        month,
        channel,
      ]);
    }
    for (const row of parsed.adLineItems) {
      await d1.query(
        databaseId,
        `INSERT INTO ad_line_items (period_month, channel, campaign, ad_name, ad_id, creative_type, creative_type_source, spend, leads_reported)
         VALUES (?, ?, ?, ?, ?, ?, 'auto', ?, ?)
         ON CONFLICT (period_month, channel, campaign, ad_name) DO UPDATE SET
           ad_id = excluded.ad_id, creative_type = excluded.creative_type, creative_type_source = 'auto',
           spend = excluded.spend, leads_reported = excluded.leads_reported`,
        [row.periodMonth, row.channel, row.campaign, row.adName, row.adId, row.creativeType, row.spend, row.leadsReported]
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

  if (parsed.kind === 'd2d-accounts') {
    // Contacts first, so the stage events inserted below always reference
    // an existing contact. The account id from the export IS the contact
    // id, which is what lets a June close land on a May-knocked contact
    // across separate monthly imports.
    for (const contact of parsed.contacts ?? []) {
      const eventId = `ev_imp_${(await sha256Hex(`${sourceKey}:${contact.externalRef}`)).slice(0, 32)}`;
      await d1.query(
        databaseId,
        `INSERT OR IGNORE INTO events (id, occurred_at, source_key, event_type, contact_id, payload_json)
         VALUES (?, ?, ?, 'integration_event', ?, ?)`,
        [
          eventId,
          contact.createdAt,
          sourceKey,
          contact.externalRef,
          JSON.stringify({ followupStage: contact.followupStage, channel: contact.channel }),
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
          treatment: null,
        },
        {
          at: contact.createdAt,
          channel: contact.channel,
          source: contact.sourceRaw,
          campaign: contact.campaign,
          json: {},
          sourceKey,
          eventId,
        }
      );
    }

    const stages = [...new Set((parsed.d2dStageEvents ?? []).map((e) => e.stage))];
    for (const stage of stages) {
      await d1.query(
        databaseId,
        `DELETE FROM stage_events WHERE source_key = ? AND stage = ? AND occurred_at >= ? AND occurred_at < ?`,
        [sourceKey, stage, monthStart, monthEnd]
      );
    }
    for (const ev of parsed.d2dStageEvents ?? []) {
      await d1.query(
        databaseId,
        `INSERT OR IGNORE INTO stage_events (id, contact_id, external_ref, stage, occurred_at, source_key, raw_json)
         VALUES (?, ?, ?, ?, ?, ?, '{}')`,
        [`se_${randomToken(8)}`, ev.contactId, `${ev.stage}:${ev.contactId}`, ev.stage, ev.occurredAt, sourceKey]
      );
    }

    await d1.query(databaseId, `DELETE FROM rep_metrics WHERE period_month = ? AND source_key = ?`, [
      month,
      sourceKey,
    ]);
    for (const rep of parsed.repMetrics ?? []) {
      await d1.query(
        databaseId,
        `INSERT INTO rep_metrics (period_month, source_key, rep, knocks, pitches, appointments_set, sits_set, sits_run, closes, installs)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          rep.periodMonth,
          sourceKey,
          rep.rep,
          rep.knocks,
          rep.pitches,
          rep.appointmentsSet,
          rep.sitsSet,
          rep.sitsRun,
          rep.closes,
          rep.installs,
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
