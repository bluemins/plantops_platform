# Drop (staff app, Android)

The employee app: a Trusted Web Activity around `https://app.bluemins.life` (plan: `docs/STAFF_APP_PHASE_PLAN.md`).
Not a pnpm app; nothing deploys it. Separate from the customer app `apps/drop` (package `life.bluemins.drop`); this one
is `life.bluemins.plantops`, also named "Drop" on the phone (owner, 2026-11-12).

## Build
```sh
export JAVA_HOME=~/projects/android-tools/jdk-21.0.13+9 ANDROID_HOME=~/projects/android-tools/sdk
# after changing twa-manifest.json (bump appVersionCode + appVersionName for a new APK):
npx @bubblewrap/cli@1.24.1 update --skipVersionUpgrade
printf 'sdk.dir=%s\n' "$ANDROID_HOME" > local.properties
./gradlew assembleRelease --no-daemon
BT=$ANDROID_HOME/build-tools/36.0.0; KSPW=$(cat ~/projects/android-tools/keys/plantops-staff.password); export KSPW
$BT/zipalign -p -f 4 app/build/outputs/apk/release/app-release-unsigned.apk /tmp/aligned.apk
$BT/apksigner sign --ks ~/projects/android-tools/keys/plantops-staff.keystore --ks-key-alias plantops-staff \
  --ks-pass env:KSPW --key-pass env:KSPW --out ~/projects/staff-apk/Drop-staff-<version>.apk /tmp/aligned.apk
```
(`bubblewrap build` refuses our SDK folder layout, so Gradle + apksigner are used directly.)

## Key
`~/projects/android-tools/keys/plantops-staff.keystore` (alias `plantops-staff`), password in `plantops-staff.password`
next to it. Never in the repo; keep both in the password manager. **If the key is lost, every phone must uninstall and
reinstall.** Fingerprint (public, goes in `STAFF_APP_SHA256` on every Railway service):
`44:5D:61:29:C6:47:42:0C:19:BB:52:D6:C1:68:EF:7F:E2:48:3F:33:07:AF:AB:E4:4E:17:3E:42:87:99:06:90`

## Share
Send the APK file on WhatsApp; staff tap it and allow "install unknown apps" for WhatsApp / Files once.
