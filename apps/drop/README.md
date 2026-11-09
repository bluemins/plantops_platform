# Drop — the customer app for shops (Android, Capacitor)

Plan: `docs/CUSTOMER_APP_PHASE_PLAN.md` (Phase 5). Screens: Login (phone + WhatsApp code), Home, Points, Polls. The app
talks only to the Sales customer API (`/api/app/v1/*` on `orders.bluemins.life`), sending `x-drop-app: drop` and the
login token (kept in Android's secure storage). Calls go through Android's own HTTP (`CapacitorHttp`), so no CORS
change is needed on Sales. The plant's name, brand colour and logo come from `/api/app/v1/look` and `/logo`; Drop blue
until they load. Every text is in `src/text/en.ts`.

## Build the test APK

```bash
cd apps/drop
export JAVA_HOME=~/projects/android-tools/jdk-21.0.13+9 ANDROID_HOME=~/projects/android-tools/sdk
export PATH=$JAVA_HOME/bin:$PATH
pnpm android            # vite build + cap sync + gradle assembleDebug
# APK: android/app/build/outputs/apk/debug/app-debug.apk (debug-signed; Play signing comes in Phase 7)
```

Another API address: `VITE_DROP_API_URL=https://… pnpm android`. Version: `package.json` and
`android/app/build.gradle` (`versionName`, `versionCode`).

## Tests

`pnpm test` (Vitest + Testing Library: formatting and each screen's states), `pnpm typecheck`.

The browser (`pnpm dev`) can't reach the live API (cross-site rule; only the phone uses native HTTP): use it for layout only.
