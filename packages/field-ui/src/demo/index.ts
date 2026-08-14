// The field app with its network replaced.
//
// This is what lets the app be looked at without a rep's password: the
// screens, the stylesheet and the offline queue are the real ones, and only
// the calls to /api/field are answered from fixtures instead of a client's
// database. Two shells use it, and they must show the same thing, which is
// why it lives here rather than in either of them:
//
//   apps/web /field-preview        the deployed test site
//   apps/field-app preview         the shareable single page build
//
// It is never part of a build that reaches a store. Nothing under
// apps/field-app/src imports it, and a test in that app fails if anything
// ever does.

import { configureFieldPlatform } from '../platform';
import type { FieldPlatform } from '../platform';
import { BOOTSTRAP, NEARBY, STATS, VISITS } from './fixtures';

export * from './fixtures';

export interface DemoControls {
  // Whether the app currently believes it has signal. Driving this from
  // outside is the point of the demo: offline is a first class state in this
  // app rather than an error, so a preview that could not show it would be
  // hiding the most interesting thing about it.
  setOffline(offline: boolean): void;
  isOffline(): boolean;

  // Back to a clean day, without a page load.
  //
  // Reloading would be the obvious way to do this and it does not work: a
  // Next static export page mounts once per browsing context, and a second
  // load of the same route in the same frame leaves an empty document. So
  // the host hands us a way to remount the app in place instead, and the
  // frame it lives in is never navigated twice.
  restart(): void;
  onRestart?: () => void;
}

declare global {
  interface Window {
    __fieldDemo?: DemoControls;
  }
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });

// Enough latency to see the app's own loading and syncing states, which are
// part of what it looks like. Instant answers would make the sync pill a
// thing that never appears.
const slowly = <T>(value: T, ms = 320): Promise<T> =>
  new Promise((resolve) => window.setTimeout(() => resolve(value), ms));

export function startFieldDemo(overrides: Partial<FieldPlatform> = {}): DemoControls {
  const state = { offline: false, signedIn: true };

  // The app reads navigator.onLine to decide what the sync pill says, and the
  // browser showing this is genuinely online. Without this, going offline
  // would show "Sending 1" where a rep in a dead zone sees "1 saved on
  // phone", which is the more reassuring of the two and the reason the pill
  // is worded that way.
  Object.defineProperty(window.navigator, 'onLine', {
    configurable: true,
    get: () => !state.offline,
  });

  const realFetch = window.fetch.bind(window);

  window.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const path = url.replace(/^https?:\/\/[^/]+/, '');
    if (!path.startsWith('/api/field')) return realFetch(input as RequestInfo, init);

    // What a dead zone actually does: the request never gets an answer. The
    // app's own code turns that into a queued knock, exactly as it would on
    // a phone in a basement.
    if (state.offline) {
      await slowly(null, 200);
      throw new TypeError('Failed to fetch');
    }

    const method = (init?.method ?? 'GET').toUpperCase();

    if (path.startsWith('/api/field/login')) {
      state.signedIn = true;
      return slowly(json({ ok: true, csrf: 'demo', token: 'demo-token' }), 600);
    }
    if (path.startsWith('/api/field/logout')) {
      state.signedIn = false;
      return slowly(json({ ok: true }));
    }
    if (path.startsWith('/api/field/me')) {
      return state.signedIn ? slowly(json(BOOTSTRAP)) : slowly(json({ error: 'unauthorized' }, 401), 200);
    }
    if (path.startsWith('/api/field/addresses/nearby')) return slowly(json({ addresses: NEARBY }), 700);
    if (path.startsWith('/api/field/stats')) return slowly(json(STATS));
    if (path.startsWith('/api/field/visits')) {
      // A logged knock is accepted and then appears in Today, the same round
      // trip the real app makes.
      if (method === 'POST') return slowly(json({ id: `v${Date.now()}`, duplicate: false }, 201), 900);
      if (method === 'PATCH') return slowly(json({ ok: true }));
      return slowly(json({ visits: VISITS }));
    }
    return json({ error: 'not found' }, 404);
  };

  configureFieldPlatform({
    apiBase: '',
    auth: 'token',
    loadToken: async () => (state.signedIn ? 'demo-token' : null),
    saveToken: async () => undefined,
    // A fixed spot on East Broadway, so "Use my location" shows the nearby
    // doors rather than asking a laptop for a fix it cannot give.
    getFix: async () => {
      await slowly(null, 900);
      return { lat: 33.4062, lng: -111.8067, accuracyM: 12, at: Date.now() };
    },
    backupOutbox: () => undefined,
    restoreOutbox: async () => null,
    ...overrides,
  });

  const controls: DemoControls = {
    setOffline(offline) {
      state.offline = offline;
      // The app listens for the browser's own connectivity events, which is
      // what makes the queue start draining the moment signal returns rather
      // than waiting for its next timer.
      window.dispatchEvent(new Event(offline ? 'offline' : 'online'));
    },
    isOffline: () => state.offline,
    restart() {
      controls.setOffline(false);
      state.signedIn = true;
      try {
        // The queue lives here, so this is what makes a restart a clean day
        // rather than the same one continued.
        window.localStorage.clear();
      } catch {
        // Storage unavailable. Remounting still resets everything the app
        // was holding in memory.
      }
      controls.onRestart?.();
    },
  };

  // Reachable from a parent frame, which is how the test site's controls
  // drive the app running inside it.
  window.__fieldDemo = controls;
  return controls;
}
