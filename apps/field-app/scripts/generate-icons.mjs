// Renders every icon and splash asset both native projects need, from the
// one SVG in resources/.
//
// Written down as a script rather than done once by hand because these
// assets are regenerated every time the mark changes, and hand placing
// thirty PNGs across two platforms is exactly the kind of job that ends with
// one density still showing the old logo.
//
//   pnpm --filter @letlois/all-star-field-app icons
//
// Replacing the artwork means replacing resources/icon.svg and running this
// again. Nothing downstream needs to be touched.

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
// The mark alone, on transparency. Everything else here is this laid over a
// background, at a size and a scale.
const source = join(root, 'resources', 'mark.svg');

// The app's background, shared by the splash screen and the Android
// adaptive icon's background layer, so the mark never sits on a seam.
const NAVY = '#263449';

// Android launcher densities, in the baseline 48dp units the platform uses.
const LAUNCHER_DENSITIES = [
  ['mdpi', 48],
  ['hdpi', 72],
  ['xhdpi', 96],
  ['xxhdpi', 144],
  ['xxxhdpi', 192],
];

// Adaptive icons are 108dp with only the middle 72dp reliably visible: the
// launcher masks the rest into whatever shape the phone uses. So the
// foreground layer is drawn at the same densities but scaled down to sit
// inside that safe area, or the door loses its top on a round mask.
const ADAPTIVE_DENSITIES = LAUNCHER_DENSITIES.map(([name, size]) => [name, Math.round(size * 2.25)]);
const SAFE_AREA = 0.62;

// The mark at a given size, on transparency.
function mark(size) {
  return sharp(source, { density: 512 }).resize(size, size).png();
}

// The full square icon: the mark edge to edge on the app's navy. This is
// what a legacy launcher and the App Store show.
function render(size) {
  return sharp(source, { density: 512 })
    .resize(size, size)
    .flatten({ background: NAVY })
    .png();
}

async function writePng(pipeline, ...pathParts) {
  const target = join(root, ...pathParts);
  mkdirSync(dirname(target), { recursive: true });
  await pipeline.toFile(target);
  console.log(`  ${pathParts.slice(1).join('/')}`);
}

// The adaptive foreground: the mark inset into the safe area, on
// transparency, so the launcher's background layer shows through around it
// and the two can be shifted independently without a seam appearing.
async function foreground(size) {
  const inner = Math.round(size * SAFE_AREA);
  const inset = await mark(inner).toBuffer();
  const offset = Math.round((size - inner) / 2);
  return sharp({
    create: { width: size, height: size, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
  })
    .composite([{ input: inset, top: offset, left: offset }])
    .png();
}

// A pre-rounded copy for launchers that ask for one rather than masking the
// adaptive icon themselves.
async function round(size) {
  const square = await render(size).toBuffer();
  const circle = Buffer.from(
    `<svg width="${size}" height="${size}"><circle cx="${size / 2}" cy="${size / 2}" r="${size / 2}" fill="#fff"/></svg>`
  );
  return sharp(square)
    .composite([{ input: circle, blend: 'dest-in' }])
    .png();
}

// The splash is the mark small and centred on the app's own navy, so the
// launch reads as one continuous surface into the header rather than a
// picture that gets replaced.
async function splash(width, height) {
  const size = Math.round(Math.min(width, height) * 0.28);
  const centred = await mark(size).toBuffer();
  return sharp({ create: { width, height, channels: 4, background: NAVY } })
    .composite([{ input: centred, gravity: 'centre' }])
    .png();
}

async function main() {
  console.log('Android launcher icons');
  for (const [density, size] of LAUNCHER_DENSITIES) {
    await writePng(render(size), 'android/app/src/main/res', `mipmap-${density}`, 'ic_launcher.png');
    await writePng(
      await round(size),
      'android/app/src/main/res',
      `mipmap-${density}`,
      'ic_launcher_round.png'
    );
  }

  console.log('Android adaptive foregrounds');
  for (const [density, size] of ADAPTIVE_DENSITIES) {
    await writePng(
      await foreground(size),
      'android/app/src/main/res',
      `mipmap-${density}`,
      'ic_launcher_foreground.png'
    );
  }

  console.log('Android splash screens');
  // Portrait and landscape are both required even though the app is portrait
  // locked: the launch theme is drawn before the orientation lock applies,
  // and a missing landscape asset shows as a black frame on rotation.
  for (const [density, [portraitW, portraitH]] of Object.entries({
    mdpi: [320, 480],
    hdpi: [480, 800],
    xhdpi: [720, 1280],
    xxhdpi: [960, 1600],
    xxxhdpi: [1280, 1920],
  })) {
    await writePng(
      await splash(portraitW, portraitH),
      'android/app/src/main/res',
      `drawable-port-${density}`,
      'splash.png'
    );
    await writePng(
      await splash(portraitH, portraitW),
      'android/app/src/main/res',
      `drawable-land-${density}`,
      'splash.png'
    );
  }
  await writePng(await splash(480, 800), 'android/app/src/main/res', 'drawable', 'splash.png');

  console.log('Android adaptive background colour');
  writeFileSync(
    join(root, 'android/app/src/main/res/values/ic_launcher_background.xml'),
    `<?xml version="1.0" encoding="utf-8"?>\n<resources>\n    <color name="ic_launcher_background">${NAVY.toUpperCase()}</color>\n</resources>\n`
  );
  console.log('  values/ic_launcher_background.xml');

  console.log('iOS app icon');
  // A single 1024 icon. Xcode has produced every other size it needs from
  // this one since Xcode 14, so shipping the rest would only be more files
  // to forget to update.
  await writePng(render(1024), 'ios/App/App/Assets.xcassets/AppIcon.appiconset', 'AppIcon-512@2x.png');

  console.log('iOS splash');
  // Square and oversized so it covers every device without letterboxing,
  // which is what Capacitor's own template does.
  for (const name of ['splash-2732x2732.png', 'splash-2732x2732-1.png', 'splash-2732x2732-2.png']) {
    await writePng(await splash(2732, 2732), 'ios/App/App/Assets.xcassets/Splash.imageset', name);
  }

  console.log('\nDone. Run `pnpm --filter @letlois/all-star-field-app sync` to copy into the apps.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
