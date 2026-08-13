// Service worker for the field app.
//
// Its only job is to make sure a rep who opens the app with no signal gets
// the app, not the browser's offline page. Their queued knocks already live
// in localStorage, so once the shell loads they can keep working and the
// queue drains later.
//
// It deliberately does NOT cache API responses. Field data is other
// people's live work, and a stale roster or a stale "do not knock" list is
// worse than no list at all. Requests to /api pass straight through and
// fail honestly when there is no connection, which the app already handles.

const CACHE = 'stopply-field-v1';
const SHELL = ['/field', '/field/index.html'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      // Individually, so one missing path cannot fail the whole install and
      // leave the app with no worker at all.
      .then((cache) => Promise.allSettled(SHELL.map((path) => cache.add(path))))
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
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  // Live data only. See the note above.
  if (url.pathname.startsWith('/api/')) return;

  // Navigations: network first so a rep with signal always gets the current
  // build, falling back to the cached shell when they do not.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          caches.open(CACHE).then((cache) => cache.put('/field', copy));
          return response;
        })
        .catch(() => caches.match('/field').then((hit) => hit ?? caches.match('/field/index.html')))
    );
    return;
  }

  // Static assets: cache first, since a build's assets are immutable and
  // this is what makes a cold offline open fast.
  event.respondWith(
    caches.match(request).then((hit) => {
      if (hit) return hit;
      return fetch(request).then((response) => {
        if (response.ok && response.type === 'basic') {
          const copy = response.clone();
          caches.open(CACHE).then((cache) => cache.put(request, copy));
        }
        return response;
      });
    })
  );
});
