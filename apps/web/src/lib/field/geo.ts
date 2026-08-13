// Geolocation for the field app.
//
// Location is always optional. A rep whose phone cannot get a fix, or who
// declined the permission, must still be able to log a knock: the address
// they typed is the record that matters, and coordinates are an extra that
// helps the nearby lookup and lets a manager see where the day happened.

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

export function getFix(timeoutMs = 8000): Promise<Fix> {
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
      { enableHighAccuracy: true, timeout: timeoutMs, maximumAge: FIX_MAX_AGE_MS }
    );
  });
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
