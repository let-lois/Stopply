// Boulevard connector. API key and business id credentials. Pulls
// appointments (booked, confirmed, arrived map to scheduled; final maps
// to completed), detailed line items (purchase events with amounts), and
// client records (the identity bridge). Field semantics match the Be
// Clinical build exactly: appointment Client Id equals ClientRecord id,
// line items join by normalized name only.

import { emailNorm, nameNorm, parseMoney, phoneLast10, toIso } from '@letlois/attribution';
import type { Connector, ConnectorContext, ConnectorDb, SyncStats, TestConnectionResult } from './types';
import { monthRange } from './types';
import { writeClientRecords, writeStageEvents, type ConnectorStageEvent } from './stageWriter';

const BASE = 'https://dashboard.boulevard.io/api/2020-01';

function headers(creds: Record<string, string>): Record<string, string> {
  return {
    authorization: `Basic ${btoa(`${creds.apiKey ?? ''}:`)}`,
    'x-business-id': creds.businessId ?? '',
    'content-type': 'application/json',
  };
}

async function api(
  creds: Record<string, string>,
  path: string,
  ctx?: ConnectorContext
): Promise<{ status: number; json: Record<string, unknown> | null }> {
  const f = ctx?.fetchImpl ?? fetch;
  const res = await f(`${BASE}${path}`, { headers: headers(creds) });
  let json: Record<string, unknown> | null = null;
  try {
    json = (await res.json()) as Record<string, unknown>;
  } catch {
    json = null;
  }
  return { status: res.status, json };
}

export const boulevardConnector: Connector = {
  provider: 'boulevard',

  getRequirements() {
    return {
      provider: 'boulevard',
      displayName: 'Boulevard',
      authKind: 'api_key' as const,
      credentialFields: [
        { key: 'apiKey', label: 'API key', secret: true },
        { key: 'businessId', label: 'Business ID', secret: false },
      ],
      planRequirement: 'Boulevard API access is included on all Boulevard plans with the Admin API enabled.',
      planLink: 'https://developers.joinblvd.com/',
      tokenGuide: [
        'In Boulevard, open Manage Business, then Integrations, then API.',
        'Create an API key and copy it together with your Business ID.',
        'Paste both here and select Test connection.',
      ],
      defaultStageMap: [
        { externalEvent: 'appointment.booked', stage: 'scheduled' as const },
        { externalEvent: 'appointment.confirmed', stage: 'scheduled' as const },
        { externalEvent: 'appointment.arrived', stage: 'scheduled' as const },
        { externalEvent: 'appointment.final', stage: 'completed' as const },
        { externalEvent: 'sale.line_item', stage: 'purchase' as const },
      ],
    };
  },

  async testConnection(creds, ctx): Promise<TestConnectionResult> {
    if (!creds.apiKey || !creds.businessId) {
      return { ok: false, failure: 'bad_credentials', message: 'API key and business id are required' };
    }
    try {
      const { status, json } = await api(creds, '/business', ctx);
      if (status === 401) return { ok: false, failure: 'bad_credentials', message: 'Boulevard rejected the API key' };
      if (status === 403) {
        return {
          ok: false,
          failure: 'insufficient_plan',
          message: 'This Boulevard account does not have Admin API access enabled',
          planCheck: json ?? undefined,
        };
      }
      if (status >= 400) return { ok: false, failure: 'error', message: `Boulevard API returned ${status}` };
      const name = (json?.name as string) ?? (json?.businessName as string) ?? 'Boulevard business';
      return { ok: true, connectedAs: name, planCheck: { status, scopes: json?.scopes ?? null } };
    } catch (err) {
      return { ok: false, failure: 'error', message: err instanceof Error ? err.message : 'network error' };
    }
  },

  async syncMonth(creds, month, db: ConnectorDb, sourceKey, ctx): Promise<SyncStats> {
    const { from, to } = monthRange(month);
    const stats: SyncStats = { scheduled: 0, completed: 0, purchases: 0, clientRecords: 0 };

    // Client records first: the identity bridge.
    const clients = await api(creds, `/clients?updated_since=${encodeURIComponent(from)}`, ctx);
    const clientList = (clients.json?.clients as Array<Record<string, unknown>>) ?? [];
    await writeClientRecords(
      db,
      sourceKey,
      clientList.map((c) => ({
        clientId: String(c.id ?? ''),
        email: emailNorm(c.email),
        phoneLast10: phoneLast10(c.mobile_phone ?? c.phone),
        nameNorm: nameNorm(`${c.first_name ?? ''} ${c.last_name ?? ''}`),
      })).filter((c) => c.clientId)
    );
    stats.clientRecords = clientList.length;

    const events: ConnectorStageEvent[] = [];

    const appts = await api(
      creds,
      `/appointments?start_at_gte=${encodeURIComponent(from)}&start_at_lt=${encodeURIComponent(to)}`,
      ctx
    );
    for (const a of (appts.json?.appointments as Array<Record<string, unknown>>) ?? []) {
      const at = toIso(a.start_at ?? a.startAt);
      if (!at) continue;
      const state = String(a.state ?? '').toLowerCase();
      const clientId = a.client_id ? String(a.client_id) : null;
      const name = nameNorm(a.client_name);
      const stage = ctx?.stageMap?.get(`appointment.${state}`) ??
        (/booked|confirmed|arrived|final/.test(state) ? 'scheduled' : null);
      if (stage) {
        events.push({ externalRef: `blvd-appt:${a.id}`, stage, occurredAt: at, amount: null, clientId, nameNorm: name });
        stats.scheduled++;
      }
      const finalStage = ctx?.stageMap?.get('appointment.final') ?? 'completed';
      if (/final/.test(state)) {
        events.push({ externalRef: `blvd-appt-completed:${a.id}`, stage: finalStage, occurredAt: at, amount: null, clientId, nameNorm: name });
        stats.completed++;
      }
    }

    const lines = await api(
      creds,
      `/line_items?closed_at_gte=${encodeURIComponent(from)}&closed_at_lt=${encodeURIComponent(to)}`,
      ctx
    );
    for (const li of (lines.json?.line_items as Array<Record<string, unknown>>) ?? []) {
      const at = toIso(li.closed_at ?? li.sale_date);
      if (!at) continue;
      // Line items join by normalized name only, per the Be Clinical
      // field semantics.
      events.push({
        externalRef: `blvd-line:${li.id}`,
        stage: ctx?.stageMap?.get('sale.line_item') ?? 'purchase',
        occurredAt: at,
        amount: parseMoney(li.net_sales ?? li.amount),
        nameNorm: nameNorm(li.client_name),
      });
      stats.purchases++;
    }

    await writeStageEvents(db, sourceKey, events);
    return stats;
  },
};
