// Puts one version number into the three places a release needs it.
//
// package.json is the one a person edits. Android reads versionName from
// build.gradle, iOS reads MARKETING_VERSION from the Xcode project, and the
// Me screen in the app reads package.json. Three copies of the same fact is
// three chances for a rep to report a bug against a version that was never
// shipped, so nobody edits the other two by hand.
//
//   pnpm --filter @letlois/all-star-field-app version:set          bump the build number
//   pnpm --filter @letlois/all-star-field-app version:set -- 42    set it explicitly
//
// The build number is the separate integer both stores use to tell two
// uploads of the same version apart. It only ever goes up: Play rejects an
// upload whose versionCode it has seen, and App Store Connect rejects a
// build number it already holds for that version.

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const gradlePath = join(root, 'android/app/build.gradle');
const pbxprojPath = join(root, 'ios/App/App.xcodeproj/project.pbxproj');

const { version } = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
if (!/^\d+\.\d+\.\d+$/.test(version)) {
  console.error(`package.json version "${version}" is not a plain x.y.z, which both stores want.`);
  process.exit(1);
}

const gradle = readFileSync(gradlePath, 'utf8');
const currentBuild = Number(/versionCode\s+(\d+)/.exec(gradle)?.[1] ?? 0);

const requested = process.argv[2];
const build = requested === undefined ? currentBuild + 1 : Number(requested);
if (!Number.isInteger(build) || build < 1) {
  console.error(`"${requested}" is not a build number.`);
  process.exit(1);
}
if (build <= currentBuild && requested !== undefined) {
  console.error(
    `Build ${build} is not above the current ${currentBuild}. Both stores refuse a build number they have already seen.`
  );
  process.exit(1);
}

writeFileSync(
  gradlePath,
  gradle
    .replace(/versionCode\s+\d+/, `versionCode ${build}`)
    .replace(/versionName\s+"[^"]*"/, `versionName "${version}"`)
);

writeFileSync(
  pbxprojPath,
  readFileSync(pbxprojPath, 'utf8')
    .replace(/CURRENT_PROJECT_VERSION = [^;]+;/g, `CURRENT_PROJECT_VERSION = ${build};`)
    .replace(/MARKETING_VERSION = [^;]+;/g, `MARKETING_VERSION = ${version};`)
);

console.log(`Version ${version}, build ${build}, set in Android and iOS.`);
console.log('Now run: pnpm --filter @letlois/all-star-field-app sync');
