'use client';

// The field app, running against fixtures instead of a client's database.
//
// This is the page the test site at /field-preview loads into its device
// frame, and it is deliberately a route of its own rather than something the
// harness draws: the field stylesheet sizes itself in viewport units and
// pins its tab bar to the bottom of the screen, so it only lays out
// correctly when it owns the whole viewport. Given a frame of its own it
// behaves exactly as it does on a phone.
//
// Open it directly to use it full window, or to point a real phone at it.
//
// It reaches no API and holds no client data. The live app with real data is
// /field on the client's own hostname, which is a different route and a real
// sign in.

import { useEffect, useState } from 'react';
import { FieldApp } from '@letlois/field-ui';
import { startFieldDemo } from '@letlois/field-ui/demo';
import '@letlois/field-ui/field.css';

export default function FieldDemoPage() {
  // Nothing renders until the demo is in place: it replaces window.fetch,
  // and the app asks who the rep is on its first paint. Mounting first would
  // let that call reach the real network.
  const [ready, setReady] = useState(false);
  // Bumped to remount the app for a restart. The frame this page lives in is
  // never navigated a second time, see the note on DemoControls.restart.
  const [generation, setGeneration] = useState(0);

  useEffect(() => {
    const demo = startFieldDemo({
      version: `${process.env.NEXT_PUBLIC_BUILD_SHA ?? 'dev'} demo`,
    });
    demo.onRestart = () => setGeneration((n) => n + 1);
    setReady(true);
  }, []);

  if (!ready) return null;
  return <FieldApp key={generation} />;
}
