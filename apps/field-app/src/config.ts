// Everything that makes this build All Star's app rather than some other
// client's, in one place.
//
// This is a client branded build: All Star's name, All Star's icon, All
// Star's listing on each store. A rep who installs it just signs in, because
// the build already knows which client it belongs to.
//
// How it knows is the part worth understanding. The API takes the client
// from the hostname of the request and never from anything the phone sends,
// which is the rule the whole platform is built on and the reason a rep's
// session cannot be pointed at another client's data. So this app does not
// send a client id at all. It just talks to All Star's own hostname, and the
// server works out the rest exactly as it does for a browser at /field.
//
// To produce the same app for a different client, change API_BASE to that
// client's dashboard hostname and the names and ids below. Nothing else in
// the app is client specific.

export const APP_CONFIG = {
  // The client's own dashboard hostname. This is what identifies the client
  // to the API, so it is not a preference: pointing it somewhere else points
  // the app at a different client.
  //
  // Overridable at build time only (VITE_API_BASE), for running the app
  // against a staging host. Never at runtime, and never by the rep.
  apiBase: (import.meta.env.VITE_API_BASE as string | undefined) ?? 'https://all-star.bi.letlois.com',

  // What the client calls itself, used before the rep has signed in and the
  // server tells us the real name.
  clientName: 'All Star',

  // The store listing name and the label under the icon. Kept short: iOS
  // truncates past about twelve characters on a home screen.
  appName: 'All Star Field',

  // Reverse domain id. Registered once per store and permanent after the
  // first release: changing it publishes a different app, and every rep has
  // to install that one by hand.
  appId: 'com.letlois.allstarfield',

  // Shown on the Me screen, so a rep reporting a problem can say which build
  // they are on. Injected by Vite from package.json at build time.
  version: __APP_VERSION__,
} as const;
