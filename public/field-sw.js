// The rep app's service worker.
//
// One job: make the app open with no signal. A rep who closes it in a dead
// zone and reopens it must get their door list, not the browser's dinosaur.
//
// The rule that matters more than the caching: this never caches /api. Not
// once, not stale-while-revalidate, not "just the door list". A stale
// do-not-knock list means a rep knocks a household that asked not to be, which
// is the one mistake this whole system exists to prevent. Door data comes from
// the outbox and from the network, never from here.
//
// Registered with scope /field, so nothing about the dashboard passes through
// it. A service worker controls the pages in its scope and every request those
// pages make, which is why assets outside /field are still handled here while
// the dashboard's identical requests are not.

const CACHE = 'stopply-field-v1';

const SHELL = ['/field', '/index.html', '/icon-192.png'];

/**
 * The assets the page needs to boot at all.
 *
 * Hashed filenames are not known when this file is written, so they are read
 * out of the HTML at install time instead of listed here or hard-coded by a
 * build step. Without this the first visit caches the shell and none of the
 * scripts: those were requested before the worker took control, so it never
 * saw them, and a reload offline served a document referencing files that were
 * not there. The app appeared to have offline support and did not.
 *
 * Everything else, including the lazily loaded route chunks, is cached as it
 * is first fetched by the handler below.
 */
async function precacheEntryAssets(cache) {
  try {
    const response = await fetch('/index.html', { cache: 'reload' });
    const html = await response.text();
    const assets = [...html.matchAll(/(?:src|href)="(\/assets\/[^"]+)"/g)].map((m) => m[1]);
    await cache.addAll([...new Set(assets)]);
  } catch (error) {
    // A failed precache is not a failed install. The worker is still worth
    // having: it will cache what it sees from here on.
    console.warn('[field-sw] could not precache entry assets', error);
  }
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then(async (cache) => {
        await cache.addAll(SHELL);
        await precacheEntryAssets(cache);
      })
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  const url = new URL(request.url);

  // Anything that changes state, and anything at all under /api, goes to the
  // network untouched. A POST that a service worker "helpfully" served from a
  // cache would be a knock that never happened.
  if (request.method !== 'GET' || url.pathname.startsWith('/api/')) return;
  if (url.origin !== self.location.origin) return;

  // A navigation: try the network so a deployed update is picked up, and fall
  // back to the cached shell when there is nothing to reach. React Router
  // resolves the actual route once the shell is running.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          void caches.open(CACHE).then((cache) => cache.put('/field', copy));
          return response;
        })
        .catch(() => caches.match('/field').then((hit) => hit ?? caches.match('/index.html')))
    );
    return;
  }

  // Build assets carry a content hash in the filename, so a cached copy can
  // never be the wrong version of itself. Cache first, and populate on the way
  // past.
  event.respondWith(
    caches.match(request).then((hit) => {
      if (hit) return hit;
      return fetch(request).then((response) => {
        if (response.ok && response.type === 'basic') {
          const copy = response.clone();
          void caches.open(CACHE).then((cache) => cache.put(request, copy));
        }
        return response;
      });
    })
  );
});
