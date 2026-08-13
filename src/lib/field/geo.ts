// Where the rep is standing.
//
// Location is always optional. A phone that cannot get a fix, or a rep who
// declined the permission, must still be able to work: the address is the
// record that matters and coordinates only decide what order the list is in.
// Every function here has a defined answer when there is no fix.

export interface Fix {
  lat: number;
  lng: number;
  /** Metres. A fix accurate to half a block is not worth sorting by. */
  accuracyM: number;
}

export type GeoState =
  | { status: 'idle' }
  | { status: 'locating' }
  | { status: 'ready'; fix: Fix }
  | { status: 'denied' }
  | { status: 'unavailable' };

/**
 * A single fix.
 *
 * enableHighAccuracy because the difference between GPS and cell-tower
 * triangulation is the difference between "this house" and "this
 * neighbourhood", and the whole point is ordering doors within a street.
 */
export function getFix(timeoutMs = 10000): Promise<Fix> {
  return new Promise((resolve, reject) => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      reject(new Error('unavailable'));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (position) =>
        resolve({
          lat: position.coords.latitude,
          lng: position.coords.longitude,
          accuracyM: position.coords.accuracy,
        }),
      (error) => reject(new Error(error.code === error.PERMISSION_DENIED ? 'denied' : 'unavailable')),
      { enableHighAccuracy: true, timeout: timeoutMs, maximumAge: 30000 }
    );
  });
}

const EARTH_RADIUS_M = 6371000;

/** Great-circle distance in metres. */
export function distanceM(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.sin(dLng / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2);
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(h));
}

/**
 * Distance as a rep would say it.
 *
 * Feet up close, because "0.02 miles" is not a thing anyone says while
 * standing on a driveway, and miles once it stops being walkable.
 */
export function formatDistance(metres: number): string {
  const feet = metres * 3.28084;
  if (feet < 1000) return `${Math.round(feet / 10) * 10} ft`;
  const miles = metres / 1609.34;
  return `${miles.toFixed(miles < 10 ? 1 : 0)} mi`;
}
