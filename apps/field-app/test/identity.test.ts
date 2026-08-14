// The app's identity is stated in five files, because a native build reads
// it from the platform's own config before any JavaScript runs. There is no
// way around the duplication, so this is the thing that notices when a copy
// drifts.
//
// Drift here is not a cosmetic problem. A bundle id that disagrees with the
// one registered on a store is an upload that is rejected or, worse, a
// second app nobody can migrate to. A version on the Me screen that
// disagrees with the store is a rep reporting a bug against a build that was
// never shipped.

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const root = join(import.meta.dirname, '..');
const read = (path: string) => readFileSync(join(root, path), 'utf8');

const pkg = JSON.parse(read('package.json')) as { version: string };
const config = read('src/config.ts');
const capacitor = read('capacitor.config.ts');
const gradle = read('android/app/build.gradle');
const pbxproj = read('ios/App/App.xcodeproj/project.pbxproj');

function only(pattern: RegExp, source: string, label: string): string {
  const matches = [...source.matchAll(pattern)].map((m) => m[1]!);
  expect(matches.length, `no ${label} found`).toBeGreaterThan(0);
  // Xcode repeats every setting per build configuration. Debug and release
  // disagreeing would mean a TestFlight build that is not the build that
  // ships.
  expect(new Set(matches).size, `${label} disagrees with itself: ${matches.join(', ')}`).toBe(1);
  return matches[0]!;
}

describe('the app id', () => {
  const expected = only(/appId:\s*'([^']+)'/g, config, 'appId in src/config.ts');

  it('is a reverse domain name, which both stores require', () => {
    expect(expected).toMatch(/^[a-z][a-z0-9]*(\.[a-z][a-z0-9]*){2,}$/);
  });

  it('matches the Capacitor config', () => {
    expect(only(/appId:\s*'([^']+)'/g, capacitor, 'appId in capacitor.config.ts')).toBe(expected);
  });

  it('matches the Android application id', () => {
    expect(only(/applicationId\s+"([^"]+)"/g, gradle, 'applicationId')).toBe(expected);
    expect(only(/namespace\s*=\s*"([^"]+)"/g, gradle, 'namespace')).toBe(expected);
  });

  it('matches the iOS bundle id', () => {
    expect(only(/PRODUCT_BUNDLE_IDENTIFIER = ([^;]+);/g, pbxproj, 'bundle id')).toBe(expected);
  });
});

describe('the app name', () => {
  const expected = only(/appName:\s*'([^']+)'/g, config, 'appName in src/config.ts');

  it('matches the Capacitor config', () => {
    expect(only(/appName:\s*'([^']+)'/g, capacitor, 'appName in capacitor.config.ts')).toBe(expected);
  });

  it('matches what Android puts under the icon', () => {
    expect(
      only(/<string name="app_name">([^<]+)<\/string>/g, read('android/app/src/main/res/values/strings.xml'), 'app_name')
    ).toBe(expected);
  });

  it('matches what iOS puts under the icon', () => {
    expect(
      only(/<key>CFBundleDisplayName<\/key>\s*<string>([^<]+)<\/string>/g, read('ios/App/App/Info.plist'), 'CFBundleDisplayName')
    ).toBe(expected);
  });
});

describe('the version', () => {
  it('is a plain x.y.z, which both stores want', () => {
    expect(pkg.version).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('matches the Android version name', () => {
    expect(only(/versionName\s+"([^"]+)"/g, gradle, 'versionName')).toBe(pkg.version);
  });

  it('matches the iOS marketing version', () => {
    expect(only(/MARKETING_VERSION = ([^;]+);/g, pbxproj, 'MARKETING_VERSION')).toBe(pkg.version);
  });

  it('carries the same build number on both platforms', () => {
    expect(only(/CURRENT_PROJECT_VERSION = ([^;]+);/g, pbxproj, 'CURRENT_PROJECT_VERSION')).toBe(
      only(/versionCode\s+(\d+)/g, gradle, 'versionCode')
    );
  });
});

describe('what the app is allowed to reach', () => {
  const apiBase = only(/\?\?\s*'(https:\/\/[^']+)'/g, config, 'the default API base');

  it('is the client host the API resolves the tenant from', () => {
    // Not a preference. The API takes the client from the hostname, so this
    // value is which client this build belongs to.
    expect(apiBase).toBe('https://all-star.bi.letlois.com');
  });

  it('is the only host the page may connect to', () => {
    // Read out of the meta tag's content rather than off the raw file: the
    // comment above it discusses connect-src in prose, and a test that
    // matches prose is a test that passes on a policy nobody shipped.
    const html = read('index.html');
    const policy =
      /<meta[^>]*http-equiv="Content-Security-Policy"[^>]*content="([^"]+)"/.exec(html)?.[1] ?? '';
    expect(policy, 'no CSP meta tag').not.toBe('');

    const connect = /connect-src ([^;]+)/.exec(policy)?.[1]?.trim() ?? '';
    // The literal placeholder, substituted at build time from the same value
    // the API client uses, so the two cannot drift.
    expect(connect).toContain('%API_BASE%');
    expect(connect).not.toMatch(/\*/);
    expect(policy).toContain("default-src 'self'");
    expect(policy).toContain("script-src 'self'");
  });

  it('never ships cleartext http', () => {
    expect(read('android/app/src/main/AndroidManifest.xml')).not.toContain('usesCleartextTraffic');
    expect(capacitor).toContain('allowMixedContent: false');
  });
});

// The demo backend answers /api/field from fixtures. It exists so the app
// can be looked at without a rep's password, and it lives in the shared
// package because two preview shells use it. A build that shipped it would
// be an app that quietly shows a rep somebody's invented day instead of
// their own.
describe('the shipped app', () => {
  const sources = readdirSync(join(root, 'src'), { recursive: true, encoding: 'utf8' }).filter(
    (f) => /\.(ts|tsx)$/.test(f)
  );

  it('has sources to check', () => {
    expect(sources.length).toBeGreaterThan(0);
  });

  it('never reaches for the demo backend', () => {
    for (const file of sources) {
      const body = read(join('src', file));
      expect(body, `${file} imports the demo backend`).not.toMatch(/field-ui\/demo/);
    }
    // The entry point is what vite build follows, so this is the edge the
    // rule actually has to hold at.
    expect(read('src/main.tsx')).not.toMatch(/demo/i);
  });
});

describe('what the app asks the phone for', () => {
  const manifest = read('android/app/src/main/AndroidManifest.xml');
  const plist = read('ios/App/App/Info.plist');

  // Actual declarations, not any mention of one. Both files carry comments
  // explaining which permissions are deliberately absent, and a substring
  // search cannot tell an explanation from a request.
  const permissions = [...manifest.matchAll(/<uses-permission android:name="([^"]+)"/g)].map(
    (m) => m[1]!
  );
  const plistKeys = [...plist.matchAll(/<key>([^<]+)<\/key>/g)].map((m) => m[1]!);

  it('asks for location only while in use', () => {
    expect(permissions).toContain('android.permission.ACCESS_FINE_LOCATION');
    expect(plistKeys).toContain('NSLocationWhenInUseUsageDescription');
  });

  // The line both stores scrutinise hardest, and the one a rep would most
  // fairly object to. Nothing here follows anybody between knocks.
  it('never asks to track a rep in the background', () => {
    expect(permissions).not.toContain('android.permission.ACCESS_BACKGROUND_LOCATION');
    expect(plistKeys).not.toContain('NSLocationAlwaysUsageDescription');
    expect(plistKeys).not.toContain('NSLocationAlwaysAndWhenInUseUsageDescription');
  });

  it('asks for nothing else a rep would be surprised by', () => {
    for (const permission of permissions) {
      expect(permission, `unexpected permission: ${permission}`).toMatch(
        /^android\.permission\.(INTERNET|ACCESS_NETWORK_STATE|ACCESS_FINE_LOCATION|ACCESS_COARSE_LOCATION)$/
      );
    }
  });

  it('is locked to portrait, since it is used one handed while walking', () => {
    expect(manifest).toContain('android:screenOrientation="portrait"');
    const orientations = /<key>UISupportedInterfaceOrientations<\/key>\s*<array>([\s\S]*?)<\/array>/.exec(
      plist
    )?.[1];
    expect(orientations).toBeDefined();
    expect(orientations).not.toContain('Landscape');
  });
});
