// A preview build of the field app, for looking at rather than working in.
//
// This mounts the real <FieldApp /> with the real stylesheet and the real
// outbox. What it replaces is the network: every /api/field call is answered
// from preview/data.ts instead of a client's database. That is the whole
// difference, which is what makes it worth showing. The screens here are the
// screens a rep gets.
//
// It is deliberately not part of the shipped app. `vite build` builds
// index.html; this has its own config and its own output directory, and
// nothing in src/ imports it.

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { FieldApp, configureFieldPlatform } from '@letlois/field-ui';
import '@letlois/field-ui/field.css';
import '../src/app.css';
import { BOOTSTRAP, NEARBY, STATS, VISITS } from './data';

// Flipped from the page's controls. Offline is a first class state in this
// app rather than an error, so a preview that could not show it would be
// hiding the most interesting thing about it.
declare global {
  interface Window {
    __fieldPreview: { offline: boolean; signedIn: boolean; reset: () => void };
  }
}

const state = {
  offline: false,
  signedIn: true,
  reset: () => {
    window.localStorage.clear();
    window.location.reload();
  },
};
window.__fieldPreview = state;

// The app reads navigator.onLine to decide what the sync pill says, and the
// browser running this preview is genuinely online. Without this, flipping
// the page's offline switch would show "Sending 1" where a rep in a dead
// zone sees "1 saved on phone", which is the more reassuring of the two and
// the whole reason the pill is worded that way.
Object.defineProperty(window.navigator, 'onLine', {
  configurable: true,
  get: () => !state.offline,
});

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });

// Enough latency to see the app's own loading and syncing states, which are
// part of what it looks like. Instant responses would make the sync pill a
// thing that never appears.
const slowly = <T,>(value: T, ms = 320): Promise<T> =>
  new Promise((resolve) => window.setTimeout(() => resolve(value), ms));

const realFetch = window.fetch.bind(window);

window.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  const path = url.replace(/^https?:\/\/[^/]+/, '');
  if (!path.startsWith('/api/field')) return realFetch(input as RequestInfo, init);

  // What a dead zone actually does: the request never gets an answer. The
  // app's own code turns this into a queued knock, exactly as it would on a
  // phone in a basement.
  if (state.offline) {
    await slowly(null, 200);
    throw new TypeError('Failed to fetch');
  }

  const method = (init?.method ?? 'GET').toUpperCase();

  if (path.startsWith('/api/field/login')) {
    state.signedIn = true;
    return slowly(json({ ok: true, csrf: 'preview', token: 'preview-token' }), 600);
  }
  if (path.startsWith('/api/field/logout')) {
    state.signedIn = false;
    return slowly(json({ ok: true }));
  }
  if (path.startsWith('/api/field/me')) {
    return state.signedIn
      ? slowly(json(BOOTSTRAP))
      : slowly(json({ error: 'unauthorized' }, 401), 200);
  }
  if (path.startsWith('/api/field/addresses/nearby')) {
    return slowly(json({ addresses: NEARBY }), 700);
  }
  if (path.startsWith('/api/field/stats')) {
    return slowly(json(STATS));
  }
  if (path.startsWith('/api/field/visits')) {
    // A logged knock is accepted and then appears in Today, the same round
    // trip the real app makes.
    if (method === 'POST') return slowly(json({ id: `v${Date.now()}`, duplicate: false }, 201), 900);
    if (method === 'PATCH') return slowly(json({ ok: true }));
    return slowly(json({ visits: VISITS }));
  }
  return json({ error: 'not found' }, 404);
};

// A fixed spot on East Broadway, so tapping "Use my location" shows the
// nearby doors rather than asking a laptop for a GPS fix it does not have.
configureFieldPlatform({
  apiBase: '',
  auth: 'token',
  loadToken: async () => (state.signedIn ? 'preview-token' : null),
  saveToken: async () => undefined,
  getFix: async () => {
    await slowly(null, 900);
    return { lat: 33.4062, lng: -111.8067, accuracyM: 12, at: Date.now() };
  },
  backupOutbox: () => undefined,
  restoreOutbox: async () => null,
  version: `${__APP_VERSION__} preview`,
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <FieldApp />
  </StrictMode>
);
