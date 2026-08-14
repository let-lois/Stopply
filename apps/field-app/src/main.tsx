// Entry point for the installed app.
//
// Deliberately thin. Everything a rep sees is <FieldApp />, the same
// component the web field app renders, so a fix to the knock form reaches
// both. What lives here is only what a native shell has to do that a browser
// tab does not.

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App as CapacitorApp } from '@capacitor/app';
import { Capacitor } from '@capacitor/core';
import { SplashScreen } from '@capacitor/splash-screen';
import { StatusBar, Style } from '@capacitor/status-bar';
import { FieldApp, configureFieldPlatform } from '@letlois/field-ui';
import '@letlois/field-ui/field.css';
import './app.css';
import { nativePlatform } from './nativePlatform';

// Before anything renders: the API client reads this on its first call, and
// the stored session is restored through it on mount.
configureFieldPlatform(nativePlatform);

function setUpNativeShell(): void {
  if (!Capacitor.isNativePlatform()) return;

  // The header is dark, so the clock and battery above it have to be light
  // or they disappear into it.
  StatusBar.setStyle({ style: Style.Dark }).catch(() => undefined);

  // Held until React has painted, so a rep never sees a white frame between
  // the splash and their knock form.
  SplashScreen.hide().catch(() => undefined);

  // Android's back button. Its default is to close the app, which from the
  // knock screen would mean a rep loses their half typed address to a
  // misplaced thumb. Inside the app it goes back; at the top it minimises,
  // the way the platform expects, rather than exiting.
  CapacitorApp.addListener('backButton', ({ canGoBack }) => {
    if (canGoBack) window.history.back();
    else CapacitorApp.minimizeApp().catch(() => undefined);
  }).catch(() => undefined);
}

const container = document.getElementById('root');
if (container) {
  createRoot(container).render(
    <StrictMode>
      <FieldApp />
    </StrictMode>
  );
  setUpNativeShell();
}
