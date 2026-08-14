// What the two shells are allowed to differ on, and what they are not.
//
// The field app now runs in a browser tab and inside an installed app, from
// one copy of the code. These tests pin the seams between them: how a
// request is authenticated, and how a rep's unsent day is kept safe on a
// phone whose storage can be cleared out from under it.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { configureFieldPlatform, fieldPlatform, type FieldPlatform } from '../src/platform';
import { fieldApi } from '../src/api';
import { enqueue, getOutbox, restoreOutboxBackup } from '../src/outbox';
import type { QueuedVisit } from '../src/types';

const OUTBOX_KEY = 'stopply.field.outbox.v1';

function visit(clientUuid: string): QueuedVisit {
  return {
    clientUuid,
    street: '123 N Main St',
    unit: null,
    city: 'Mesa',
    state: 'AZ',
    postalCode: '85201',
    disposition: 'no_answer',
    notes: null,
    contactName: null,
    contactPhone: null,
    contactEmail: null,
    occurredAt: '2026-08-14T17:00:00.000Z',
    lat: null,
    lng: null,
    accuracyM: null,
    followUpAt: null,
  };
}

// Stands in for native storage: outside the WebView, and therefore outside
// whatever localStorage does.
function fakeNativeStorage() {
  const held = { outbox: null as string | null, token: null as string | null };
  const platform: Partial<FieldPlatform> = {
    apiBase: 'https://all-star.bi.letlois.com',
    auth: 'token',
    loadToken: async () => held.token,
    saveToken: async (token) => {
      held.token = token;
    },
    backupOutbox: (serialized) => {
      held.outbox = serialized;
    },
    restoreOutbox: async () => held.outbox,
  };
  return { held, platform };
}

beforeEach(() => {
  window.localStorage.clear();
  configureFieldPlatform({});
  vi.restoreAllMocks();
});

afterEach(() => {
  configureFieldPlatform({});
});

describe('the platform a shell declares', () => {
  it('defaults to the web app: same origin, cookie session', () => {
    const platform = fieldPlatform();
    expect(platform.apiBase).toBe('');
    expect(platform.auth).toBe('cookie');
  });

  it('takes only what a shell overrides, keeping the rest', () => {
    configureFieldPlatform({ apiBase: 'https://all-star.bi.letlois.com', auth: 'token' });
    expect(fieldPlatform().apiBase).toBe('https://all-star.bi.letlois.com');
    // Not overridden, so still the web behaviour rather than undefined.
    expect(typeof fieldPlatform().getFix).toBe('function');
  });
});

describe('how a request is authenticated', () => {
  function captureFetch() {
    const fetchMock = vi.fn(
      async () => new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } })
    );
    vi.stubGlobal('fetch', fetchMock);
    return fetchMock;
  }

  it('sends the browser cookie and no token on the web', async () => {
    const fetchMock = captureFetch();
    await fieldApi('/api/field/me');
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/api/field/me');
    expect(init.credentials).toBe('same-origin');
    expect((init.headers as Record<string, string>).authorization).toBeUndefined();
  });

  it('sends a bearer token and no ambient credentials in the app', async () => {
    const { platform } = fakeNativeStorage();
    configureFieldPlatform(platform);
    const { setFieldSessionToken } = await import('../src/api');
    setFieldSessionToken('abc123');

    const fetchMock = captureFetch();
    await fieldApi('/api/field/me');
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    // Absolute, because the app is not served from the API's origin.
    expect(url).toBe('https://all-star.bi.letlois.com/api/field/me');
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer abc123');
    // The app carries its own credential, so nothing may ride along on its
    // own. This is what makes CORS without allow-credentials sound.
    expect(init.credentials).toBe('omit');

    setFieldSessionToken(null);
  });
});

describe('the queue backup', () => {
  it('keeps a copy outside the WebView as knocks are logged', () => {
    const { held, platform } = fakeNativeStorage();
    configureFieldPlatform(platform);

    enqueue(visit('uuid-1'));
    enqueue(visit('uuid-2'));

    expect(JSON.parse(held.outbox!)).toHaveLength(2);
  });

  // The case this exists for: Android clears the app's cache, localStorage
  // goes with it, and a rep's unsent day would otherwise be gone.
  it('puts a lost queue back', async () => {
    const { held, platform } = fakeNativeStorage();
    configureFieldPlatform(platform);
    enqueue(visit('uuid-1'));
    enqueue(visit('uuid-2'));

    window.localStorage.clear();
    expect(getOutbox()).toHaveLength(0);

    expect(await restoreOutboxBackup()).toBe(2);
    expect(getOutbox().map((e) => e.visit.clientUuid)).toEqual(['uuid-1', 'uuid-2']);
    expect(held.outbox).not.toBeNull();
  });

  // A knock that reached the server clears from the queue, and the backup
  // follows. Otherwise a restore would resurrect work already recorded, and
  // a rep would watch phantom knocks send themselves every time they opened
  // the app.
  it('forgets a knock once it has been sent', async () => {
    const { held, platform } = fakeNativeStorage();
    configureFieldPlatform(platform);
    enqueue(visit('uuid-1'));

    // What the drain does when the server acknowledges the visit.
    window.localStorage.setItem(OUTBOX_KEY, '[]');
    const { discard } = await import('../src/outbox');
    discard('uuid-1');

    expect(JSON.parse(held.outbox!)).toHaveLength(0);
    window.localStorage.clear();
    expect(await restoreOutboxBackup()).toBe(0);
    expect(getOutbox()).toHaveLength(0);
  });

  // A live queue is the truth. A restore must never overwrite it with an
  // older copy, which would undo knocks logged since the backup was taken.
  it('leaves a queue that is still there alone', async () => {
    const { held, platform } = fakeNativeStorage();
    configureFieldPlatform(platform);
    enqueue(visit('uuid-old'));
    const stale = held.outbox;

    window.localStorage.clear();
    enqueue(visit('uuid-new'));
    held.outbox = stale;

    expect(await restoreOutboxBackup()).toBe(0);
    expect(getOutbox().map((e) => e.visit.clientUuid)).toEqual(['uuid-new']);
    // The backup is refreshed to match, so the next clear restores the
    // current queue rather than the one before it.
    expect(JSON.parse(held.outbox!).map((e: { visit: QueuedVisit }) => e.visit.clientUuid)).toEqual([
      'uuid-new',
    ]);
  });

  it('survives a corrupt or empty backup rather than failing to start', async () => {
    const { held, platform } = fakeNativeStorage();
    configureFieldPlatform(platform);

    held.outbox = 'not json at all';
    expect(await restoreOutboxBackup()).toBe(0);

    held.outbox = '{"not":"an array"}';
    expect(await restoreOutboxBackup()).toBe(0);

    held.outbox = '[{"visit":{}},{"nonsense":true}]';
    expect(await restoreOutboxBackup()).toBe(0);

    expect(getOutbox()).toHaveLength(0);
  });

  it('does nothing on the web, where there is no second copy to keep', async () => {
    enqueue(visit('uuid-1'));
    window.localStorage.clear();
    expect(await restoreOutboxBackup()).toBe(0);
  });
});
