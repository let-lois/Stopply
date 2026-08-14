// What the field app needs from whichever shell is hosting it.
//
// The same screens now run in two places: at /field on the client's own
// dashboard hostname, and inside the standalone app a rep installs from the
// App Store or Play Store. Almost everything about the job is identical, so
// almost all of the code is. Four things are not, and they are all here:
//
//   where the API lives   same origin on the web, an absolute host in the app
//   how the session rides a cookie on the web, a bearer token in the app
//   where location comes from  the browser API, or the native one
//   whether the queue has a backstop  localStorage, or that plus native storage
//
// Each host fills these in once at startup and nothing else in the app has
// to know which one it is running in. The web defaults are the historical
// behaviour, so a host that configures nothing keeps working exactly as it
// did before this file existed.

import type { Fix } from './geo';

export interface FieldPlatform {
  // Prefix for every API call. Empty means same origin, which is the web
  // app talking to the Worker on its own hostname.
  apiBase: string;

  // 'cookie' is the browser carrying lbi_field on its own. 'token' is the
  // app holding the session itself, because a WebView origin cannot be sent
  // a cookie for the API's origin.
  auth: 'cookie' | 'token';

  // Session storage, only consulted when auth is 'token'. Async because the
  // native side is async, and because a rep should not wait on it at a door.
  loadToken(): Promise<string | null>;
  saveToken(token: string | null): Promise<void>;

  // A location fix. Native platforms override this to use the OS API, which
  // prompts properly and is more accurate than the WebView's.
  getFix(timeoutMs: number): Promise<Fix>;

  // A durable copy of the outbox, outside the WebView's own storage. The
  // queue is a rep's unsent day; on a phone it is worth keeping a second
  // copy somewhere a cache clear cannot reach. No-ops on the web, where
  // localStorage is the only storage there is.
  backupOutbox(serialized: string): void;
  restoreOutbox(): Promise<string | null>;

  // Shown on the Me screen so a rep reading a bug back to their manager can
  // say which build they are on.
  version: string | null;
}

// The web shell's behaviour, and the fallback for anything a host leaves
// unspecified.
const webDefaults: FieldPlatform = {
  apiBase: '',
  auth: 'cookie',
  loadToken: async () => null,
  saveToken: async () => undefined,
  getFix: (timeoutMs) => browserFix(timeoutMs),
  backupOutbox: () => undefined,
  restoreOutbox: async () => null,
  version: null,
};

let current: FieldPlatform = webDefaults;

export function configureFieldPlatform(platform: Partial<FieldPlatform>): void {
  current = { ...webDefaults, ...platform };
}

export function fieldPlatform(): FieldPlatform {
  return current;
}

// The browser's own geolocation, used directly on the web and as the
// fallback if a native plugin is unavailable.
export function browserFix(timeoutMs: number): Promise<Fix> {
  return new Promise((resolve, reject) => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      reject(new Error('this device has no location support'));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) =>
        resolve({
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          accuracyM: pos.coords.accuracy,
          at: Date.now(),
        }),
      (err) => reject(new Error(err.code === err.PERMISSION_DENIED ? 'denied' : err.message)),
      { enableHighAccuracy: true, timeout: timeoutMs, maximumAge: 60000 }
    );
  });
}
