# Attendance & Salary: module notes

Version 1 is attendance only (no salary). Design, phases and build prompts: `docs/ATTENDANCE_PHASE_PLAN.md`.
Released as **v0.18.0** (2026-10-15).

## At a glance
| | |
|---|---|
| Module id / role | `attendance_salary` / **Plant staff** (`plant_staff`; works only here, `PLANT_STAFF_MODULES`) |
| App / port | `apps/attendance-salary`, `:3006`; live `https://attendance.bluemins.life` (service `attendance-salary`, no volume) |
| Database | schema `attendance_salary`, login `attendance_app` (no BYPASSRLS, not the owner); 6 tables, FORCE RLS, no DELETE |
| Env | `ATTEND_DATABASE_URL_APP`, `ATTEND_SESSION_SECRET` (also makes the QR key), `MODULE_URL_ATTENDANCE_SALARY`, `MODULE_SECRET_ATTENDANCE_SALARY`, `PLATFORM_URL`, `CRON_SECRET` |
| Jobs | `POST /api/cron/daily` (07:00 IST, `daily.yml` step "Attendance", GitHub variable `ATTENDANCE_URL`): outbox, then "didn't mark OUT yesterday" |
| Notifications | `corrected` (worker only, phone + bell), `outside` (owners, bell), `no_exit` (owners, bell); owner-only module (`OWNER_ONLY_ALERTS`) |

## Who may do what (`src/server/access.ts`, the one table)
| Action | Owner | Owner + Plant staff | Plant staff | PlantOps support |
|---|---|---|---|---|
| Mark IN / OUT (QR) | – | ✔ | ✔ | – |
| Own calendar and days | – | ✔ (`/my`) | ✔ (home) | – |
| Everyone: Today, staff, person pages | ✔ | ✔ | – (404) | read-only |
| Fix (add a time / cancel a mark) | ✔ | ✔ | – | – |
| Settings (location, circle, QR) | ✔ | ✔ | – | read-only |
| Month CSV | ✔ | ✔ | – | – |
| Recent changes | ✔ | ✔ | – | read-only |
| Support access page | ✔ | ✔ | – | – |

Anyone else (e.g. a store keeper only) is refused by the module's own server.

## The rules (owner, Phase 0, 2026-10-15)
- Circle 200 m by default (50–2,000 m); accuracy worse than **500 m** refused; a second tap within **2 minutes**
  refused; an IN with no OUT for **16 hours** = "no exit" (until then the person is "inside"); time and IN / OUT are
  the server's; only distance and accuracy are stored, never a scan's coordinates.
- A block belongs to the India date it started (night shifts stay on the first day); nothing worked out is stored.
- The QR key is never stored: HMAC of `ATTEND_SESSION_SECRET` + plant + the QR's date; the database keeps its hash.
  Reprint any time; "Make a new QR" stops old prints. **Changing `ATTEND_SESSION_SECRET` stops every printed QR.**
- Workers' launcher tiles carry no badge (the platform's tile request names no person; owner, 2026-10-15).

## Not in version 1
Salary, overtime, shifts and late marks, leave and holidays, weekly offs; a worker asking for a correction; a
supervisor role; marking for another person; a gate tablet; a selfie at the scan; Hindi / Odia labels; reports
beyond the month CSV.

## Open items
- Not yet tried on real phones (location needs https): Android, iPhone (Camera app → Safari), Google Lens.
- First real use at plant 001: switch on, give every employee Plant staff (which also shows them the Order Capture
  view without amounts), set the location, print the QR (docs/HANDBOOK.md "Attendance: QR and location").

# Build notes, phase by phase

## 2026-10-15: Phase 1 (platform changes)
- `packages/types`: three kinds (`attendance_salary.corrected` to the worker, `outside` and `no_exit` to owners, bell
  only; none urgent) and `OWNER_ONLY_ALERTS = ["attendance_salary"]`. New kind flag `aboutYou`: in an owner-only
  module a non-owner sees only those kinds in their notification settings.
- Platform: no "Gets alerts" tick box for Attendance (form, owner / super_admin API: 400 "Only owners get Attendance
  alerts"); `notifyPlant` ignores ticks for it (`also_user_ids` + `only_listed` still reach the worker); no 🔔 for
  staff on the Permissions screen; the launcher's "turn on" card ignores such ticks; `alertChoices` moved to
  `src/lib/permissions.ts`. Tile: "Mark attendance", owner link "⚙ Location & QR" → `/settings`.
- `apps/dev-module`: `attendance_salary` is a real app now.
- Tests: platform 312 (+13, `test/attendance.test.ts`). Checked on `pnpm dev` with plant 002 and temporary users
  (settings list, tick refused, Permissions grid), then removed.

## 2026-10-15: Phase 2 (module foundation)
- Migration `0001_attendance.sql`: `plant_settings`, `punches`, `punch_cancels`, `support_views`, `audit_log`,
  `notification_outbox`; `tenant_id` + FORCE RLS on all; no DELETE anywhere; UPDATE only on the settings columns and
  the outbox retry columns. A scan stores distance and accuracy, never coordinates. `outbox_tenants()`,
  `attendance_tenants()` (plants with a mark in the last 3 days). Additions approved with the migration:
  `plant_settings.updated_by_name`, the two-column key from cancels to marks, upper bounds on distance / accuracy.
- App on `createModule()`: login callback, support view (read-only, page views logged, `/support-access`), logout,
  plant logo, proxy, header with 🔔 and Account, plant colour, `/health`, summary endpoint with no badges yet.
  Home page is an empty frame (Today for the owner, My attendance for a worker).
- **One access table** `src/server/access.ts`: owner / owner + Plant staff / worker (Plant staff) / support; a store
  keeper only has no rights (login refused). An owner without Plant staff doesn't mark.

## 2026-10-15: Phase 3 (settings, QR and marking)
- **QR key (owner's answer, 2026-10-15):** the server draws the QR whenever the owner prints it. The key is never
  stored: key = HMAC-SHA256(`ATTEND_SESSION_SECRET`, plant id + the QR's "made at" time); the database keeps only its
  hash and the date. Reprint any time; "Make a new QR" changes the date, so every old print stops and the new one
  must be put up again at the scan spot. **Changing `ATTEND_SESSION_SECRET` changes the QR too: reprint after it.**
  The QR link uses `MODULE_URL_ATTENDANCE_SALARY` (the public address).
- `/settings` (owner; support read-only): point by "Use my current location" or a pasted `lat, lng` / Google Maps
  link, circle 50-2,000 m, Print QR (`/settings/print`, A4, `qrcode` package, SVG), Make a new QR with a
  confirmation. Audited: `settings.location`, `settings.radius`, `qr.new` (date only).
- `/scan?k=…` + `POST /api/punch`: plant and person from the session, the database clock, IN / OUT from the last
  valid mark (16 h rule), refusals as planned (key, no point set, no location, accuracy > 500 m, double tap < 2 min,
  changed = 409, outside the circle), one mark at a time per person (advisory lock). Only distance and accuracy are
  stored. The support log records `/scan` without the key. Phones only give a location on https (or localhost), so
  real phone tests need the live copy.
- Made while building: the double-tap check comes before the "changed" (409) check, so a second tap says "Already
  marked at 9:02"; a refusal for distance is 403 with code `outside` (the Phase 6 bell hooks in there).
- Tests: Attendance 95 (+46). Checked on `pnpm dev` (plant 002, temporary owner + worker, Chrome at 390 px with a
  faked location: 1.4 km refused, 40 m saved; Settings and Print pages); all test data removed afterwards.

## 2026-10-15: Phase 4 (worker calendar)
- `src/lib/sessions.ts` `workDays()`: one pure function from marks + cancels to days (blocks, total, flags, the day
  page's list). Rules as planned: cancelled marks left out (listed crossed out); IN + OUT within 16 h = a block on
  the India date it started (night shifts stay on the first day); IN IN, an OUT 16 h+ later, or no OUT after 16 h =
  "no exit" (0 h); an IN under 16 h old = "in now"; OUT without IN = "no entry" (not counted); "changed" = an owner
  mark or cancel that day. Nothing stored. `src/lib/days.ts` for India dates.
- `src/server/calendar.ts` `monthFor` / `dayFor`: loads 2 days either side so edge-crossing shifts pair; the access
  rule in one place (own = `see_own`, anyone else = `see_everyone`, otherwise 404). Future or bad dates / months: 404.
- Screens: worker home = today line + month calendar (arrows, no future) + key + "Get alerts on this phone";
  `/day/<date>` = 24-hour bar + list ("added by owner: …", cancelled crossed out); `/my` = the same calendar for an
  owner who is also Plant staff. Components `calendar.tsx` and `day-view.tsx` are shared for Phase 5.
- Made while building: future dates are 404 rather than an empty page (the calendar doesn't link them).
- Tests: Attendance 114 (+19). Checked at 390 px on `pnpm dev` with sample marks for a temporary worker in plant 002
  (month, a two-block day with an owner fix and a cancel, a night shift); all removed afterwards.

## 2026-10-15: Phase 5 (owner views and fixes)
- People = the plant's **active** Plant staff from the platform (`kit.contacts`; owners without Plant staff are left
  out). Someone who left drops off Today but keeps their history: `/staff` lists them under "No longer Plant staff"
  from the names on their marks, and the CSV includes them for months they worked. Platform unreachable: Today says
  so and shows the people who marked recently. A person who is neither on the list nor has marks here: 404.
- Owner home = **Today** (`src/server/today.ts`): inside now, came and left, not marked today, no exit yesterday
  (an IN under 16 h is inside, not no exit). Tabs Today · Staff · Recent changes · Settings; CSV month picker.
- `/staff`, `/staff/<user>` (month), `/staff/<user>/<date>` (day + **Fix**: cancel a mark, add an IN / OUT on that
  day or the next morning). `src/server/fixes.ts`: owner only, reason 3-300 characters, never in the future, cancel
  once per mark (409 "Already cancelled by …"), **day stamp** = marks + cancels around the day and the newest time;
  a scan or another fix after the page loaded → 409 "Just changed by …" and the page reloads. Same per-person lock
  as marking. Audited `fix.add` / `fix.cancel`. The worker notification is a no-op hook for Phase 6.
- Month CSV `GET /api/export?month=` (owner, audited `export.csv`, neutralised): one row per person per day; columns
  Name, Date, First IN, Last OUT, Worked, Worked minutes, Blocks, No exit, No entry, Changed.
- `/changes` (owner + support): settings, new QR, fixes and CSV downloads in plain words.
- Tests: Attendance 134 (+20). Tests use a closed local port as the platform by default (an unreachable platform
  fails at once); files that need people start the fake platform. Checked at 390 px on `pnpm dev` (plant 002,
  temporary owner + 3 workers): Today, Staff, a no-exit day fixed through the screen, Recent changes, CSV download
  (94 lines = 3 people x 31 days); all removed afterwards.

## 2026-10-15: Phase 6 (notifications, tile and support view)
- `src/server/notify.ts`, as the plan's table, sent with `kit.notify` after the answer (`after()`):
  1. `corrected` (phone + bell): the worker only (`also_user_ids` + `only_listed`, the fixer excluded), dedupe
     `corrected:<mark or cancel id>`; nothing when an owner who is also Plant staff fixes their own marks.
  2. `outside` (bell): owners, "Ramu tried to mark IN from 1.4 km away" / "15 Oct, 23:19", dedupe
     `outside:<user>:<date>`; distance only, never a location.
  3. `no_exit` (bell): owners, "1 person / N people didn't mark OUT on 14 Oct" / names, dedupe `no_exit:<date>`, from
     the morning job.
- `src/server/outbox.ts` (as Order Capture) wired into `createModule`; `POST /api/cron/daily` (`CRON_SECRET`):
  outbox retry, then the no-exit check for each plant with recent marks. `.github/workflows/daily.yml`: Attendance
  step, skipped until `ATTENDANCE_URL`.
- Tile (`src/server/summary.ts`): owner "N in now" / "N not marked today" (from 11:00 IST) / "N no exit", "All in
  order" when nothing, **"Set location & QR"** while not set up (added). **Workers' tiles: no badge** (owner,
  2026-10-15): the platform's tile request names no person; workers see their state inside the app.
- Support: `attendance_salary` in the platform's `SUPPORT_READY` (super_admin dashboard). Read-only and page-view
  logging were already there; the support log now names "the staff list". (No platform test covers that list: it is
  a constant in the dashboard page.)
- Tests: Attendance 151 (+17), platform 312. Checked on `pnpm dev` (plant 002, temporary owner + 2 workers): Sujata
  got the "outside" and "no exit" bells, the worker got "corrected", nobody else; the tile went from "Set location &
  QR" to "1 in now · 1 not marked today · 1 no exit". All test bells (2 in Sujata's inbox), users and data removed.
