import { Hono } from 'hono';
import { z } from 'zod';
import { deriveChannel, emailNorm, phoneLast10, readClickId, toIso } from '@letlois/attribution';
import type { TenantRow } from '@letlois/db';
import type { AppContext } from '../env';
import { hmacSha256Hex, randomToken, sha256Hex, timingSafeEqualHex } from '../crypto';
import { LIMITS, rateLimit } from '../ratelimit';
import { deriveSourceSecret, tenantD1Client } from '../provisioning';
import { getTenantBySlug } from '../tenantResolver';
import { stitchVisitor, upsertContact } from '../ingest/contacts';
import { scheduleRollup } from '../ingest/rollupTrigger';

export const ingestRoutes = new Hono<AppContext>();

// The pixel posts cross origin from client websites using text/plain
// beacons (no preflight). Webhooks come from servers. Both get open CORS
// on this prefix only; auth is the signing secret, not the origin.
ingestRoutes.use('*', async (c, next) => {
  if (c.req.method === 'OPTIONS') {
    return c.body(null, 204, {
      'access-control-allow-origin': '*',
      'access-control-allow-methods': 'POST, OPTIONS',
      'access-control-allow-headers': 'content-type, x-lbi-signature, authorization',
      'access-control-max-age': '86400',
    });
  }
  await next();
  c.header('access-control-allow-origin', '*');
});

const MAX_BODY_BYTES = 32 * 1024;

async function resolveSlugTenant(c: { env: AppContext['Bindings'] }, slug: string): Promise<TenantRow | null> {
  if (!/^[a-z0-9-]{2,40}$/.test(slug)) return null;
  return getTenantBySlug(c.env, slug);
}

// Pixel event batches from the tracking script.
const pixelEventSchema = z.object({
  k: z.enum(['page_view', 'form_partial', 'form_submit', 'identify']),
  t: z.string().max(40),
  u: z.string().max(2048).optional(),
  r: z.string().max(2048).nullable().optional(),
  fi: z.string().max(64).optional(),
  fd: z.record(z.string().max(120), z.unknown()).optional(),
});

const pixelBodySchema = z.object({
  vid: z.string().regex(/^[0-9a-f]{16,64}$/),
  ft: z
    .object({
      u: z.string().max(2048).nullable().optional(),
      r: z.string().max(2048).nullable().optional(),
      us: z.string().max(256).nullable().optional(),
      um: z.string().max(256).nullable().optional(),
      uc: z.string().max(256).nullable().optional(),
      ut: z.string().max(256).nullable().optional(),
      uo: z.string().max(256).nullable().optional(),
      g: z.string().max(512).nullable().optional(),
      f: z.string().max(512).nullable().optional(),
      w: z.string().max(512).nullable().optional(),
      m: z.string().max(512).nullable().optional(),
      t: z.string().max(40).nullable().optional(),
    })
    .nullable()
    .optional(),
  ev: z.array(pixelEventSchema).max(50),
});

// Sensitive field guard, applied server side as well as in the script.
const SENSITIVE_FIELD = /password|card|cc[-_]?num|cc[-_]?csc|cvc|cvv|ssn|social/i;

function scrubFields(fields: Record<string, unknown> | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!fields) return out;
  for (const [k, v] of Object.entries(fields)) {
    if (SENSITIVE_FIELD.test(k)) continue;
    if (v === null || v === undefined) continue;
    out[k] = String(v).slice(0, 1000);
  }
  return out;
}

ingestRoutes.post('/:slug/pixel', async (c) => {
  const tenant = await resolveSlugTenant(c, c.req.param('slug'));
  if (!tenant?.d1_database_id) return c.json({ error: 'not found' }, 404);

  const raw = await c.req.text();
  if (raw.length > MAX_BODY_BYTES) return c.json({ error: 'payload too large' }, 413);
  let parsed: z.infer<typeof pixelBodySchema>;
  try {
    const body = pixelBodySchema.safeParse(JSON.parse(raw));
    if (!body.success) return c.json({ error: 'invalid payload' }, 400);
    parsed = body.data;
  } catch {
    return c.json({ error: 'invalid json' }, 400);
  }

  const vidOk = await rateLimit(c.env, LIMITS.ingestVisitor, `${tenant.id}:${parsed.vid}`);
  const tenantOk = await rateLimit(c.env, LIMITS.ingestTenant, tenant.id);
  if (!vidOk || !tenantOk) return c.json({ error: 'rate limited' }, 429);

  // The raw IP is never stored: hash it with the tenant scoped pepper.
  const ip = c.req.header('cf-connecting-ip') ?? '0.0.0.0';
  const ipHash = await hmacSha256Hex(c.env.INGEST_PEPPER, `${tenant.id}:${ip}`);
  const userAgent = (c.req.header('user-agent') ?? '').slice(0, 256);

  const d1 = tenantD1Client(c.env);
  const databaseId = tenant.d1_database_id;
  const now = new Date().toISOString();
  const ft = parsed.ft;

  // Upsert the visitor with persisted first touch context.
  await d1.query(
    databaseId,
    `INSERT INTO visitors (id, first_seen_at, last_seen_at, first_landing_page, first_referrer, first_utm_json, first_click_ids_json)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (id) DO UPDATE SET last_seen_at = excluded.last_seen_at`,
    [
      parsed.vid,
      ft?.t ?? now,
      now,
      ft?.u ?? null,
      ft?.r ?? null,
      JSON.stringify({ source: ft?.us ?? null, medium: ft?.um ?? null, campaign: ft?.uc ?? null, term: ft?.ut ?? null, content: ft?.uo ?? null }),
      JSON.stringify({ gclid: ft?.g ?? null, fbclid: ft?.f ?? null, wbraid: ft?.w ?? null, msclkid: ft?.m ?? null }),
    ]
  );

  for (const ev of parsed.ev) {
    const eventType = ev.k === 'identify' ? 'form_submit' : ev.k;
    const fields = scrubFields(ev.fd);
    const eventId = `ev_${randomToken(10)}`;
    await d1.query(
      databaseId,
      `INSERT INTO events (id, occurred_at, source_key, event_type, visitor_id, payload_json,
         utm_source, utm_medium, utm_campaign, utm_term, utm_content, gclid, fbclid, wbraid, msclkid,
         referrer, landing_page, ip_hash, user_agent)
       VALUES (?, ?, 'website-pixel', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        eventId,
        toIso(ev.t) ?? now,
        eventType,
        parsed.vid,
        JSON.stringify({ kind: ev.k, formInstance: ev.fi ?? null, fields, url: ev.u ?? null }),
        ft?.us ?? null,
        ft?.um ?? null,
        ft?.uc ?? null,
        ft?.ut ?? null,
        ft?.uo ?? null,
        ft?.g ?? null,
        ft?.f ?? null,
        ft?.w ?? null,
        ft?.m ?? null,
        ev.r ?? null,
        ev.u ?? null,
        ipHash,
        userAgent,
      ]
    );

    // Stitch the visitor to a contact on submit or identify.
    if (ev.k === 'form_submit' || ev.k === 'identify') {
      const email = emailNorm(fields.email ?? fields.Email ?? null);
      const phone = phoneLast10(fields.phone ?? fields.Phone ?? null);
      if (email || phone) {
        await stitchVisitor(d1, databaseId, parsed.vid, { email, phone });
      }
    }
  }

  await scheduleRollup(c.env, tenant.id);
  return c.json({ ok: true });
});

// Webhook ingest with per source signing. Accepts an HMAC SHA256
// signature of the raw body in x-lbi-signature, or the secret itself as a
// bearer token.
ingestRoutes.post('/:slug/:sourceKey', async (c) => {
  const tenant = await resolveSlugTenant(c, c.req.param('slug'));
  if (!tenant?.d1_database_id) return c.json({ error: 'not found' }, 404);
  const sourceKey = c.req.param('sourceKey');
  if (!/^[a-z0-9-]{1,60}$/.test(sourceKey)) return c.json({ error: 'not found' }, 404);

  const raw = await c.req.text();
  if (raw.length > MAX_BODY_BYTES) return c.json({ error: 'payload too large' }, 413);

  const d1 = tenantD1Client(c.env);
  const databaseId = tenant.d1_database_id;
  const { results } = await d1.query<{ key: string; kind: string; signing_secret_hash: string | null; field_map_json: string | null }>(
    databaseId,
    `SELECT key, kind, signing_secret_hash, field_map_json FROM sources WHERE key = ?`,
    [sourceKey]
  );
  const source = results[0];
  if (!source || source.kind !== 'webhook') return c.json({ error: 'not found' }, 404);
  if (!source.signing_secret_hash) return c.json({ error: 'source has no signing secret' }, 401);

  const [version, nonce, storedHash] = source.signing_secret_hash.split('$');
  if (version !== 'v1' || !nonce || !storedHash) return c.json({ error: 'unauthorized' }, 401);
  const secret = await deriveSourceSecret(c.env, tenant.id, sourceKey, nonce);

  let authorized = false;
  const sigHeader = c.req.header('x-lbi-signature');
  const authHeader = c.req.header('authorization');
  if (sigHeader) {
    const expected = await hmacSha256Hex(secret, raw);
    authorized = timingSafeEqualHex(expected, sigHeader.toLowerCase().replace(/^sha256=/, ''));
  } else if (authHeader?.toLowerCase().startsWith('bearer ')) {
    const presented = authHeader.slice(7).trim();
    authorized = timingSafeEqualHex(await sha256Hex(presented), storedHash);
  }
  if (!authorized) return c.json({ error: 'unauthorized' }, 401);

  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return c.json({ error: 'invalid json' }, 400);
  }

  const mapped = source.field_map_json
    ? applyFieldMap(payload, JSON.parse(source.field_map_json) as Record<string, string>)
    : mapGhlPayload(payload);

  const occurredAt = mapped.createdAt ?? new Date().toISOString();
  // Deterministic event id from the body hash: replaying the same webhook
  // does not duplicate the event, the contact, or the lead stage event.
  const eventId = `ev_wh_${(await sha256Hex(`${tenant.id}:${sourceKey}:${raw}`)).slice(0, 32)}`;

  await d1.query(
    databaseId,
    `INSERT OR IGNORE INTO events (id, occurred_at, source_key, event_type, contact_id, payload_json,
       utm_source, utm_medium, utm_campaign, utm_term, utm_content, gclid)
     VALUES (?, ?, ?, 'webhook_lead', ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      eventId,
      occurredAt,
      sourceKey,
      mapped.externalRef,
      raw.slice(0, 16000),
      mapped.utm.source,
      mapped.utm.medium,
      mapped.utm.campaign,
      mapped.utm.term,
      mapped.utm.content,
      mapped.clickId,
    ]
  );

  const channel = deriveChannel({
    utmSource: mapped.utm.source,
    siteSourceName: mapped.siteSourceName,
    campaignName: mapped.campaign,
    tags: mapped.tags,
    gclid: mapped.clickId,
    fbclid: mapped.fbclid,
  });

  const { contactId } = await upsertContact(
    d1,
    databaseId,
    {
      externalRef: mapped.externalRef,
      firstName: mapped.firstName,
      lastName: mapped.lastName,
      email: mapped.email,
      phone: mapped.phone,
      createdAt: occurredAt,
      followupStage: mapped.followupStage,
      treatment: mapped.treatment,
    },
    {
      at: occurredAt,
      channel,
      source: mapped.utm.source ?? mapped.siteSourceName,
      campaign: mapped.campaign,
      json: { utm: mapped.utm, clickId: mapped.clickId, adName: mapped.adName, tags: mapped.tags },
      sourceKey,
      eventId,
    }
  );

  // Lead stage event, deduped on (stage, external_ref).
  await d1.query(
    databaseId,
    `INSERT OR IGNORE INTO stage_events (id, contact_id, external_ref, stage, occurred_at, source_key, raw_json)
     VALUES (?, ?, ?, 'lead', ?, ?, ?)`,
    [
      `se_${randomToken(8)}`,
      contactId,
      `lead:${mapped.externalRef ?? contactId}`,
      occurredAt,
      sourceKey,
      JSON.stringify({ followupStage: mapped.followupStage, treatment: mapped.treatment }),
    ]
  );

  await scheduleRollup(c.env, tenant.id);
  return c.json({ ok: true, contactId });
});

interface MappedLead {
  externalRef: string | null;
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  phone: string | null;
  createdAt: string | null;
  followupStage: string | null;
  treatment: string | null;
  tags: string | null;
  campaign: string | null;
  adName: string | null;
  siteSourceName: string | null;
  clickId: string | null;
  fbclid: string | null;
  utm: {
    source: string | null;
    medium: string | null;
    campaign: string | null;
    term: string | null;
    content: string | null;
  };
}

function str(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s || null;
}

// GHL preset payload mapping. Reads both clickld (lowercase L) and
// clickid spellings via readClickId.
export function mapGhlPayload(p: Record<string, unknown>): MappedLead {
  const get = (...keys: string[]): string | null => {
    for (const key of keys) {
      for (const actual of Object.keys(p)) {
        if (actual.toLowerCase().replace(/[^a-z0-9]/g, '') === key.toLowerCase().replace(/[^a-z0-9]/g, '')) {
          const v = str(p[actual]);
          if (v) return v;
        }
      }
    }
    return null;
  };
  return {
    externalRef: get('contact_id', 'contactId', 'id'),
    firstName: get('first_name', 'firstName'),
    lastName: get('last_name', 'lastName'),
    email: get('email'),
    phone: get('phone'),
    createdAt: toIso(get('date_created', 'created', 'createdAt', 'date_added')),
    followupStage: get('followup_stage', 'followupStage', 'stage'),
    treatment: get('treatment_of_interest', 'treatment'),
    tags: get('tags'),
    campaign: get('campaign_name', 'campaign'),
    adName: get('ad_name', 'adName'),
    siteSourceName: get('site_source_name', 'siteSourceName'),
    clickId: readClickId(p),
    fbclid: get('fbclid'),
    utm: {
      source: get('utm_source'),
      medium: get('utm_medium'),
      campaign: get('utm_campaign'),
      term: get('utm_term'),
      content: get('utm_content'),
    },
  };
}

// Generic JSON mapping: an admin configured map of canonical field to a
// dotted JSON path into the payload.
export function applyFieldMap(p: Record<string, unknown>, map: Record<string, string>): MappedLead {
  const at = (path: string | undefined): string | null => {
    if (!path) return null;
    let cur: unknown = p;
    for (const part of path.split('.')) {
      if (cur === null || typeof cur !== 'object') return null;
      cur = (cur as Record<string, unknown>)[part];
    }
    return str(cur);
  };
  return {
    externalRef: at(map.externalRef),
    firstName: at(map.firstName),
    lastName: at(map.lastName),
    email: at(map.email),
    phone: at(map.phone),
    createdAt: toIso(at(map.createdAt)),
    followupStage: at(map.followupStage),
    treatment: at(map.treatment),
    tags: at(map.tags),
    campaign: at(map.campaign),
    adName: at(map.adName),
    siteSourceName: at(map.siteSourceName),
    clickId: at(map.clickId) ?? readClickId(p),
    fbclid: at(map.fbclid),
    utm: {
      source: at(map.utmSource),
      medium: at(map.utmMedium),
      campaign: at(map.utmCampaign),
      term: at(map.utmTerm),
      content: at(map.utmContent),
    },
  };
}
