# PlantOps staff app (Android APK): plan

Asked by the owner 2026-11-11: an APK so that employees can install PlantOps easily, without the "Add to Home Screen"
steps. It is **separate from Drop** (the customer app). The approved plan is in this file; status is in **section 0**.

## 0. Status: COMPLETE (2026-11-12, closed by the owner; leftovers in docs/TODO.md, low priority)
- **Live:** v0.66.0 (`81a3be9`); `STAFF_APP_SHA256` set on Railway; 7 of 8 addresses serve the file (Job applications
  had not redeployed yet). APK **"PureVibe" 1.0.1** at `~/projects/staff-apk/PureVibe-staff-1.0.1.apk`, shared with staff
  by the owner. Not done (moved to TODO, low): Job applications redeploy + check, the phone checklist (section 4),
  HANDBOOK section, Play Store, "Get the app" link.

### Build notes (2026-11-12)
- **2026-11-12 (owner):** the APK is shared directly with staff (no Play Store). The app is named **"Drop"** on the
  phone (owner's choice, same name as the customer app; package `life.bluemins.plantops`, so both install side by
  side). Steps 1–5 below are done: routes + login-gate exclusions in all 8 apps, tests / typecheck / `next build` pass,
  `apps/staff-app/` (twa-manifest + README), key at `~/projects/android-tools/keys/plantops-staff.keystore`, APK
  `~/projects/staff-apk/Drop-staff-1.0.0.apk` (minSdk 24; `bubblewrap build` refuses our SDK layout, so Gradle +
  apksigner, see the README). Fingerprint
  `44:5D:61:29:C6:47:42:0C:19:BB:52:D6:C1:68:EF:7F:E2:48:3F:33:07:AF:AB:E4:4E:17:3E:42:87:99:06:90`.
- **Renamed "PureVibe" with its own icon (owner, 2026-11-12):** water drop on a blue-to-aqua tile, `apps/staff-app/icons/`;
  APK `~/projects/staff-apk/PureVibe-staff-1.0.1.apk` (version code 2, installs over the Drop build). v0.66.0 live
  (`81a3be9`); `STAFF_APP_SHA256` set by the owner.
- **Left:** `STAFF_APP_SHA256` on all 8 Railway services (until then the app shows an address bar), then the phone
  checklist (section 4), the HANDBOOK section and the CLAUDE.md status note.

### Handover of 2026-11-11 (kept for history)
- **Decided (owner, 2026-11-11):** a **Trusted Web Activity (TWA)** built with Google's Bubblewrap around
  `app.bluemins.life`. The owner accepts its three limits:
  - one PlantOps icon for every plant (not each plant's logo)
  - phones remove the old home-screen PlantOps icon by hand
  - Android only (iPhones keep "Add to Home Screen")
- **Not changed:** the database, permissions, tenant isolation and the SSO token.
- **Done (in the working tree, not committed):**
  - `packages/auth/src/assetlinks.ts`: `assetLinksResponse()` and `staffAppFingerprints()`, exported from
    `packages/auth/src/index.ts` (one line added at the end).
  - `packages/auth/test/assetlinks.test.ts`: tests for the helper, plus a repo check that every app has the route and
    lets it past its login gate. **That check fails until step 1 below is done**, so don't commit the test without the
    route files.
  - Nothing has been run yet: no tests, no typecheck.
- **Next, in order:**
  1. Add `src/app/.well-known/assetlinks.json/route.ts` (`export const GET = () => assetLinksResponse();`) to
     `apps/platform` and to lab-records, document-store, floor-stock, complaint-box, order-capture, attendance-salary
     and job-applications.
  2. Add `\.well-known/` to the matcher exclusion in each module's `src/proxy.ts`. Six use the same pattern; Order
     Capture has its own list. Job applications needs no change because it only gates its private paths.
  3. Run the tests for `packages/auth` and the whole repo, the typecheck, and `next build` for each changed app.
  4. Build the APK in a new folder `apps/staff-app/` (section 2). It needs the Android tools Drop already uses:
     `JAVA_HOME=~/projects/android-tools/jdk-21.0.13+9`, `ANDROID_HOME=~/projects/android-tools/sdk`. Bubblewrap isn't
     installed yet (`npx @bubblewrap/cli`).
  5. Create the signing key at `~/projects/android-tools/keys/plantops-staff.keystore` (outside the repo, never
     committed; copy it and its password to the password manager), then read its SHA-256 fingerprint.
  6. **Ask the owner first:** the release (next free version; **v0.65.x is now used by Cash book C3**), the deploy, and
     `STAFF_APP_SHA256` on all 8 Railway services (give the complete value).
  7. Run the phone checklist (section 4), then the docs: a HANDBOOK section "Staff app (Android)", a CLAUDE.md status
     note and `docs/deployments/shared.md`.
- **Careful:** other sessions are working in the same tree (Cash book C3, marketing insights). Commit only this work's
  files.

## 1. How it works
Android shows the app with no address bar only on addresses that prove they belong to the app. Each address serves
`/.well-known/assetlinks.json`, naming the app's package id and its signing-key fingerprint. Without the file, a module
still works but opens with a browser bar.

The app trusts these addresses: `app.`, `lab.`, `docs.`, `stock.`, `complaints.`, `orders.`, `attendance.` and
`jobs.bluemins.life`.

Because the screens still come from the server, **every PlantOps release reaches the app with no reinstall.** Push
notifications keep using the existing Web Push and `sw.js`; the app only receives them (notification delegation).

**Settings** (both public, not secrets):
- `STAFF_APP_PACKAGE`: default `life.bluemins.plantops`.
- `STAFF_APP_SHA256`: one or more fingerprints, comma-separated, so Play's signing key can be added later. If it is
  empty or broken, the address answers 404 (and a broken value is logged).

## 2. The app folder `apps/staff-app/`
It is not a pnpm workspace app and nothing deploys it.
- `twa-manifest.json`:
  - host `app.bluemins.life`, start `/home`, name "PlantOps", PlantOps blue (`#1d4ed8`)
  - icon `apps/platform/public/icon-512.png`
  - `additionalTrustedOrigins` = the other seven addresses
  - notifications on, location delegation on (Attendance), fallback `customtabs`
- `README.md`: how to build, bump the version, find the key and its fingerprint, and send the APK on WhatsApp.
- `.gitignore`: the keystore, build output and APKs.
- If the key is lost, every phone must uninstall and reinstall the app.

## 3. Tests
- The helper: one fingerprint and two, the package override, 404 when the setting is empty or broken, and the JSON
  content type.
- The repo check: every app has the route and every login gate lets the file through.
- All existing suites still pass.

## 4. Checks
1. **Locally:** `curl` `/.well-known/assetlinks.json` on each port, with and without the setting, and check there is
   no login redirect.
2. **After the deploy and the setting:** run Google's Digital Asset Links check for each address.
3. **On the owner's Android phone:**
   - [ ] install the APK
   - [ ] log in (plant code + PIN)
   - [ ] the launcher opens with no address bar
   - [ ] open each module tile: still no bar
   - [ ] "Send a test" notification arrives, and tapping it opens the right page
   - [ ] Attendance: scan the QR, and the location check passes
   - [ ] take a photo and upload it (Complaint Box / claims)
   - [ ] the back button and Logout behave
   - [ ] after a redeploy, the app shows the new version with no reinstall
4. **One staff phone** installs it from a WhatsApp file before the APK goes out to everyone.

## 5. Later
- Play Store listing once the D-U-N-S / organisation account exists. Play adds its fingerprint to `STAFF_APP_SHA256`.
- A "Get the app" link on the login page.
