// The rep app with its network replaced.
//
// This is what lets the app be looked at in the prototypes preview without a
// rep's password and without touching a client's data. The screens, the
// outbox and the session logic are the real ones; only the calls to
// /api/field are answered from here.
//
// Installed by main.tsx, and only when the URL explicitly asks for it. Inert
// otherwise: no import of this module changes behaviour on its own.
//
// Everything below is invented. Nothing real from a client's database belongs
// in something anyone with the link can open, and the numbers are weighted
// the way a day on the doors actually goes: most doors reach nobody, and a
// sale is rare.

/** The query the preview frame appends. Nothing else turns this on. */
export const FIXTURES_PARAM = 'fixtures';

export function fixturesRequested(search: string): boolean {
  return new URLSearchParams(search).get(FIXTURES_PARAM) === '1';
}

const REP_ID = 'rep_preview';

// A worked block on East Broadway. Dispositions spread the way a real street
// looks after a crew has been down it once.
const PROPERTIES = [
  ['p1', '1184 E Broadway Rd', 'no_answer', null, null],
  ['p2', '1190 E Broadway Rd', 'appointment_set', 'Marcus Bell', '480-555-0142'],
  ['p3', '1196 E Broadway Rd', 'not_interested', null, null],
  ['p4', '1202 E Broadway Rd', 'come_back', null, null],
  ['p5', '1208 E Broadway Rd', 'not_visited', null, null],
  ['p6', '1214 E Broadway Rd', 'not_visited', null, null],
  ['p7', '1220 E Broadway Rd', 'interested', 'Priya Raman', '480-555-0118'],
  ['p8', '1226 E Broadway Rd', 'do_not_knock', null, null],
  ['p9', '1232 E Broadway Rd', 'no_answer', null, null],
  ['p10', '1238 E Broadway Rd', 'closed_sale', 'Dana Whitfield', '480-555-0177'],
  ['p11', '1244 E Broadway Rd', 'not_visited', null, null],
  ['p12', '1250 E Broadway Rd', 'not_visited', null, null],
] as const;

// Relative to whenever the preview is opened, so the day always reads as
// today rather than a fixed date that goes stale the morning after a build.
const hoursAgo = (h: number) => new Date(Date.now() - h * 3600_000).toISOString();

function doorsPayload() {
  return {
    session: {
      repId: REP_ID,
      repName: 'Dana Reyes',
      clientId: 'all-star',
      clientName: 'All Star',
      clientLogo: null,
      territoryName: 'East Mesa',
    },
    properties: PROPERTIES.map(([id, address, disposition, ownerName, ownerPhone], i) => ({
      id,
      address,
      city: 'Mesa',
      state: 'AZ',
      postalCode: '85204',
      // Walked down one side of a street, so the doors sit in a line.
      lat: 33.4062 + i * 0.00018,
      lng: -111.8067 + i * 0.00012,
      territoryId: 'terr_east_mesa',
      disposition,
      ownerName,
      ownerPhone,
      notes: null,
    })),
    visits: [
      {
        id: 'v1',
        propertyId: 'p2',
        repId: REP_ID,
        disposition: 'appointment_set',
        notes: 'Roof is 18 years old. Wants his wife there.',
        vehiclePresent: true,
        occurredAt: hoursAgo(1.4),
      },
      {
        id: 'v2',
        propertyId: 'p1',
        repId: REP_ID,
        disposition: 'no_answer',
        notes: null,
        vehiclePresent: false,
        occurredAt: hoursAgo(1.7),
      },
      {
        id: 'v3',
        propertyId: 'p3',
        repId: REP_ID,
        disposition: 'not_interested',
        notes: 'Had it done last spring.',
        vehiclePresent: true,
        occurredAt: hoursAgo(2.1),
      },
    ],
  };
}

interface PreviewControls {
  setOffline(offline: boolean): void;
  isOffline(): boolean;
}

declare global {
  interface Window {
    __fieldPreview?: PreviewControls;
  }
}

/** A request body only if it is JSON we can read; an empty object otherwise. */
function readBody(body: BodyInit | null | undefined): Record<string, unknown> {
  if (typeof body !== 'string') return {};
  try {
    const parsed: unknown = JSON.parse(body);
    return parsed !== null && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function readString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });

// Enough latency to see the app's own loading and pending states, which are
// part of what it looks like. Instant answers hide them entirely.
const slowly = <T>(value: T, ms = 320): Promise<T> =>
  new Promise((resolve) => window.setTimeout(() => resolve(value), ms));

/**
 * Replace the network for /api/field only, and hand the parent frame a way to
 * cut the signal.
 *
 * Offline is a first class state in this app rather than an error, so a
 * preview that could not show it would be hiding the most interesting thing
 * about it.
 */
export function installFieldFixtures(): void {
  // Starts signed in on purpose. The real sign-in form will not submit until
  // Turnstile has issued a token, and there is no Turnstile in a preview, so
  // a preview that began signed out would be a screenshot of a login button
  // nobody can press. Landing on the app is also the point: what is being
  // reviewed is the rep's day, not the door to it.
  const state = { offline: false, signedIn: true };

  // The app reads navigator.onLine to decide what it tells the rep. The
  // browser showing this preview is genuinely online, so without this the
  // offline switch would change nothing they can see.
  Object.defineProperty(window.navigator, 'onLine', {
    configurable: true,
    get: () => !state.offline,
  });

  const realFetch = window.fetch.bind(window);

  window.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const path = url.replace(/^https?:\/\/[^/]+/, '');
    if (!path.startsWith('/api/field')) return realFetch(input, init);

    // What a dead zone actually does: the request never gets an answer. The
    // app's own outbox turns that into a queued knock, exactly as it would in
    // a stairwell.
    if (state.offline) {
      await slowly(null, 200);
      throw new TypeError('Failed to fetch');
    }

    if (path.startsWith('/api/field/login')) {
      state.signedIn = true;
      return slowly(json(doorsPayload()), 600);
    }
    if (path.startsWith('/api/field/logout')) {
      state.signedIn = false;
      return slowly(json({ ok: true }));
    }
    if (path.startsWith('/api/field/doors')) {
      return state.signedIn
        ? slowly(json(doorsPayload()))
        : slowly(json({ error: { code: 'unauthorized', message: 'Sign in required' } }, 401), 200);
    }
    if (path.startsWith('/api/field/visits')) {
      // Echoed back so the knock the rep just logged is the one that appears
      // in their day, rather than a fixed row that ignores what they chose.
      const body = readBody(init?.body);
      return slowly(
        json({
          visit: {
            id: `v_${Date.now()}`,
            propertyId: readString(body.propertyId) ?? 'p1',
            repId: REP_ID,
            disposition: readString(body.disposition) ?? 'no_answer',
            notes: readString(body.notes),
            vehiclePresent: typeof body.vehiclePresent === 'boolean' ? body.vehiclePresent : null,
            occurredAt: new Date().toISOString(),
          },
          duplicate: false,
        }),
        700
      );
    }
    return json({ error: { code: 'not_found', message: 'Not found' } }, 404);
  };

  window.__fieldPreview = {
    setOffline(offline) {
      state.offline = offline;
      // The app listens for the browser's own connectivity events, which is
      // what makes a queue start draining the moment signal returns rather
      // than waiting for whatever timer it runs.
      window.dispatchEvent(new Event(offline ? 'offline' : 'online'));
    },
    isOffline: () => state.offline,
  };
}
