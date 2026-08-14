# Releasing All Star Field

Everything needed to get `apps/field-app` onto the App Store and Play Store,
and to ship an update afterwards.

The build side is automated. The parts that need a person are the parts that
need an account, a signing key, a screenshot or a legal answer, and those
are called out as **you** below rather than buried in a list of commands.

---

## Before the first release

These are one time, and nothing can ship until they are done.

### 1. Developer accounts

**You** need both, and neither is instant.

| | Cost | Approval time | Notes |
| --- | --- | --- | --- |
| Apple Developer Program | 99 USD/year | Hours to days | An Organization account needs a D-U-N-S number, which can take over a week to get. A personal account is faster but publishes under a person's name. |
| Google Play Console | 25 USD once | Days | An organization account now needs business verification, including a D-U-N-S number. |

Decide who owns them. If All Star may ever want the app under their own
account, register it there now: **an app cannot be transferred between
accounts without republishing it**, which means every rep reinstalls by
hand. If LetLois owns the accounts, the listing says LetLois, which is
normal for an agency built app and which All Star should know before it goes
live.

### 2. Reserve the bundle id

`com.letlois.allstarfield`, in both consoles. It is permanent after the
first upload, in both stores. If it should read as All Star's own
(`com.allstar.field` or similar), change it now, in three places, before
anything is uploaded:

- `apps/field-app/src/config.ts` (`appId`)
- `apps/field-app/capacitor.config.ts` (`appId`)
- the Xcode project and `android/app/build.gradle`, easiest by deleting
  `ios/` and `android/` and re-running `npx cap add ios` / `npx cap add
  android` after the first two are changed

### 3. Signing

**Android.** Create an upload keystore, and keep it out of this repo. The
repo's `.gitignore` refuses `*.jks` and `*.keystore` so it cannot be
committed by accident.

```bash
keytool -genkey -v -keystore all-star-field-upload.jks \
  -keyalg RSA -keysize 2048 -validity 10000 -alias upload
```

Store the file and its password somewhere that survives a laptop dying.
Losing it means asking Google to reset the upload key, and until they do,
no update can ship. Enrol in Play App Signing (the default), which keeps the
distribution key with Google and makes a lost upload key recoverable.

**iOS.** Xcode's automatic signing handles it once the Apple account is
attached: open `ios/App/App.xcworkspace`, pick the team under Signing and
Capabilities, and it creates the certificate and provisioning profile.

### 4. Privacy policy, hosted at a URL

Both stores require one, publicly reachable, before review. `docs/field-app-privacy.md`
is written and ready for this app. **You** need to host it, most simply as a
page on `letlois.com` or All Star's site, and put the URL in both listings.

### 5. Store listings

Both need copy, an icon and screenshots. Draft copy is in
`docs/field-app-store-listing.md`. Screenshots have to come from a real
device or simulator, which needs the app running, so they come last.

---

## Building a release

```bash
# 1. Set the version. Edit "version" in apps/field-app/package.json first if
#    this is more than a rebuild, then:
pnpm --filter @letlois/all-star-field-app version:set

# 2. Build the web bundle and copy it into both native projects.
pnpm --filter @letlois/all-star-field-app sync
```

Step 2 is not optional and not implied by anything else. The native projects
hold their own copy of `dist/`; skipping it ships the previous build inside
a new version number, which is the single easiest mistake to make here.

### Android

```bash
pnpm --filter @letlois/all-star-field-app open:android
```

In Android Studio: **Build > Generate Signed App Bundle**, choose the
keystore from step 3, and upload the resulting `.aab` to the Play Console.
Play requires an App Bundle, not an APK.

### iOS

Needs a Mac. On one, once, after cloning:

```bash
cd apps/field-app/ios/App && pod install
```

Then:

```bash
pnpm --filter @letlois/all-star-field-app open:ios
```

In Xcode: select **Any iOS Device**, then **Product > Archive**, then
**Distribute App > App Store Connect**.

---

## What review will ask about

Both stores reject on the same handful of things. These are the ones this
app actually touches.

**Location.** Both want to know why, in the app and in the listing. The iOS
prompt string is in `ios/App/App/Info.plist` and is written for the rep
reading it. The app asks for location only when the rep taps for it, only
while the app is open, and works without it, which is worth saying in the
review notes because it removes the usual objection.

**A login wall with no way in.** This is the most likely rejection, and it
catches almost every app like this. Apple will not review an app they cannot
sign into. **You** must give App Store Connect a working demo account, under
App Review Information, as a real rep on All Star's roster. Create one in
Data and Team, mark it clearly (for example `apple.review@allstar.test`),
and leave it active while the app is in review.

**"Is this just a website?"** Apple rejects apps that are only a wrapped
site with nothing native about them. This one has an answer: it works
offline, queues knocks with no signal and sends them later, and uses device
location. Say that in the review notes rather than hoping it is noticed.

**Data safety and privacy labels.** Both stores need a declaration of what
is collected. Answers are in `docs/field-app-store-listing.md`. They must
match what the app actually does, and a mismatch found later takes the app
down rather than asking about it.

**Account deletion.** Apple requires that an app with accounts offers a way
to delete one. Reps do not create their own accounts here; a manager does,
in Data and Team, and a manager deletes them. Say exactly that in the review
notes, along with the support email a rep can write to. If a reviewer
insists, the fallback is a Delete account button on the Me screen that
emails the manager, which is not built.

---

## Shipping an update

```bash
# bump "version" in package.json if the change is user visible, then
pnpm --filter @letlois/all-star-field-app version:set
pnpm --filter @letlois/all-star-field-app sync
```

Then archive and upload as above. A rep does not have to reinstall; both
stores update the app in place.

**A change to the API does not need an app release.** The app calls the same
Worker the dashboard does, so a fix to `/api/field/*` reaches every phone as
soon as the Worker deploys. Only a change inside `packages/field-ui` or
`apps/field-app` needs a new build, and until reps update, older versions
keep talking to the same API. Do not remove or change the shape of a
`/api/field/*` response without checking what an installed build does with
it: unlike the web app, you cannot assume every rep is on the latest one.

---

## Known rough edges

- **`UIRequiredDeviceCapabilities` is `armv7`** in `Info.plist`. That is
  Capacitor's template default and ships in a great many apps, but it
  describes 32 bit hardware that no supported iPhone has had since iOS 11.
  Left alone rather than changed blind. If App Store validation ever
  complains about it, removing the key is the fix.
- **No CI for the mobile builds.** Both need platform SDKs (Xcode needs a
  Mac) that the Workers and Pages builds do not, so releases are a manual
  step today. Worth automating once the release cadence justifies it.
- **The icon is generated, not designed.** `apps/field-app/resources/mark.svg`
  is a real icon that reads at 48px, but it is not artwork All Star chose.
