'use client';

// The door to door field app, served at /field on a client's own dashboard
// hostname (for example all-star.bi.letlois.com/field).
//
// Kept off the dashboard entry point entirely: a rep opening this never
// loads the reporting shell, and a client opening the dashboard never loads
// this. They share a hostname and nothing else, including the session
// cookie.
//
// The screens themselves live in @letlois/field-ui, shared with the
// standalone app on the App Store and Play Store. This file is only the web
// shell: same origin, cookie session, the browser's own geolocation, which
// is exactly the platform default.

import { useEffect } from 'react';
import { FieldApp } from '@letlois/field-ui';
import '@letlois/field-ui/field.css';

export default function FieldPage() {
  // Registered here rather than in the shared layout so the dashboard never
  // installs it. The worker caches the app shell so a rep who opens the app
  // with no signal still gets a working screen and their queued knocks,
  // instead of the browser's offline page.
  useEffect(() => {
    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
    navigator.serviceWorker.register('/field-sw.js', { scope: '/field' }).catch(() => {
      // Registration fails on an insecure origin or when the browser has
      // service workers switched off. The app still works online, so this
      // is not worth telling the rep about.
    });
  }, []);

  return <FieldApp />;
}
