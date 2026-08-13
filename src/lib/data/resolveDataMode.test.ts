import type { Client } from '@/types';
import { resolveDataMode } from '@/lib/data/resolveDataMode';

function client(over: Partial<Client> = {}): Client {
  return {
    id: 'cl_1', code: 'C1', name: 'Test', industry: 'Test', status: 'active',
    plan: 'Pro', dataMode: 'demo', enabledModules: ['advertising'], integrations: [],
    createdAt: '2026-01-01T00:00:00.000Z', lastActive: '2026-01-01T00:00:00.000Z',
    contactEmail: 'a@example.invalid', contactName: 'A',
    timezone: 'America/Los_Angeles',
    ...over,
  };
}

describe('resolveDataMode', () => {
  it('falls back to demo when there is no client', () => {
    expect(resolveDataMode(undefined, 'advertising')).toBe('demo');
  });

  it('uses the client mode when the module has no integration', () => {
    expect(resolveDataMode(client({ dataMode: 'live' }), 'crm')).toBe('live');
  });

  it('lets an integration override the client', () => {
    // A client can run advertising live while everything else stays on demo.
    const c = client({
      dataMode: 'demo',
      integrations: [
        { id: 'i1', name: 'Meta', provider: 'meta', connected: true, dataMode: 'live' },
      ],
    });
    expect(resolveDataMode(c, 'advertising')).toBe('live');
    expect(resolveDataMode(c, 'crm')).toBe('demo');
  });

  it('does not let one module’s integration decide another module', () => {
    const c = client({
      dataMode: 'demo',
      integrations: [
        { id: 'i1', name: 'Shopify', provider: 'shopify', connected: true, dataMode: 'live' },
      ],
    });
    expect(resolveDataMode(c, 'ecommerce')).toBe('live');
    expect(resolveDataMode(c, 'advertising')).toBe('demo');
  });
});
