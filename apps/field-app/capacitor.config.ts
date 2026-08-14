import type { CapacitorConfig } from '@capacitor/cli';

// The native shell's configuration. The app's identity (id, name, the host
// it talks to) is stated once in src/config.ts; this file has to repeat the
// id and name because the native build reads it before any JavaScript runs.
// Change them together.

const config: CapacitorConfig = {
  appId: 'com.letlois.allstarfield',
  appName: 'All Star Field',
  webDir: 'dist',

  server: {
    // https rather than the http default, so Android and iOS present the
    // same origin shape and so the WebView counts as a secure context.
    // Geolocation is refused outside one.
    androidScheme: 'https',
  },

  plugins: {
    SplashScreen: {
      // Hidden from JavaScript once React has painted, rather than on a
      // timer, so a rep never sees a white frame in between. The timeout is
      // only a backstop for a build that fails to boot at all.
      launchAutoHide: false,
      launchShowDuration: 3000,
      backgroundColor: '#263449',
      androidScaleType: 'CENTER_CROP',
      showSpinner: false,
    },
  },

  ios: {
    // The app draws its own header under the status bar and the field CSS
    // already pads for the notch and the home indicator.
    contentInset: 'never',
    // A form that bounces when a rep scrolls past the end of it reads as
    // broken on a work phone.
    scrollEnabled: true,
  },

  android: {
    // Cleartext stays off: the API is https and nothing else is contacted.
    allowMixedContent: false,
  },
};

export default config;
