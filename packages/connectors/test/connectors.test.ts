import { describe, it, expect } from 'vitest';
import { CONNECTORS } from '../src/registry';
import type { ConnectorDb } from '../src/types';

function fakeFetch(routes: Array<{ match: RegExp; status: number; body: unknown }>): typeof fetch {
  return (async (input: RequestInfo | URL) => {
    const url = String(input);
    for (const route of routes) {
      if (route.match.test(url)) {
        return new Response(JSON.stringify(route.body), {
          status: route.status,
          headers: { 'content-type': 'application/json' },
        });
      }
    }
    return new Response('{}', { status: 404 });
  }) as typeof fetch;
}

class RecordingDb implements ConnectorDb {
  statements: Array<{ sql: string; params?: unknown[] }> = [];
  async query<T>(): Promise<T[]> {
    return [];
  }
  async batch(statements: Array<{ sql: string; params?: unknown[] }>): Promise<void> {
    this.statements.push(...statements);
  }
}

describe('connector requirements', () => {
  it('every connector states plan requirements, a token guide, and default stage mappings', () => {
    for (const connector of Object.values(CONNECTORS)) {
      const req = connector.getRequirements();
      expect(req.planRequirement.length).toBeGreaterThan(10);
      expect(req.planLink).toMatch(/^https:/);
      expect(req.tokenGuide.length).toBeGreaterThanOrEqual(3);
      expect(req.defaultStageMap.length).toBeGreaterThan(0);
    }
  });
});

describe('testConnection distinguishes failures', () => {
  it('boulevard: 401 is bad credentials, 403 is insufficient plan', async () => {
    const bad = await CONNECTORS.boulevard!.testConnection(
      { apiKey: 'k', businessId: 'b' },
      { fetchImpl: fakeFetch([{ match: /business/, status: 401, body: {} }]) }
    );
    expect(bad).toMatchObject({ ok: false, failure: 'bad_credentials' });

    const plan = await CONNECTORS.boulevard!.testConnection(
      { apiKey: 'k', businessId: 'b' },
      { fetchImpl: fakeFetch([{ match: /business/, status: 403, body: { reason: 'api_disabled' } }]) }
    );
    expect(plan).toMatchObject({ ok: false, failure: 'insufficient_plan' });

    const ok = await CONNECTORS.boulevard!.testConnection(
      { apiKey: 'k', businessId: 'b' },
      { fetchImpl: fakeFetch([{ match: /business/, status: 200, body: { name: 'Be Clinical' } }]) }
    );
    expect(ok).toMatchObject({ ok: true, connectedAs: 'Be Clinical' });
  });

  it('housecallpro: surfaces the MAX plan requirement on 403', async () => {
    const plan = await CONNECTORS.housecallpro!.testConnection(
      { apiKey: 'k' },
      { fetchImpl: fakeFetch([{ match: /company/, status: 403, body: {} }]) }
    );
    expect(plan.failure).toBe('insufficient_plan');
    expect(plan.message).toContain('MAX');
  });

  it('jobber: a rejected refresh token is bad credentials', async () => {
    const bad = await CONNECTORS.jobber!.testConnection(
      { clientId: 'c', clientSecret: 's', refreshToken: 'r' },
      { fetchImpl: fakeFetch([{ match: /oauth\/token/, status: 401, body: {} }]) }
    );
    expect(bad).toMatchObject({ ok: false, failure: 'bad_credentials' });
  });

  it('jobber: missing tokens prompt the OAuth flow', async () => {
    const result = await CONNECTORS.jobber!.testConnection({}, {});
    expect(result.failure).toBe('bad_credentials');
    expect(result.message).toContain('Connect');
  });
});

describe('syncMonth writes stage events', () => {
  it('boulevard maps appointments and line items to canonical stages', async () => {
    const db = new RecordingDb();
    const stats = await CONNECTORS.boulevard!.syncMonth(
      { apiKey: 'k', businessId: 'b' },
      '2026-05',
      db,
      'boulevard',
      {
        fetchImpl: fakeFetch([
          {
            match: /clients/,
            status: 200,
            body: { clients: [{ id: 'cl1', email: 'j@x.com', mobile_phone: '6025550101', first_name: 'Jane', last_name: 'Doe' }] },
          },
          {
            match: /appointments/,
            status: 200,
            body: {
              appointments: [
                { id: 'a1', client_id: 'cl1', client_name: 'Jane Doe', start_at: '2026-05-05T17:00:00Z', state: 'final' },
                { id: 'a2', client_id: 'cl1', client_name: 'Jane Doe', start_at: '2026-05-09T17:00:00Z', state: 'booked' },
              ],
            },
          },
          {
            match: /line_items/,
            status: 200,
            body: { line_items: [{ id: 'li1', client_name: 'Jane Doe', closed_at: '2026-05-05T18:00:00Z', net_sales: '$1,500.00' }] },
          },
        ]),
      }
    );
    expect(stats).toMatchObject({ scheduled: 2, completed: 1, purchases: 1, clientRecords: 1 });
    const stageInserts = db.statements.filter((s) => s.sql.includes('stage_events'));
    expect(stageInserts).toHaveLength(4);
    const purchase = stageInserts.find((s) => (s.params as unknown[])[2] === 'purchase')!;
    expect((purchase.params as unknown[])[4]).toBe(1500);
    // Line items join by normalized name only.
    expect(String((purchase.params as unknown[])[6])).toContain('"nameNorm":"doe jane"');
    expect(String((purchase.params as unknown[])[6])).toContain('"clientId":null');
  });

  it('housecallpro maps jobs and invoices with a custom stage map', async () => {
    const db = new RecordingDb();
    const stats = await CONNECTORS.housecallpro!.syncMonth(
      { apiKey: 'k' },
      '2026-05',
      db,
      'housecallpro',
      {
        stageMap: new Map([['invoice.paid', 'completed']]),
        fetchImpl: fakeFetch([
          { match: /customers/, status: 200, body: { customers: [] } },
          {
            match: /jobs/,
            status: 200,
            body: {
              jobs: [
                {
                  id: 'j1',
                  created_at: '2026-05-02T10:00:00Z',
                  completed_at: '2026-05-04T10:00:00Z',
                  work_status: 'complete',
                  customer: { id: 'cu1' },
                },
              ],
            },
          },
          {
            match: /invoices/,
            status: 200,
            body: { invoices: [{ id: 'i1', paid_at: '2026-05-05T10:00:00Z', amount: '450.00', customer_id: 'cu1' }] },
          },
        ]),
      }
    );
    expect(stats.scheduled).toBe(1);
    expect(stats.completed).toBe(1);
    expect(stats.purchases).toBe(1);
    // The stage map override redirected invoice.paid to completed.
    const invoiceInsert = db.statements.find((s) => String((s.params as unknown[])[1]).includes('hcp-invoice'))!;
    expect((invoiceInsert.params as unknown[])[2]).toBe('completed');
  });

  it('hcp webhooks write the same canonical events', async () => {
    const db = new RecordingDb();
    await CONNECTORS.housecallpro!.handleWebhook!(
      { event: 'invoice.paid', invoice: { id: 'i9', paid_at: '2026-05-07T10:00:00Z', amount: 99.5, customer_id: 'cu2' } },
      db,
      'housecallpro'
    );
    expect(db.statements).toHaveLength(1);
    expect((db.statements[0]!.params as unknown[])[2]).toBe('purchase');
    expect((db.statements[0]!.params as unknown[])[4]).toBe(99.5);
  });
});
