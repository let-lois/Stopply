// Geolocation for the field app.
//
// Location is always optional. A rep whose phone cannot get a fix, or who
// declined the permission, must still be able to log a knock: the address
// they typed is the record that matters, and coordinates are an extra that
// helps the nearby lookup and lets a manager see where the day happened.

import { fieldPlatform } from './platform';

export interface Fix {
  lat: number;
  lng: number;
  accuracyM: number;
  at: number;
}

export type GeoState =
  | { status: 'idle' }
  | { status: 'locating' }
  | { status: 'ready'; fix: Fix }
  | { status: 'denied' }
  | { status: 'unavailable'; reason: string };

// A fix older than this is stale for a rep who has walked half a street
// since, so the app asks for a fresh one rather than reusing it.
export const FIX_MAX_AGE_MS = 60000;

// Delegated to the platform: the browser's API on the web, the OS one in
// the installed app, which prompts the way a rep expects and is meaningfully
// more accurate at a specific house.
export function getFix(timeoutMs = 8000): Promise<Fix> {
  return fieldPlatform().getFix(timeoutMs);
}

export function isStale(fix: Fix | null): boolean {
  return !fix || Date.now() - fix.at > FIX_MAX_AGE_MS;
}

// Metres, rounded the way a person would say it.
export function describeAccuracy(accuracyM: number): string {
  if (accuracyM <= 20) return 'good signal';
  if (accuracyM <= 75) return `within ${Math.round(accuracyM)}m`;
  return `rough, within ${Math.round(accuracyM)}m`;
}
