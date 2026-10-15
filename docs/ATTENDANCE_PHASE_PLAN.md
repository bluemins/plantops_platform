# Attendance (Attendance & Salary, version 1): Phase Plan and Build Prompts

**Status:** Design agreed with the owner on 2026-10-15:
- printed QR + location check
- one QR, the app decides IN / OUT
- only the owner fixes, with a reason
- everyone with Plant staff is tracked
- "like any other app": staff and owner have different views

It is to be built **before Phase 6 (Preventive Management)**, after v0.17.0 (Plant staff = employee) is deployed.
Salary is **not** in this version.

Each migration is still shown to the owner before it runs (CLAUDE.md working rules). The decisions marked
*(confirmed)* were made while planning and confirmed by the owner in Phase 0 (2026-10-15).

## Purpose
Today the plant has no record of when staff come and go. In this app a worker scans a QR code on the plant wall with
their phone to mark **IN** and **OUT**. Each worker sees their own calendar, and the owner sees everyone. This record
is the base for overtime and salary later.

## Names used in this plan
| Thing | Value |
|---|---|
| Module id | `attendance_salary` (label "Attendance & Salary"; already in `platform.modules` since migration 0001) |
| Role | **none new**: `plant_staff` already works only here (`PLANT_STAFF_MODULES`, v0.17.0) |
| App folder / local port | `apps/attendance-salary` on `:3006` |
| Database schema / login | `attendance_salary` / `attendance_app` |
| `.env` prefix for the setup scripts | `ATTEND` |
| Live address | `attendance.bluemins.life` |
| GitHub variable | `ATTENDANCE_URL` |
| Plan limit | none in v1 (no files) |
| Release | v0.18.0 |

## Agreed design (owner, 2026-10-15)

### Who uses it
| Person | Can do |
|---|---|
| **Plant staff** (an employee) | Scan the QR to mark IN / OUT; see **only their own** calendar and day details. Never anyone else's |
| **Owner** (`tenant_admin`) | See everyone: Today board, each person's calendar; fix times (with a reason); settings (plant location, circle size, print QR, new QR); month CSV; Recent changes. An owner marks IN / OUT only if they **also** hold Plant staff |
| **PlantOps support** (super_admin) | Read-only view; every page view logged on the owner's "Support access" page |
| Anyone else (e.g. Store keeper only) | Nothing: refused by the module's own server |

It works like every other PlantOps app: one tile, one address, and the views differ by role, checked on the server.
- A user whose only module is Attendance lands straight in it.
- A Plant staff worker in a plant that also has Order Capture (view only) sees the tile screen.
- Because everyone tracked holds Plant staff, every employee without the Order desk role also gets the Order Capture
  view (orders, customer, phone, quantities; never amounts). Kept as decided on 2026-10-14 (owner, Phase 0,
  2026-10-15). A Store keeper + Plant staff now sees the tile screen instead of landing in Floor Stock.

### How a worker marks attendance
1. **The QR** on the wall holds `https://attendance.bluemins.life/scan?k=<plant key>`.
   - The key is random per plant (32 bytes); only its hash is stored.
   - "Make a new QR" (owner) replaces it, and old prints stop working at once.
   - You can stick copies in several places (gate, godown). All of them work.
2. The phone camera opens the link. Without a session, the normal `/sso/start` login runs (plant code + PIN) and
   returns to `/scan`. A key from another plant, an old key or no key is refused: "This QR is not for your plant /
   is old, ask the owner for the new one".
3. The screen shows the name and the state: **"You are OUT"** → big **Mark IN**, or **"IN since 9:02"** → big
   **Mark OUT**. Nothing is saved until the button is tapped, so an accidental scan does nothing.
4. The tap asks the phone for its location (the browser's location permission). **The server** works out the
   distance to the plant's point:
   | Case | Answer |
   |---|---|
   | Inside the circle | Saved: "IN at 9:02 ✔" |
   | Outside the circle | Refused: "You are 1.4 km from the plant. Mark IN at the plant." The owner gets a bell (see Notifications) |
   | Location blocked / phone can't find it | Refused, with steps to allow location (Android Chrome / iPhone Safari) |
   | GPS accuracy worse than 500 m *(confirmed)* | Refused: "Location too rough, step outside and try again" |
   | Owner hasn't set the plant location yet | Refused: "The owner hasn't set the plant location yet" |
   | Second tap within 2 minutes *(confirmed)* | Refused: "Already marked at 9:02" |
5. **The time is the server's**, never the phone's.
6. IN or OUT is decided by the server: OUT if the person's last valid mark is an IN less than **16 hours** ago
   *(confirmed)*, otherwise IN. The screen shows what the server will do; if it changed in between, the answer says
   so (409).
7. **Only the distance and the accuracy are stored, not the coordinates** (less personal data).

**Honest limits** (tell the owner, don't oversell):
- Indoor GPS can be off by 20–50 m, so the circle is 200 m by default. It stops marking from home or the market, but
  not from the road outside the gate.
- A fake-GPS app on Android can fool any browser check. The owner's Today board and the "outside" bells are the
  safety net.

### Plant location (owner, once)
- **Settings → Plant location:** "Use my current location" while standing at the plant, or paste `lat, lng` copied
  from Google Maps.
- **Circle size:** 200 m by default, 50–2,000 m. Make it bigger for a large plant or a godown across the road.
- Moving a QR sticker needs no change. Set the location again only if the plant itself moves.
- **Print QR** page (A4): plant name, the QR, "Scan to mark IN / OUT", short steps. The QR image is made on the
  server (npm `qrcode`, SVG).
- Every change is audited and shown in Recent changes.

### Worker: My attendance
- **Month calendar** (this month by default; arrows for earlier months). Each day shows the time worked (e.g.
  "8h 40m"). Amber **"no exit"** when an IN has no OUT. A small **"changed"** mark when the owner added or
  cancelled a time.
- **Tap a day:**
  - a **24-hour bar** with the worked blocks
  - the list of every **start → end** (several per day), each marked "scan" or "added by owner: <reason>"
  - cancelled scans crossed out, with the owner's reason
- **Rules for working it out** (worked out when the page opens, never stored):
  - The valid marks are sorted by time; each IN followed by an OUT is one block.
  - A block belongs to the **day it started** (India time), so a night shift past midnight stays one block.
  - An IN followed by another IN (or no OUT within 16 h) = "no exit": the block counts 0 hours until the owner
    fixes it. An IN under 16 h old with no OUT yet is still **open** ("inside"), not "no exit" (Phase 0), so a
    night shift that started at 22:00 is not flagged at 07:00.
- **"Get alerts on this phone"** link on the worker's page → the platform's `/notifications` (the worker gets the
  "corrected" notification, but skips the launcher and its turn-on card).
  - An OUT without an IN before it = "no entry", shown and not counted.
  - Day total = the sum of the complete blocks that started that day.

### Owner views
- **Today** (home for the owner):
  - **Inside now** (name, since when)
  - **Came and left** (first IN, last OUT, hours)
  - **Not marked today**
  - **No exit yesterday** (an IN that started yesterday and is now "no exit" by the rule above; one still under
    16 h shows in Inside now)
  - The list of people is the plant's **active Plant staff** from the platform (`alert-contacts`). Someone who has
    left (disabled) drops off Today but keeps their history; each mark stores a copy of the person's name.
- **Staff → person:** the same month calendar and day view as the worker sees, plus **Fix** on a day:
  - **Add a time:** IN or OUT, date and time, **reason required** (≥ 3 characters). Not in the future.
  - **Cancel a mark:** **reason required**. The mark stays on record, crossed out.
  - There is no "edit". A fix = a new owner mark and / or a cancel. Both are append-only.
  - A fix on a day someone else just fixed answers 409 "just changed by …".
- **Month CSV** (owner, audited, formulas neutralised): one row per person per day with name, date, first IN, last
  OUT, worked time, number of blocks, and the flags no exit / no entry / changed.
- **Recent changes:** settings, new QR, fixes, CSV exports.

### Notifications (N5+, from day one)
All go through `kit.notify(tenantId, input)` **after** the answer, never blocking the scan. Nobody is notified of
their own action. **Attendance alerts about other people go to owners only**, because a ticked worker must never
see a colleague's attendance (platform change in Phase 1: `OWNER_ONLY_ALERTS`). None is urgent; each person can
mute or downgrade them on `/notifications`.

| # | Kind | Event | Who | Example title / body | Link | Dedupe key | Level |
|---|---|---|---|---|---|---|---|
| 1 | `attendance_salary.corrected` | Owner adds or cancels a mark | **The worker only** (`also_user_ids` + `only_listed`) | "Your attendance on 14 Oct was changed" / "Added OUT 18:30: forgot to scan" | `/day/<date>` | `corrected:<punch or cancel id>` | Phone + bell |
| 2 | `attendance_salary.outside` | A mark refused for distance | Owners | "Ramu tried to mark IN from 1.4 km away" / "14 Oct, 09:05" | `/staff/<user>/<date>` | `outside:<user>:<date>` (once per person per day) | Bell only |
| 3 | `attendance_salary.no_exit` | Daily job (07:00 IST): people with no exit yesterday | Owners | "2 people didn't mark OUT on 14 Oct" / "Ramu, Bindu" | `/?day=<date>` | `no_exit:<date>` (once per plant per day) | Bell only |

Reliability: `notification_outbox` + `outbox_tenants()`; `kit.retryOutbox()` at the start of the daily job.

### Standard pieces (as in every PlantOps module)
- **Launcher tile** (`/api/plantops/summary`):
  - owner: "N in now" (info), "N not marked today" (warn, after 11:00), "N no exit" (warn)
  - worker: "IN since 9:02" / "Not marked today"
  - Max 3 badges. The owner's setup link "⚙ Location & QR" goes to `/settings`.
- **Support view** (`/sso/support`): read-only (proxy + server guards); every page view is logged on the owner's
  `/support-access` page.
- **Daily job** `POST /api/cron/daily` (`CRON_SECRET`): outbox retry, then the no-exit notification.
- 🔔 and "Account" in the header, the plant colour and logo, English labels.
- No files, so no volume and no file backup; the nightly database dump covers the schema.

### Not in version 1
- **Salary**, overtime, shifts and late marks, leave and holidays, weekly offs.
- A worker asking for a correction (the owner fixes only).
- A supervisor role that sees everyone; marking for another person; a gate tablet or changing QR; a selfie at the scan.
- Hindi / Odia labels; reports beyond the month CSV.

## Database (agreed in principle; each migration shown to the owner before it runs)

**Platform: no migration.** The module row exists (0001) and `plant_staff` already works only here.

Code changes:
- `packages/types`:
  - three `NOTIFICATION_KINDS` (`outside` and `no_exit` bellOnly; none urgent)
  - **`OWNER_ONLY_ALERTS = ["attendance_salary"]`**: no "Gets alerts" tick box for this module, and `notifyPlant`
    ignores ticks for it. `also_user_ids` + `only_listed` still reach the worker.
- `apps/platform/src/lib/modules.ts`:
  - tile text "Mark attendance"
  - setup link "⚙ Location & QR" → `/settings`
- `apps/dev-module`: `attendance_salary` added to `REAL_APPS`.
- `SUPPORT_READY` on the super_admin dashboard (Phase 6).
- The Permissions screen shows no 🔔 for this module.
- **The SSO token is unchanged.**

**Module schema `attendance_salary`** (login `attendance_app`; every table has `tenant_id` + FORCE RLS; nothing has a
DELETE grant):

| Table | Holds | `attendance_app` may |
|---|---|---|
| `plant_settings` | one row per plant: lat, lng, radius_m (50–2,000), `qr_key_hash`, `qr_made_at`, updated_by / at | SELECT, INSERT, UPDATE (those columns only) |
| `punches` | user_id + name copy, kind `in` / `out`, `at`, source `scan` / `owner`, distance_m, accuracy_m (scan only), reason (required when source = owner), created_by + name, created_at | SELECT, INSERT |
| `punch_cancels` | punch_id (unique: once per mark), reason (required), by + name, at | SELECT, INSERT |
| `audit_log` | settings, new QR, fixes, CSV exports (Recent changes) | SELECT, INSERT |
| `support_views` | support page views | SELECT, INSERT |
| `notification_outbox` | notifications waiting to be resent | as in the other modules |

Plus `outbox_tenants()` and `attendance_tenants()` (plant ids only, for the daily job). Database checks:
- lat −90..90 and lng −180..180
- radius range
- kind and source values
- an owner mark needs a reason of ≥ 3 characters; a scan needs a distance
- the name copies are not empty

## Phases
Finish and test each phase before the next. Each phase ends with `pnpm test` for the touched apps, `typecheck`, and
a short dated note in `apps/attendance-salary/NOTES.md`.

| Phase | What | Result |
|---|---|---|
| **0** | Readiness | v0.17.0 committed and live; plan re-checked against the code; the *(confirmed)* items settled; optional phone mock-ups approved |
| **1** | Platform changes | Kinds, owner-only alerts, tile text / setup link, dev-module; tile says "Temporarily unavailable" until the app is registered |
| **2** | Module foundation | App on module-kit, own schema and login, access table, login / support / tile skeleton |
| **3** | Settings, QR and marking | Plant location, circle, print QR, new QR; the scan page with the location check |
| **4** | Worker calendar | Month calendar, day bar and list; the pairing rules |
| **5** | Owner views and fixes | Today board, person calendar, add / cancel with reason, month CSV, Recent changes |
| **6** | Notifications, tile and support view | Three kinds, outbox + daily job, badges, support logging |
| **7** | Release and deploy | Docs, Dockerfile, Railway service, DNS, live checks, the owner tries it at plant 001 |

### Phase 0: Readiness
- v0.17.0 (Plant staff = employee) committed, pushed and deployed. **Done** (checked 2026-10-15: `232f02c`, tag
  `v0.17.0`, `production` = `232f02c`).
- **Phase 0 result (2026-10-15):** the plan matches the code (`PLANT_STAFF_MODULES`, `roleWorksIn` / `viewOnlyIn`,
  alert-contacts returns active Plant staff here, `notifyPlant` with `only_listed` reaches the worker, module-kit,
  scripts, `daily.yml` at 07:00 IST). The owner confirmed the five items and chose: Order Capture view kept for all
  Plant staff; "no exit" only after 16 h; a "Get alerts on this phone" link for workers; mock-ups before Phase 3 if
  wanted.
- Re-read this plan against the code: `PLANT_STAFF_MODULES`, `roleWorksIn` / `viewOnlyIn`, `alert-contacts`
  (returns owners + active Plant staff for this module), `notifyPlant`, module-kit, `setup-module-db.sh`,
  `add-railway-module.sh`, `daily.yml`.
- The owner confirms the *(confirmed)* items: 500 m accuracy, 2-minute double tap, 16-hour rule, owner-only
  alerts, circle 200 m.
- Optional: phone mock-ups (scan screen, worker calendar, day view, owner Today, Fix, Settings / print QR) as an
  artifact, approved before Phase 3.
- Exit: the owner says "start".

### Phase 1: Platform changes
- `packages/types`: three kinds; `OWNER_ONLY_ALERTS`.
- Platform:
  - the user form doesn't offer "Gets Attendance alerts"
  - `notifyPlant` skips ticked people for owner-only modules
  - the Permissions screen shows no 🔔 there
  - tile text and setup link
- `apps/dev-module`: `attendance_salary` in `REAL_APPS`.
- Tests:
  - `roleWorksIn(plant_staff, attendance_salary)` is true and `store_keeper` is false
  - no tick box for Attendance; a ticked row (if one exists) receives nothing; `also_user_ids` + `only_listed` still
    reach the worker
  - a Plant-staff-only user lands in Attendance (and sees tiles when Order Capture is also on)
  - the settings page lists the kinds

### Phase 2: Module foundation
- `./scripts/setup-module-db.sh attendance_salary attendance_app ATTEND 3006` (dev + test).
- Migration `0001_attendance.sql` with the tables, grants, FORCE RLS, checks and functions above. Show it first.
- `apps/attendance-salary` (Next.js, `:3006`) on `createModule()`: callback, support, logout, logo, proxy, header
  with 🔔 and Account, plant colour; empty pages; summary endpoint with no badges; `/health`.
- **One access table** (mark, see own, see everyone, fix, settings, export, Recent changes), used by every route and
  page.
- Tests:
  - isolation and the FORCE RLS guard on every table
  - append-only refusals: UPDATE / DELETE on punches, cancels, audit; DELETE anywhere; UPDATE of settings columns
    outside the list
  - the access table per role: owner, plant staff, owner + plant staff, store keeper refused, support read-only
  - no session → login for pages, 401 for APIs

### Phase 3: Settings, QR and marking
- `/settings` (owner; support read-only): location (current location / pasted `lat, lng`), circle, Print QR page,
  Make a new QR (confirmation; old key stops); audited.
- `/scan?k=…`: key check, state, Mark IN / OUT button, location request (high accuracy, 15 s timeout).
- `POST /api/punch`:
  - plant and user taken from the session
  - kind worked out on the server (409 if it differs from what the screen showed)
  - haversine distance; the refusal rules in the table above; server time
  - the "outside" event noted for Phase 6
- The QR key: random, hash stored. It never goes in the audit log or URLs other than the print page.
- Tests:
  - distance boundaries (radius −1 m / +1 m), accuracy limit, no location, no settings
  - wrong-plant, old and missing keys
  - double tap within 2 minutes
  - non-Plant-staff refused (owner without Plant staff: "Owners don't mark attendance")
  - the browser's time, tenant and user ignored
  - the IN / OUT decision including the 16-hour rule
  - two taps at once give one mark
- Check the scan screen at 390 px in headless Chrome with a faked location.

### Phase 4: Worker calendar
- `src/lib/sessions.ts`: the pure pairing function (marks + cancels → blocks, flags, day totals, India dates).
- `/` (Plant staff): month calendar; `/day/<date>`: the 24-hour bar + list.
- Tests (pure + database):
  - simple day; two blocks; night shift past midnight; IN IN (no exit); OUT without IN
  - cancelled scan ignored; owner-added mark counted and labelled
  - month boundaries; India-time day edges
  - a worker can never load another person's day (404)
- Check at phone width.

### Phase 5: Owner views and fixes
- Owner home = **Today** board; `/staff`, `/staff/<user>` (calendar), `/staff/<user>/<date>` (day + **Fix**).
- `POST /api/fix/add` (IN / OUT, date-time not in the future, reason) and `POST /api/fix/cancel` (mark id, reason;
  once per mark). Both send the day's expected state and get 409 if it changed.
- `GET /api/export?month=YYYY-MM` (owner, audited, formulas neutralised); Recent changes (owner + support).
- Tests:
  - fixes owner-only; reasons required; future refused
  - a cancel can't be repeated; stale fix 409
  - Today groups (inside, came and left, not marked, no exit yesterday)
  - disabled worker keeps history
  - CSV columns, owner-only and neutralised; isolation
- Check the screens at phone width.

### Phase 6: Notifications, tile and support view
- `src/server/notify.ts` with the three events (table above), `src/server/outbox.ts` + `kit.retryOutbox()`.
- `POST /api/cron/daily`: outbox, then no-exit. Attendance step in `.github/workflows/daily.yml`, skipped until
  `ATTENDANCE_URL` (and added to its header comment).
- Summary badges for the owner and the worker.
- Support view: read-only in proxy and server guards; page views logged; `/support-access`; `attendance_salary` in
  `SUPPORT_READY`.
- Tests:
  - one per event: recipients, worker-only, owners-only, level, dedupe once per person / day and once per plant /
    day
  - outbox kept on 5xx, dropped on 4xx; wrong cron secret 401
  - badges for an empty and a mixed plant
  - every write refused for support; page views logged
- On `pnpm dev`, Sujata (plant 002) gets a "corrected" bell on a test worker and sees the tile numbers.

### Phase 7: Release and deploy
- NOTES.md, Dockerfile, CLAUDE.md status note (repo layout, public addresses, "Every module app must" list),
  HANDBOOK / DEPLOY, `setup-railway-db.sh` / `.sql`, `docs/deployments/shared.md`, v0.18.0.
- Live, one step at a time:
  - `./scripts/add-railway-module.sh shared attendance_salary attendance_app ATTEND 3006 attendance.bluemins.life`
  - Railway service (no volume), `CRON_SECRET`
  - DNS (`attendance` CNAME + `_railway-verify` TXT at WordPress.com)
  - GitHub variable `ATTENDANCE_URL`, deploy from `production`
  - only then `attendance_salary` in `backup.yml`'s "every schema has data" list
- Checks: `/health`, login redirect, 401s, tile ticket refused, wrong cron secret.
- Then the owner at plant 001:
  1. switch Attendance on
  2. stand in the plant → set the location
  3. print the QR and stick it up
  4. a Plant staff worker marks IN and OUT on an Android phone
  5. a mark from outside the circle is refused, and the owner gets the bell
  6. the owner fixes a forgotten OUT, and the worker gets the notification
  7. the month CSV
  8. iPhone if available

## Build prompts
Paste **one** phase prompt, as it is, into a new Claude Code session at `~/projects/plantops_platform`. Its first
line makes the session read the shared header below. Each starts in plan mode and waits for approval. Run them in
order.

### Shared header (each phase prompt's first line points here; no need to paste it)
```text
We are building the Attendance & Salary module of PlantOps, version 1 = attendance only (no salary). The agreed
design is docs/ATTENDANCE_PHASE_PLAN.md (owner agreed on 2026-10-15): read it fully, plus CLAUDE.md, before anything
else. Follow the module conventions of apps/order-capture (access table, 409 on stale changes, notifications,
outbox, support view, CSV) and apps/floor-stock (owner setup screens, Recent changes), all through
packages/module-kit. Apps import shared code only from packages/*.

Rules: start in plan mode and wait for my approval; show every migration before running it; ask before any change
to schema, permissions, tenant isolation or the SSO token that is not already in the plan; never trust tenant ids,
user ids, times or IN/OUT from the browser; enforce access on the server; a worker must never see another person's
attendance; store distance and accuracy, never coordinates of a scan; no secrets in code, docs or tests. Write tests
with the feature (real Postgres test database). Explain each change in plain language; I am not a full-time
developer. At the end of the phase run the tests of every touched app, typecheck and build, and add a short dated
note to apps/attendance-salary/NOTES.md (create it in phase 2). Don't commit until I say so.

Keep version 1 minimal: mark IN / OUT, calendars, owner fixes with a reason, month CSV. No salary, overtime,
shifts, leave or holidays. This module must send notifications from day one (docs/notifications.md N5+); the
events are listed in the plan.
```

### Phase 0 prompt
```text
Before anything else, read the "Shared header" in docs/ATTENDANCE_PHASE_PLAN.md (Build prompts section) and follow
it for this whole session.

Phase 0 only: check readiness, change nothing.
1. Tell me whether v0.17.0 (Plant staff = employee) is committed, pushed and live; if not, list what is left.
2. Re-check docs/ATTENDANCE_PHASE_PLAN.md against the current code: PLANT_STAFF_MODULES, roleWorksIn / viewOnlyIn,
   the alert-contacts endpoint (does it return the active Plant staff for attendance_salary?), notifyPlant and the
   "Gets alerts" tick boxes, module-kit (contacts cache, notify, retryOutbox), setup-module-db.sh,
   add-railway-module.sh, daily.yml. List anything that no longer matches and propose the edit.
3. List the "(to confirm)" items and ask me to confirm or change each.
4. Offer phone mock-ups (scan screen, worker calendar, day view, owner Today, Fix, Settings / print QR) as an
   artifact; make them if I say yes.
5. Ask me whether to start Phase 1.
```

### Phase 1 prompt
```text
Before anything else, read the "Shared header" in docs/ATTENDANCE_PHASE_PLAN.md (Build prompts section) and follow
it for this whole session.

Build Phase 1 (Platform changes) of docs/ATTENDANCE_PHASE_PLAN.md. No platform migration.
- packages/types: the three attendance_salary kinds in NOTIFICATION_KINDS (outside and no_exit bellOnly; none
  urgent); OWNER_ONLY_ALERTS = ["attendance_salary"]
- platform: no "Gets Attendance alerts" tick box (user form and API refuse it); notifyPlant ignores ticked people
  for owner-only modules but still delivers also_user_ids with only_listed; no 🔔 on the Permissions screen for it;
  tile text "Mark attendance" and setup link "⚙ Location & QR" → /settings in apps/platform/src/lib/modules.ts
- apps/dev-module: attendance_salary in REAL_APPS
Tests: roleWorksIn for plant_staff (yes) and store_keeper (no) here, the tick box absent and refused, a ticked row
gets nothing, also_user_ids + only_listed still delivered, a Plant-staff-only user lands in Attendance (tiles when
Order Capture is also on), the settings page lists the new kinds. Then verify on pnpm dev with plant 002.
```

### Phase 2 prompt
```text
Before anything else, read the "Shared header" in docs/ATTENDANCE_PHASE_PLAN.md (Build prompts section) and follow
it for this whole session.

Build Phase 2 (Module foundation) of docs/ATTENDANCE_PHASE_PLAN.md:
- ./scripts/setup-module-db.sh attendance_salary attendance_app ATTEND 3006 for dev and test
- apps/attendance-salary/db/migrations/0001_attendance.sql with every table, grant, FORCE RLS policy, check and
  function in the plan's Database section (show it first)
- the Next.js app on :3006 using createModule(): callback, support, logout, logo, proxy, header (🔔 + Account),
  plant colour, empty pages, empty summary endpoint, /health
- one access table in the server (mark, see own, see everyone, fix, settings, export, recent changes) used by every
  route and page
Tests: tenant isolation, FORCE RLS guard over every table, append-only refusals for attendance_app (list each
refused statement), access table per role (owner, plant staff, owner + plant staff, store keeper refused, support
read-only), no session → platform login for pages and 401 for APIs. Verify login through the platform on pnpm dev.
```

### Phase 3 prompt
```text
Before anything else, read the "Shared header" in docs/ATTENDANCE_PHASE_PLAN.md (Build prompts section) and follow
it for this whole session.

Build Phase 3 (Settings, QR and marking) of docs/ATTENDANCE_PHASE_PLAN.md:
- /settings (owner; support read-only): plant location by "Use my current location" or pasted "lat, lng"; circle
  50–2,000 m (default 200); Print QR page (A4, plant name, QR as SVG from the qrcode package, short steps); Make a
  new QR with a confirmation (random key, only its hash stored, old prints stop); all audited
- /scan?k=…: key check (wrong plant / old / missing refused with a plain message), the person's state, one big Mark
  IN or Mark OUT button, then the browser location (high accuracy, 15 s timeout)
- POST /api/punch: plant and user from the session; IN/OUT decided on the server (OUT if the last valid mark is an IN
  under 16 h old), 409 if it differs from the screen; server time; haversine distance; refusals exactly as the
  plan's table (outside circle, no location, accuracy worse than 500 m, no settings, second tap within 2 minutes,
  not Plant staff); store distance and accuracy only
Tests: radius −1 m / +1 m, accuracy limit, no location, no settings, wrong / old / missing key, double tap, two taps
at once give one mark, owner without Plant staff refused, browser time / tenant / user ignored, the 16-hour rule.
Check the scan screen at 390 px in headless Chrome with a faked location.
```

### Phase 4 prompt
```text
Before anything else, read the "Shared header" in docs/ATTENDANCE_PHASE_PLAN.md (Build prompts section) and follow
it for this whole session.

Build Phase 4 (Worker calendar) of docs/ATTENDANCE_PHASE_PLAN.md:
- src/lib/sessions.ts: one pure function turning marks + cancels into blocks, flags (no exit, no entry, changed)
  and day totals, using India dates; a block belongs to the day it started; no stored totals
- / for Plant staff: month calendar with time worked per day and the flags; month arrows
- /day/<date>: 24-hour bar with the blocks, the list of start → end with "scan" / "added by owner: <reason>",
  cancelled marks crossed out with the reason
Tests: simple day, two blocks, night shift past midnight, IN IN, OUT without IN, cancelled scan ignored, owner mark
counted and labelled, month and India-time day edges, a worker can't load anyone else's day (404). Check at phone
width in headless Chrome.
```

### Phase 5 prompt
```text
Before anything else, read the "Shared header" in docs/ATTENDANCE_PHASE_PLAN.md (Build prompts section) and follow
it for this whole session.

Build Phase 5 (Owner views and fixes) of docs/ATTENDANCE_PHASE_PLAN.md:
- owner home = Today board: inside now, came and left, not marked today, no exit yesterday; people = the plant's
  active Plant staff from the platform; a disabled worker keeps history
- /staff, /staff/<user> (month calendar), /staff/<user>/<date> (day view + Fix)
- Fix: add an IN or OUT (date-time not in the future, reason ≥ 3 chars) and cancel a mark (reason, once per mark);
  both append-only, both send the day's expected state and get 409 if it changed; audited
- month CSV (owner, audited, formulas neutralised): one row per person per day as the plan says; Recent changes
  (owner + support)
Tests: fixes owner-only, reasons required, future refused, cancel once, stale fix 409, Today groups, disabled
worker, CSV columns / owner-only / neutralised, isolation. Check the screens at phone width.
```

### Phase 6 prompt
```text
Before anything else, read the "Shared header" in docs/ATTENDANCE_PHASE_PLAN.md (Build prompts section) and follow
it for this whole session.

Build Phase 6 (Notifications, tile and support view) of docs/ATTENDANCE_PHASE_PLAN.md, using the notification table
in the plan exactly (kinds, recipients, texts, links, dedupe keys, levels):
- src/server/notify.ts called with kit.notify after the answer: corrected → the worker only (also_user_ids +
  only_listed); outside → owners, once per person per day; no_exit → owners, once per plant per day from the daily
  job
- src/server/outbox.ts + kit.retryOutbox(); POST /api/cron/daily (CRON_SECRET: outbox, then no_exit); Attendance
  step in .github/workflows/daily.yml skipped until ATTENDANCE_URL (also in its header comment)
- summary badges: owner "N in now", "N not marked today" (after 11:00), "N no exit"; worker "IN since …" / "Not
  marked today"
- support view: read-only in proxy and server guards, page views logged, /support-access, attendance_salary in
  SUPPORT_READY in apps/platform/src/app/super/dashboard/page.tsx
Tests: one per event (recipients, level, dedupe), outbox kept on 5xx and dropped on 4xx, wrong secret 401, badges
for an empty and a mixed plant, every write refused for support, page views logged. Verify on pnpm dev with plant
002 (Sujata gets the bells, the tile shows numbers).
```

### Phase 7 prompt
```text
Before anything else, read the "Shared header" in docs/ATTENDANCE_PHASE_PLAN.md (Build prompts section) and follow
it for this whole session.

Phase 7 (Release and deploy) of docs/ATTENDANCE_PHASE_PLAN.md:
- apps/attendance-salary/NOTES.md complete, Dockerfile, CLAUDE.md dated status note (repo layout, public addresses,
  "Every module app must" list), HANDBOOK and DEPLOY additions, setup-railway-db.sh / .sql, release v0.18.0
- give me the live steps one at a time and wait for me at each: ./scripts/add-railway-module.sh shared
  attendance_salary attendance_app ATTEND 3006 attendance.bluemins.life, Railway service (no volume), CRON_SECRET,
  DNS at WordPress.com, GitHub variable ATTENDANCE_URL, deploy from the production branch, and only then
  attendance_salary in backup.yml's "every schema has data" list
- live checks: /health, platform-login redirect, 401s, tile ticket refused without the platform, wrong cron secret
- then a checklist for me at plant 001: switch it on, set the location standing in the plant, print and stick the
  QR, a Plant staff worker marks IN and OUT on Android, a mark from outside is refused and I get the bell, I fix a
  forgotten OUT and the worker gets the notification, month CSV, iPhone if available
Record everything in docs/deployments/shared.md.
```
