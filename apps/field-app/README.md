# All Star Field

The door to door app All Star's reps install from the App Store and Play
Store. Same screens as the field app at `all-star.bi.letlois.com/field`,
because they are literally the same code: everything a rep sees lives in
`packages/field-ui` and both shells mount it. What is in this directory is
only the parts a phone needs that a browser tab does not.

```
  packages/field-ui          the screens, the outbox, the API client
        |                              |
        |  mounted by                  |  mounted by
        v                              v
  apps/web /field route          apps/field-app  ->  ios/ + android/
  cookie session                 bearer token
  browser geolocation            OS geolocation
  same origin                    https://all-star.bi.letlois.com
```

## Why it needs a login and an API host baked in

The API works out which client a request belongs to from the **hostname**,
never from anything the phone sends. That is what stops a rep's session
being pointed at another client's data, and it did not change for this app.

So this build does not tell the server who All Star are. It just talks to
All Star's own hostname, and the server resolves the client exactly as it
does for a browser at `/field`. `src/config.ts` holds that hostname, and
pointing it elsewhere points the app at a different client. It is not a
setting a rep can reach.

The one thing a phone genuinely cannot do is carry the `lbi_field` cookie: a
WebView origin cannot be sent a cookie for another origin, and iOS blocks it
outright. So sign in hands this build a session token instead, which it
holds in native storage and sends in an `Authorization` header. The web app
is untouched and still uses the cookie. See `workers/api/src/cors.ts` and
`readBearerToken` in `workers/api/src/session.ts`.

## Working on it

```bash
pnpm install                                      # from the repo root

pnpm --filter @letlois/all-star-field-app dev     # in a browser, against the live API
pnpm --filter @letlois/all-star-field-app build   # typecheck and build to dist/
pnpm --filter @letlois/all-star-field-app sync    # build, then copy into ios/ and android/
```

`dev` runs at `http://localhost:5173`, which the API allows as a field app
origin, so a real sign in works from a desktop browser. Native geolocation
and native storage fall back to the browser's there, which is the point:
most of the app can be worked on without a device.

To run it on a real phone:

```bash
pnpm --filter @letlois/all-star-field-app run:android   # needs Android Studio
pnpm --filter @letlois/all-star-field-app run:ios       # needs a Mac with Xcode
```

`sync` has to run after **every** web change. The native projects hold a
copy of `dist/`, so an unsynced change is a change the phone does not have.

## Changing the artwork

`resources/mark.svg` is the only source. Replace it and run:

```bash
pnpm --filter @letlois/all-star-field-app icons
pnpm --filter @letlois/all-star-field-app sync
```

That regenerates every launcher icon, adaptive icon and splash screen in
both projects. The current mark is a real icon, not a stub, but it is not
artwork All Star chose, so it is the first thing to replace if they have
their own.

## Releasing

See `docs/field-app-release.md` for the full runbook, including what still
needs a human: developer accounts, signing keys, screenshots and the two
privacy declarations.

Version numbers live in three files and are set from one:

```bash
# edit "version" in package.json, then
pnpm --filter @letlois/all-star-field-app version:set
```

## What is deliberately not here

- **No background location.** Nothing follows a rep between knocks. Location
  is read when they tap for it and attached to that knock.
- **No push notifications.** Nothing needs to reach a rep who does not have
  the app open, and adding them means a whole new permission to justify.
- **No offline map.** The nearby door lookup needs signal and says so; the
  knock form never does.
- **No API response caching.** A stale do not knock list is worse than no
  list. Same rule the web app's service worker follows.
