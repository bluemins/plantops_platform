# App notifications (bell + phone push)

Approved by the owner on 2026-10-11. CLAUDE.md has the short version ("Notifications" roadmap); this file holds the
full design, the review findings and the build prompt for each phase.

## Why
Owners (and later staff) must hear about important plant events without paying for email, SMS or WhatsApp, or
setting them up. The existing email alerts stay as they are; notifications are added alongside.

Notifications appear in two places:
1. **A bell 🔔 on the launcher after login**, with an unread count and a list. The login page itself can't show
   them because it doesn't know who is looking yet.
2. **A phone notification** once PlantOps (`app.bluemins.life`) is installed on the home screen. This uses
   **Web Push**: free, delivered by the phone's own browser push service, and it needs only a key pair we
   generate ourselves.

## How it works (every phase)
- **The platform owns one inbox:** `platform.notifications`, one row per recipient, each with its own read mark.
- **Modules only send events**, server-to-server with their module credentials:
  `POST /api/m/tenants/:tid/notifications` with
  `{ kind, title (≤ 80), body (≤ 300), link (path inside the module), dedupe_key, exclude_user_id? }`.
  - **The platform decides who receives it** (N2): the plant's active owners (always) + the people the owner
    ticked for that module on Manage users ("Gets alerts") + `also_user_ids` (the people an event is about, e.g.
    the technicians of an approved batch), each re-checked at send time (active, this plant, works in the module
    via `roleWorksIn`), minus `exclude_user_id`. A module can never pick arbitrary people or reach another plant.
  - A module that isn't enabled for the plant gets 403.
  - The same event (`module + dedupe_key`) is stored only once per person.
- **Opening a notification:** a tap goes to `/sso/start?module=<id>&next=<link>` (checked by `safeNext`), so it
  follows the normal login and handoff.
- **Phone push:**
  - The `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` and `VAPID_SUBJECT` keys are set on the platform only.
    `pnpm push:keys` makes a pair; each Dedicated copy needs its own.
  - Without the keys the bell still works.
  - Phones are stored in `platform.push_subscriptions`. A phone is removed on logout, or when the push service
    answers 404/410.
- **iPhone:** iOS 16.4 or newer, and PlantOps must be added to the Home Screen first. Android works from Chrome.
  Push needs HTTPS, so phones are tested on the live copy, not on the LAN address.
- **Modules call `kit.notify(tenantId, input)`** (`packages/module-kit`). It never throws; a failure is logged.
  - Sending is best effort, after the module's answer (`after()`), until N4 adds a retry outbox.
- **Database:** migration `apps/platform/db/migrations/0009_notifications.sql`. Both tables have `tenant_id` and
  FORCE RLS.
  - `platform_app` may SELECT / INSERT notifications and UPDATE `read_at` only.
  - `platform_app` may SELECT / INSERT / DELETE push subscriptions.
  - The SSO token is unchanged.

## Status
- **N1 built 2026-10-11** (release v0.7.0, not deployed yet). See the CLAUDE.md status note.
- **N2 built 2026-10-11** (release v0.8.0, not deployed yet): chosen people ("Gets alerts" tick boxes),
  `/notifications` page, 🔔 in every module header, Lab Records events (table below).
- **N3 built 2026-10-11** (release v0.9.0, not deployed yet): Document Store and PlantOps events (tables below).

### Document Store events (N3, as built)
| Event | Recipients | Level | Opens |
|---|---|---|---|
| "FSSAI licence: expires in 7 days" (30 / 7 / 1 / on expiry / weekly; once per version and stage) | owners + ticked + the responsible person | phone + bell | document |
| You are responsible for … | only that person (not when they chose themselves) | phone + bell | document |
| New document / Renewed | owners + ticked, minus who did it | bell | document |
| Document storage 80% / 95% full | owners + ticked | phone + bell | home |

### PlantOps events (N3, as built; owners only, never ticked people)
| Event | Level | Opens |
|---|---|---|
| X is locked out (5 wrong PINs / passwords; the locked person left out) | phone + bell | Manage users |
| PlantOps support viewed <module> | bell | that module's Support access |
| <Module> is now switched on | phone + bell | the module |
| <Module> is switched off / Your PlantOps plan was updated | bell | PlantOps home |
| Your PlantOps plan renews in N days (30 / 7 / 1 / on the day; platform daily job) | phone + bell | PlantOps home |

### Lab Records events (N2, as built)
| Event | Recipients | Level | Opens |
|---|---|---|---|
| Batch X ON HOLD (failed test, also via a correction) | owners + ticked, minus who entered it | phone + bell | batch |
| Form 3 / Form 4: FAIL | owners + ticked, minus who entered it | phone + bell | record |
| Batch X ready for approval (pending, tests on record, nothing failing; again after each released hold) | owners + ticked, minus actor | phone + bell | batch |
| Batch X approved / rejected (+ reason) | owners + ticked + technicians who tested it, minus actor | phone + bell | batch |
| Result corrected (vN): reason | owners + ticked, minus actor | **bell only** | record |
| Lab Records reminder (holds > 24 h, Form 1 due from the 25th; 07:00 job, same text as WhatsApp) | owners + ticked | phone + bell | home |
| No lab tests entered today (20:00 job, `POST /api/cron/evening`) | owners + ticked | phone + bell | new test |

## Phases at a glance
Finish and test each phase, then add a status note in CLAUDE.md, before starting the next.

| Phase | What | Who receives |
|---|---|---|
| **N1 (v1)** | Inbox, bell, installable app, phone push, `kit.notify`; **every Floor Stock event** | Owners |
| N2 | **Chosen people get alerts** (owner ticks e.g. a manager per module), a notifications page for them + **Lab Records** | Owners + ticked people |
| N3 | **Document Store** expiry and ownership events + **platform** events | Owners, responsible person |
| N4 | Settings and reliability: on/off per event, evening time per plant, retry outbox, 90-day cleanup | Everyone |
| N5+ | Inside each new module phase (Preventive Mgmt, AMC, Attendance, Marketing) | Per module |

---

## N1 (v1): the system + Floor Stock (detailed design)

### Floor Stock events (to the plant's owners)
| # | Event | When | Text (example) | Opens | Level |
|---|---|---|---|---|---|
| 1 | Count saved | store keeper / plant staff submits | "Stock count saved: Atharv, 11 Oct, 6:40 pm" | `/day/<date>` | phone + bell |
| 2 | Count corrected | new version saved | "Count corrected (v2) by Atharv: <reason>" | `/day/<date>` | phone + bell |
| 3 | Low stock | items newly below their limit (once per item per day, the same rule as the email) | "⚠ Low stock: 3 items: Caps 500 ml (120, limit 500), …" | `/day/<date>` | phone + bell |
| 4 | Check the count | sold comes out negative compared with the day before | "Check the count: 2 items look wrong (Box 1 L sold −5)" | `/day/<date>` | phone + bell |
| 5 | Count not done | **8 pm India time**, no count for today and the plant has items set up | "Today's stock count is not done yet" | `/count` | phone + bell |
| 6 | Setup changed by staff | a store keeper / plant staff adds or edits an item, or re-orders items | "Atharv added item 'Ring 20 L' in Consumable" | `/setup` | **bell only** |

Rules:
- Events 1–4 are **one notification per save**. The title takes the most serious case (low stock > check the
  count > saved), and the body lists the rest.
- Nothing is sent for the owner's own actions (`exclude_user_id`).
- Event 5 comes from a new evening job: `POST /api/cron/evening` (with `CRON_SECRET`) and the GitHub workflow
  `.github/workflows/evening.yml` at 14:30 UTC (8 pm IST).
  - It is sent once per plant per day (dedupe `missing:<date>`).
  - Plants come from `floor_stock.counting_tenants()` (Floor Stock migration `0002`: plants with active items;
    `stock_tenants()` only lists plants with emails waiting). A plant that has switched Floor Stock off is
    skipped quietly (covered by a test).
  - GitHub may start it 10–30 minutes late. Plants that count after 8 pm get a false "not done" until N4.
- Event 6 is one notification per save action, at bell level so that building the item list doesn't flood the
  owner's phone.

### Platform (`apps/platform`)
- `src/server/notifications.ts`:
  - `notifyOwners(moduleId, tenantId, input)`: recipients query modelled on `getAlertContacts`
    (`src/server/sso.ts`), plan check via `enabledModules`, inside `withTenant`
  - `listFor(user)`: the latest 30 + the unread count
  - `markRead(user, ids | "all")`: the user's own rows only
- `src/server/push.ts`: the `web-push` library; 24 h TTL; deletes a phone on a 404/410 answer; quietly off without
  `VAPID_*`. Bell-level notifications are never pushed.
- Routes:
  - `api/m/tenants/[tid]/notifications`: module POST, with `authenticateModule`
  - `api/notifications`: GET
  - `api/notifications/read`: POST
  - `api/push`: GET the public key, POST to subscribe, DELETE to unsubscribe
- Installable app:
  - `src/app/manifest.ts`: name "PlantOps", start `/home`, standalone, 192 / 512 px icons in `public/`
  - `public/sw.js`: shows the push; a tap opens or focuses the link
- Launcher `src/app/home/page.tsx` (owners):
  - bell + list (tap = mark read + open) and "Mark all read"
  - refresh every 60 s and when the app returns to the screen
  - a "Turn on phone notifications" card, with the iPhone hint and help when notifications are blocked
  - logout unsubscribes this phone first

### Shared packages
- `packages/types`: `NotificationInput` (zod, with `level: "push" | "bell"`, default `"push"`).
- `packages/auth/src/client.ts`: `sendNotification()`, next to `fetchAlertContacts`.
- `packages/module-kit/src/module.ts`: `kit.notify(tenantId, input)`, which never throws and logs errors.

### Floor Stock (`apps/floor-stock`)
- `src/server/alerts.ts`: `queueLowStock` also returns the names of the **newly** low items.
- `src/server/counts.ts`: `submitCount` also returns the negative-sold items, using `compare()` (`src/lib/compare.ts`)
  against the previous day's latest version.
- New `src/server/notify.ts`: builds the texts for events 1–6.
- `api/counts` and the setup routes call `after()` → `kit.notify`.
- New `api/cron/evening`.

### Tests
- **Platform:**
  - module POST: 401 / 403 / 400
  - recipients: active owners only, the actor excluded
  - dedupe per module
  - plant A never sees plant B's notifications (API and DB)
  - mark-read touches your own rows only
  - subscribe / unsubscribe; the same phone used in two plants; the same phone handed to another user
  - push against a fake push server, including deletion on 410
  - bell-level notifications are never pushed
  - no VAPID keys → the inbox still works
- **Floor Stock:**
  - the text of each event
  - one notification per save, titled by priority
  - only newly low items on a correction
  - negative-sold detection
  - no notification for the owner's own actions
  - the evening job: no count → sent once; count done → nothing; no items → nothing; module switched off → skipped
    quietly
  - platform down → the count is still saved
- **module-kit:** `notify` swallows errors.

### Verification
1. Desktop Chrome on `localhost` (push is allowed there):
   - the owner turns on notifications
   - a store keeper in a second browser profile saves a count with an item below its limit
   - one "⚠ Low stock" notification appears, the bell shows 1, and tapping it opens the day page
2. Run the evening job by hand with no count saved → "not done" arrives.
3. On a live phone after deploy:
   - Android Chrome: install → turn on → save a count
   - iPhone (iOS 16.4+): Add to Home Screen → turn on → save a count; check whether opening the notification
     asks for the login again (review finding 4)

### Deploy
- Railway `platform` service: add the 3 `VAPID_*` variables and run migration `0009`. Release v0.7.0.
- GitHub: add the `evening.yml` workflow (uses the existing `STOCK_URL` / `CRON_SECRET`).
- Dedicated copies: their own `VAPID_*` keys (add to the deploy checklist).

---

## Review findings (2026-10-11)
Found while reviewing the plan, before the build. Fixes 1-3 were approved by the owner on 2026-10-11 and are in
migration `0009`; the launcher card's "Not now" hides it on that phone for 7 days.

**Must fix before building**
1. **A phone used for two plants.** "One row per phone in the whole database" fails with a hidden error when the
   same phone is already saved under another plant (each plant sees only its own rows).
   → Unique **per plant** (`tenant_id, endpoint`); a second user on the same phone takes it over.
2. **Dedupe across modules.** The "already sent" check didn't include the module, so two modules using the same
   key would drop each other's notifications. → `unique (tenant_id, user_id, module_id, dedupe_key)`.
3. **Setup changes flooding the phone.** 40 items added means 40 buzzes. → Two levels: **phone + bell** for
   counts / low stock / check / not done, **bell only** for setup changes (column `level`).

**Worth knowing (test, or accept for now)**

4. **iPhone home-screen app has its own login**, separate from Safari: the owner logs in once inside the app.
   Opening a notification leaves the app for `stock.bluemins.life`, which may ask for the login again. This must
   be checked on a real iPhone; if it's annoying, a later fix is a short summary inside PlantOps before the jump.
5. **The platform session lasts 12 h.** Notifications still arrive after it ends; opening one may show the login.
6. **The 8 pm reminder can be late** (GitHub timing), and plants that count after 8 pm get a false reminder until
   N4.
7. **"Count not done" for a plant that has switched Floor Stock off** must be skipped quietly, not logged as an
   error every night.

**Housekeeping**

8. The design lived in a plan file outside the repo → now in this file, linked from CLAUDE.md.
9. **Privacy answer for plants:** phone notifications pass through Google's / Apple's push service, encrypted end
   to end and not stored. Add this to the hosting answers next to "data stored in Singapore".
10. **Each Dedicated copy needs its own `VAPID_*` keys:** add to the deploy checklist.

---

## Later phases (outline; planned in detail when reached)

### N2: chosen people get alerts + Lab Records
Decided by the owner on 2026-10-11 (v0.7.0 ships owners-only first and is tested on phones; then this):
- **Not all staff, only people the owner picks**, e.g. a manager. Manage users → edit user gets a tick box per
  module: "Gets Floor Stock alerts" (later "Gets Lab Records alerts", …). The owner can tick or untick anyone at any
  time; every change is in the audit log.
- **Database:** one small platform table, alert recipients (`tenant_id`, `user_id`, `module_id`, who ticked it,
  when), FORCE RLS like every plant table. A schema change: confirm the migration with the owner before running.
- **Recipients** = the plant's owners (**always**; they can't be unticked, a per-event mute comes in N4) + the
  ticked people. The platform checks each ticked person at send time: active, of that plant, and allowed to work
  in that module (`roleWorksIn`; a ticked lab technician gets no Floor Stock alerts). Whoever did the action is
  still left out. Modules don't change: they keep calling `kit.notify`.
- A ticked person gets **the same events as the owner** for that module. For Floor Stock: saved / corrected, low
  stock, check the count, not done at 8 pm, and setup changes at bell level.
- **`/notifications` page** for every user (list + turn-on card), and a 🔔 link in each module's header (module-kit),
  because ticked staff with one module skip the launcher.
- Possible extra: "Seen by …" under each notification for the owner (the read marks are already stored).
- **Lab Records** (who gets which event is planned with the tick box, e.g. ON HOLD to owners + ticked lab leads):
  - **test failed → batch ON HOLD** (owner + lab leads; urgent; the main alert until WhatsApp is approved)
  - hold older than 24 h
  - batch waiting for approval
  - approved / rejected (to the technician who entered it)
  - result corrected (owner)
  - Form 1 due
  - no tests entered today

### N3: Document Store + platform events
- **Document Store:**
  - expiry at 30 / 7 / 1 days before, on expiry, then weekly (owner + responsible person; same schedule as the
    email)
  - "you are now responsible for …"
  - renewed / uploaded
  - storage near the plan limit
- **Platform**, written straight into the inbox:
  - staff locked out after 5 wrong PINs (owner, with an unlock link)
  - PlantOps support viewed your data
  - module switched on / plan changed
  - plan renewal coming up

### N4: settings and reliability
- On / off per event type per user. Urgent events (Lab Records ON HOLD) can't be turned off.
- The evening reminder time set per plant.
- A retry outbox in module-kit, so a notification isn't lost when the platform is briefly down.
- Notifications older than 90 days removed. This needs a DELETE grant (a permission change): ask first.

### N5+: inside each new module phase
- **Preventive Management:** task due / overdue, done, breakdown reported.
- **AMC:** contract expiring, visit due / done, invoice due.
- **Attendance & Salary:** not checked in, leave request, salary ready.
- **Marketing Contacts:** follow-up due.

---

## Build prompts (paste one into a new Claude Code session)

### N1
```
Build notifications phase N1 as described in docs/notifications.md (N1 section and the review findings) and in the
CLAUDE.md "Notifications" roadmap. The owner approved the design on 2026-10-11.

Already started (check and adjust, don't redo): apps/platform/db/migrations/0009_notifications.sql and the
notifications / pushSubscriptions tables in apps/platform/src/server/db/schema.ts. Apply review findings 1-3
(unique per plant for phones, module in the dedupe key, `level` column) and confirm the migration with me before
running it.

Build:
1. Platform:
   - module endpoint, inbox routes, /api/push, push.ts (web-push, quietly off without VAPID_*), `pnpm push:keys`
   - manifest.ts, public/sw.js, icons
   - bell + list + "Turn on phone notifications" card on the launcher for owners; logout unsubscribes the phone
2. Shared: NotificationInput (packages/types), sendNotification (packages/auth), kit.notify (packages/module-kit,
   never throws).
3. Floor Stock events 1-6, with the evening job and .github/workflows/evening.yml.
4. Every test listed in docs/notifications.md; then pnpm test, typecheck and build.
5. Migrate the dev and test databases; check on pnpm dev with desktop Chrome on localhost.
6. Update CLAUDE.md (kit.notify in "Every module app must", a dated N1 status note), HANDBOOK (VAPID keys, iPhone
   hint, privacy answer), apps/floor-stock/NOTES.md, CHANGELOG and the deploy checklist (VAPID per copy). Prepare
   v0.7.0 but ask me before pushing to production.

Keep changes small and explain each in plain language. Ask before any other schema, permission or token change.
```

### N2
```
Start notifications phase N2 (docs/notifications.md, CLAUDE.md "Notifications"). First check that the N1 status
note exists in CLAUDE.md; if it doesn't, stop and tell me.

Start in plan mode: read the N1 code, then propose a detailed plan for (decisions in docs/notifications.md N2):
1. Chosen recipients: a tick box per module on Manage users → edit user ("Gets <module> alerts"), owner-only,
   audited; a small platform table for it (show me the migration first). Recipients = owners (always) + ticked
   people who are active and work in that module (roleWorksIn), minus whoever did it. Modules keep calling
   kit.notify unchanged.
2. A /notifications page on the platform for every user (list + turn-on card) and a 🔔 link in each module's header
   via module-kit.
3. The Lab Records events listed in docs/notifications.md, fitted into the existing daily job and the WhatsApp
   outbox flow; propose who gets each.
List any schema or permission change and wait for my approval. Tests: only owners + ticked people receive, an
unticked or disabled person gets nothing, a ticked person never gets another module's or plant's notifications, the event texts, support sessions never trigger notifications. Finish
with a dated N2 status note and an update to docs/notifications.md.
```

### N3
```
Start notifications phase N3 (docs/notifications.md, CLAUDE.md "Notifications"). First check that the N2 status
note exists; if it doesn't, stop and tell me.

Start in plan mode and propose a plan for:
1. Document Store events (expiry stages reusing the existing email reminder rules, responsible person, renewed /
   uploaded, storage near the limit).
2. Platform events written straight into the inbox (lockout with an unlock link, support viewed, module / plan
   changed, renewal coming up via a daily job).
List any schema or permission change and wait for my approval. Tests for each event, isolation and dedupe. Finish
with a dated N3 status note and an update to docs/notifications.md.
```

### N4
```
Start notifications phase N4 (docs/notifications.md, CLAUDE.md "Notifications"). First check that the N3 status
note exists; if it doesn't, stop and tell me.

Start in plan mode and propose a plan for:
1. On / off per event type per user (settings on the /notifications page); the bell and push both respect it;
   urgent events can't be turned off.
2. The Floor Stock evening reminder time set per plant by the owner.
3. A retry outbox in packages/module-kit (stored in the module's own table, retried by the daily / evening jobs;
   dedupe keys make retries safe).
4. Removing notifications older than 90 days (a DELETE grant is a permission change: explain the options and wait
   for my approval).
Tests for each part. Finish with a dated N4 status note and an update to docs/notifications.md.
```

### N5+ (add to each new module's phase prompt)
```
This module must send notifications from day one (docs/notifications.md N5+). In the plan for this phase, list the
module's events, who receives each (owners / module staff / one user), the text, the link, the dedupe key, the level
(phone + bell or bell only), and whether it comes from an action or a scheduled job. Use kit.notify, with tests for
each event.
```
