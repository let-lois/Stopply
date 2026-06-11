// Housecall Pro connector. API key auth. Jobs created map to scheduled,
// jobs completed to completed, invoices paid to purchase with amount.
// HCP webhooks can deliver live events where available; the cron sync
// remains the source of truth reconciliation.

import { emailNorm, nameNorm, parseMoney, phoneLast10, toIso } from '@letlois/attribution';
import type { Connector, ConnectorContext, ConnectorDb, SyncStats, TestConnectionResult } from './types';
import { monthRange } from './types';
import { writeClientRecords, writeStageEvents, type ConnectorStageEvent } from './stageWriter';

const BASE = 'https://api.housecallpro.com';

async function api(
  creds: Record<string, string>,
  path: string,
  ctx?: ConnectorContext
): Promise<{ status: number; json: Record<string, unknown> | null }> {
  const f = ctx?.fetchImpl ?? fetch;
  const res = await f(`${BASE}${path}`, {
    headers: { authorization: `Bearer ${creds.apiKey ?? ''}`, accept: 'application/json' },
  });
  let json: Record<string, unknown> | null = null;
  try {
    json = (await res.json()) as Record<string, unknown>;
  } catch {
    json = null;
  }
  return { status: res.status, json };
}

export const housecallProConnector: Connector = {
  provider: 'housecallpro',

  getRequirements() {
    return {
      provider: 'housecallpro',
      displayName: 'Housecall Pro',
      authKind: 'api_key' as const,
      credentialFields: [{ key: 'apiKey', label: 'API key', secret: true }],
      planRequirement:
        'Housecall Pro requires the MAX plan (or the API add on) for API access. Check your plan before connecting.',
      planLink: 'https://www.housecallpro.com/pricing/',
      tokenGuide: [
        'In Housecall Pro, open Settings, then API access.',
        'Generate an API token and copy it.',
        'Paste it here and select Test connection. If your plan lacks API access this panel will say so.',
      ],
      defaultStageMap: [
        { externalEvent: 'job.created', stage: 'scheduled' as const },
        { externalEvent: 'job.completed', stage: 'completed' as const },
        { externalEvent: 'invoice.paid', stage: 'purchase' as const },
      ],
    };
  },

  async testConnection(creds, ctx): Promise<TestConnectionResult> {
    if (!creds.apiKey) return { ok: false, failure: 'bad_credentials', message: 'API key is required' };
    try {
      const { status, json } = await api(creds, '/company', ctx);
      if (status === 401) return { ok: false, failure: 'bad_credentials', message: 'Housecall Pro rejected the token' };
      if (status === 403) {
        return {
          ok: false,
          failure: 'insufficient_plan',
          message: 'This Housecall Pro plan does not include API access. The MAX plan or API add on is required.',
          planCheck: json ?? undefined,
        };
      }
      if (status >= 400) return { ok: false, failure: 'error', message: `Housecall Pro API returned ${status}` };
      return {
        ok: true,
        connectedAs: (json?.name as string) ?? 'Housecall Pro company',
        planCheck: { status, plan: json?.plan ?? null },
      };
    } catch (err) {
      return { ok: false, failure: 'error', message: err instanceof Error ? err.message : 'network error' };
    }
  },

  async syncMonth(creds, month, db: ConnectorDb, sourceKey, ctx): Promise<SyncStats> {
    const { from, to } = monthRange(month);
    const stats: SyncStats = { scheduled: 0, completed: 0, purchases: 0, clientRecords: 0 };
    const events: ConnectorStageEvent[] = [];

    const customers = await api(creds, `/customers?page_size=200`, ctx);
    const customerList = (customers.json?.customers as Array<Record<string, unknown>>) ?? [];
    await writeClientRecords(
      db,
      sourceKey,
      customerList
        .map((c) => ({
          clientId: String(c.id ?? ''),
          email: emailNorm(c.email),
          phoneLast10: phoneLast10(c.mobile_number ?? c.home_number),
          nameNorm: nameNorm(`${c.first_name ?? ''} ${c.last_name ?? ''}`),
        }))
        .filter((c) => c.clientId)
    );
    stats.clientRecords = customerList.length;

    const jobs = await api(
      creds,
      `/jobs?scheduled_start_min=${encodeURIComponent(from)}&scheduled_start_max=${encodeURIComponent(to)}&page_size=200`,
      ctx
    );
    for (const job of (jobs.json?.jobs as Array<Record<string, unknown>>) ?? []) {
      const created = toIso(job.created_at);
      const customer = job.customer as Record<string, unknown> | undefined;
      const clientId = customer?.id ? String(customer.id) : null;
      const status = String(job.work_status ?? '').toLowerCase();
      if (created) {
        events.push({
          externalRef: `hcp-job:${job.id}`,
          stage: ctx?.stageMap?.get('job.created') ?? 'scheduled',
          occurredAt: created,
          amount: null,
          clientId,
        });
        stats.scheduled++;
      }
      const completedAt = toIso(job.completed_at);
      if (completedAt && /complete/.test(status)) {
        events.push({
          externalRef: `hcp-job-completed:${job.id}`,
          stage: ctx?.stageMap?.get('job.completed') ?? 'completed',
          occurredAt: completedAt,
          amount: null,
          clientId,
        });
        stats.completed++;
      }
    }

    const invoices = await api(
      creds,
      `/invoices?paid_at_min=${encodeURIComponent(from)}&paid_at_max=${encodeURIComponent(to)}&page_size=200`,
      ctx
    );
    for (const inv of (invoices.json?.invoices as Array<Record<string, unknown>>) ?? []) {
      const paidAt = toIso(inv.paid_at);
      if (!paidAt) continue;
      events.push({
        externalRef: `hcp-invoice:${inv.id}`,
        stage: ctx?.stageMap?.get('invoice.paid') ?? 'purchase',
        occurredAt: paidAt,
        amount: parseMoney(inv.amount ?? inv.total),
        clientId: inv.customer_id ? String(inv.customer_id) : null,
      });
      stats.purchases++;
    }

    await writeStageEvents(db, sourceKey, events);
    return stats;
  },

  async handleWebhook(payload, db, sourceKey): Promise<void> {
    const event = String(payload.event ?? '');
    const job = payload.job as Record<string, unknown> | undefined;
    const invoice = payload.invoice as Record<string, unknown> | undefined;
    const events: ConnectorStageEvent[] = [];
    if (event === 'job.created' && job) {
      const at = toIso(job.created_at) ?? new Date().toISOString();
      events.push({ externalRef: `hcp-job:${job.id}`, stage: 'scheduled', occurredAt: at, amount: null, clientId: job.customer_id ? String(job.customer_id) : null });
    }
    if (event === 'job.completed' && job) {
      const at = toIso(job.completed_at) ?? new Date().toISOString();
      events.push({ externalRef: `hcp-job-completed:${job.id}`, stage: 'completed', occurredAt: at, amount: null, clientId: job.customer_id ? String(job.customer_id) : null });
    }
    if (event === 'invoice.paid' && invoice) {
      const at = toIso(invoice.paid_at) ?? new Date().toISOString();
      events.push({ externalRef: `hcp-invoice:${invoice.id}`, stage: 'purchase', occurredAt: at, amount: parseMoney(invoice.amount), clientId: invoice.customer_id ? String(invoice.customer_id) : null });
    }
    await writeStageEvents(db, sourceKey, events);
  },
};
