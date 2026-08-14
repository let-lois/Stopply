// The installed app's answers to what @letlois/field-ui asks of its host.
//
// Everything here exists because a phone is not a browser tab. The session
// cannot ride a cookie, location should come from the OS rather than the
// WebView, and the queue of unsent knocks deserves storage that survives
// more than the WebView's own cache does.

import { Capacitor } from '@capacitor/core';
import { Geolocation } from '@capacitor/geolocation';
import { Preferences } from '@capacitor/preferences';
import { browserFix, type FieldPlatform, type Fix } from '@letlois/field-ui';
import { APP_CONFIG } from './config';

const TOKEN_KEY = 'field.session.token';
const OUTBOX_BACKUP_KEY = 'field.outbox.backup';

export const nativePlatform: FieldPlatform = {
  apiBase: APP_CONFIG.apiBase,

  // The app holds its own session. A WebView origin cannot be sent a cookie
  // for the API's origin, so the server hands this build a token at sign in
  // and it goes back out in an Authorization header.
  auth: 'token',

  async loadToken() {
    try {
      const { value } = await Preferences.get({ key: TOKEN_KEY });
      return value ?? null;
    } catch {
      // Storage unavailable is the same as signed out: the rep signs in
      // again, which is recoverable, rather than the app failing to start.
      return null;
    }
  },

  async saveToken(token) {
    try {
      if (token === null) await Preferences.remove({ key: TOKEN_KEY });
      else await Preferences.set({ key: TOKEN_KEY, value: token });
    } catch {
      // The in memory token still works for this session. Losing it only
      // costs a sign in next launch.
    }
  },

  // The OS location API rather than the WebView's. It prompts the way a rep
  // expects on a phone, and it is meaningfully more accurate at a specific
  // house, which is what the nearby door lookup depends on.
  async getFix(timeoutMs: number): Promise<Fix> {
    if (!Capacitor.isNativePlatform()) return browserFix(timeoutMs);
    try {
      const position = await Geolocation.getCurrentPosition({
        enableHighAccuracy: true,
        timeout: timeoutMs,
        maximumAge: 60000,
      });
      return {
        lat: position.coords.latitude,
        lng: position.coords.longitude,
        accuracyM: position.coords.accuracy,
        at: Date.now(),
      };
    } catch (err) {
      // Normalised to the word the app already understands, so a rep who
      // declined the permission gets the "you can still type the address"
      // message rather than a platform error string.
      const message = err instanceof Error ? err.message : String(err);
      throw new Error(/denied|permission/i.test(message) ? 'denied' : message);
    }
  },

  // A copy of the queue in native storage, outside the WebView. On Android,
  // clearing an app's cache takes localStorage with it, and what would go
  // with it is a rep's unsent day, which exists in exactly one other place:
  // nowhere.
  //
  // Fire and forget on purpose. This runs on the path where a rep taps to
  // log a knock and walks to the next door; that path never waits on
  // storage, and localStorage has already taken the write by this point.
  backupOutbox(serialized: string) {
    void Preferences.set({ key: OUTBOX_BACKUP_KEY, value: serialized }).catch(() => undefined);
  },

  async restoreOutbox() {
    try {
      const { value } = await Preferences.get({ key: OUTBOX_BACKUP_KEY });
      return value ?? null;
    } catch {
      return null;
    }
  },

  version: APP_CONFIG.version,
};
