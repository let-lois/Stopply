// Jobber connector. OAuth 2.0 via a Jobber developer app: the vault holds
// the refresh token; access tokens refresh automatically before each
// call. Same job and invoice stage mapping as Housecall Pro.

import { emailNorm, nameNorm, parseMoney, phoneLast10, toIso } from '@letlois/attribution';
import type { Connector, ConnectorContext, ConnectorDb, SyncStats, TestConnectionResult } from './types';
import { monthRange } from './types';
import { writeClientRecords, writeStageEvents, type ConnectorStageEvent } from './stageWriter';

const TOKEN_URL = 'https://api.getjobber.com/api/oauth/token';
const GRAPHQL_URL = 'https://api.getjobber.com/api/graphql';

interface JobberTokens {
  accessToken: string;
  refreshToken: string;
}

export async function refreshJobberToken(
  creds: Record<string, string>,
  ctx?: ConnectorContext
): Promise<{ tokens: JobberTokens | null; status: number }> {
  const f = ctx?.fetchImpl ?? fetch;
  const res = await f(TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: creds.refreshToken ?? '',
      client_id: creds.clientId ?? '',
      client_secret: creds.clientSecret ?? '',
    }).toString(),
  });
  if (!res.ok) return { tokens: null, status: res.status };
  const json = (await res.json()) as { access_token?: string; refresh_token?: string };
  if (!json.access_token) return { tokens: null, status: res.status };
  return {
    tokens: { accessToken: json.access_token, refreshToken: json.refresh_token ?? creds.refreshToken ?? '' },
    status: res.status,
  };
}

async function graphql(
  accessToken: string,
  query: string,
  variables: Record<string, unknown>,
  ctx?: ConnectorContext
): Promise<{ status: number; data: Record<string, unknown> | null; errors: unknown[] | null }> {
  const f = ctx?.fetchImpl ?? fetch;
  const res = await f(GRAPHQL_URL, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${accessToken}`,
      'content-type': 'application/json',
      'x-jobber-graphql-version': '2024-06-10',
    },
    body: JSON.stringify({ query, variables }),
  });
  let body: { data?: Record<string, unknown>; errors?: unknown[] } = {};
  try {
    body = (await res.json()) as typeof body;
  } catch {
    body = {};
  }
  return { status: res.status, data: body.data ?? null, errors: body.errors ?? null };
}

export const jobberConnector: Connector = {
  provider: 'jobber',

  getRequirements() {
    return {
      provider: 'jobber',
      displayName: 'Jobber',
      authKind: 'oauth2' as const,
      credentialFields: [
        { key: 'clientId', label: 'Developer app client id', secret: false },
        { key: 'clientSecret', label: 'Developer app client secret', secret: true },
        { key: 'refreshToken', label: 'Refresh token (set by the OAuth flow)', secret: true },
      ],
      planRequirement:
        'Jobber API access is available on the Connect and Grow plans. The Core plan does not include API access.',
      planLink: 'https://getjobber.com/pricing/',
      tokenGuide: [
        'Select Connect with Jobber to start the OAuth flow.',
        'Sign in with your Jobber account and approve access.',
        'You will return here automatically; then run Test connection.',
      ],
      defaultStageMap: [
        { externalEvent: 'job.created', stage: 'scheduled' as const },
        { externalEvent: 'job.completed', stage: 'completed' as const },
        { externalEvent: 'invoice.paid', stage: 'purchase' as const },
      ],
    };
  },

  async testConnection(creds, ctx): Promise<TestConnectionResult> {
    if (!creds.refreshToken) {
      return { ok: false, failure: 'bad_credentials', message: 'Connect with Jobber first to obtain tokens' };
    }
    try {
      const { tokens, status } = await refreshJobberToken(creds, ctx);
      if (!tokens) {
        return status === 401 || status === 400
          ? { ok: false, failure: 'bad_credentials', message: 'Jobber rejected the refresh token; reconnect' }
          : { ok: false, failure: 'error', message: `Jobber token endpoint returned ${status}` };
      }
      const account = await graphql(tokens.accessToken, `query { account { name } }`, {}, ctx);
      if (account.status === 403) {
        return {
          ok: false,
          failure: 'insufficient_plan',
          message: 'This Jobber plan does not include API access. Connect or Grow is required.',
        };
      }
      const name = ((account.data?.account as Record<string, unknown>)?.name as string) ?? 'Jobber account';
      return { ok: true, connectedAs: name, planCheck: { status: account.status } };
    } catch (err) {
      return { ok: false, failure: 'error', message: err instanceof Error ? err.message : 'network error' };
    }
  },

  async syncMonth(creds, month, db: ConnectorDb, sourceKey, ctx): Promise<SyncStats> {
    const stats: SyncStats = { scheduled: 0, completed: 0, purchases: 0, clientRecords: 0 };
    const { tokens } = await refreshJobberToken(creds, ctx);
    if (!tokens) throw new Error('Jobber token refresh failed');
    const { from, to } = monthRange(month);

    const clientsQuery = `query Clients($after: String) {
      clients(first: 100, after: $after) {
        nodes { id name emails { address } phones { number } }
        pageInfo { hasNextPage endCursor }
      }
    }`;
    const clients = await graphql(tokens.accessToken, clientsQuery, {}, ctx);
    const clientNodes =
      ((clients.data?.clients as Record<string, unknown>)?.nodes as Array<Record<string, unknown>>) ?? [];
    await writeClientRecords(
      db,
      sourceKey,
      clientNodes
        .map((c) => ({
          clientId: String(c.id ?? ''),
          email: emailNorm((c.emails as Array<{ address?: string }>)?.[0]?.address),
          phoneLast10: phoneLast10((c.phones as Array<{ number?: string }>)?.[0]?.number),
          nameNorm: nameNorm(c.name),
        }))
        .filter((c) => c.clientId)
    );
    stats.clientRecords = clientNodes.length;

    const events: ConnectorStageEvent[] = [];
    const jobsQuery = `query Jobs($start: ISO8601DateTime!, $end: ISO8601DateTime!) {
      jobs(filter: { createdAt: { after: $start, before: $end } }, first: 100) {
        nodes { id createdAt completedAt jobStatus client { id } }
      }
    }`;
    const jobs = await graphql(tokens.accessToken, jobsQuery, { start: from, end: to }, ctx);
    for (const job of ((jobs.data?.jobs as Record<string, unknown>)?.nodes as Array<Record<string, unknown>>) ?? []) {
      const created = toIso(job.createdAt);
      const clientId = (job.client as Record<string, unknown>)?.id;
      if (created) {
        events.push({
          externalRef: `jobber-job:${job.id}`,
          stage: ctx?.stageMap?.get('job.created') ?? 'scheduled',
          occurredAt: created,
          amount: null,
          clientId: clientId ? String(clientId) : null,
        });
        stats.scheduled++;
      }
      const completedAt = toIso(job.completedAt);
      if (completedAt) {
        events.push({
          externalRef: `jobber-job-completed:${job.id}`,
          stage: ctx?.stageMap?.get('job.completed') ?? 'completed',
          occurredAt: completedAt,
          amount: null,
          clientId: clientId ? String(clientId) : null,
        });
        stats.completed++;
      }
    }

    const invoicesQuery = `query Invoices($start: ISO8601DateTime!, $end: ISO8601DateTime!) {
      invoices(filter: { paidAt: { after: $start, before: $end } }, first: 100) {
        nodes { id paidAt total client { id } }
      }
    }`;
    const invoices = await graphql(tokens.accessToken, invoicesQuery, { start: from, end: to }, ctx);
    for (const inv of ((invoices.data?.invoices as Record<string, unknown>)?.nodes as Array<Record<string, unknown>>) ?? []) {
      const paidAt = toIso(inv.paidAt);
      if (!paidAt) continue;
      const clientId = (inv.client as Record<string, unknown>)?.id;
      events.push({
        externalRef: `jobber-invoice:${inv.id}`,
        stage: ctx?.stageMap?.get('invoice.paid') ?? 'purchase',
        occurredAt: paidAt,
        amount: parseMoney(inv.total),
        clientId: clientId ? String(clientId) : null,
      });
      stats.purchases++;
    }

    await writeStageEvents(db, sourceKey, events);
    return stats;
  },
};
