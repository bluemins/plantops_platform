# Attendance & Salary: module notes

Version 1 (attendance) released as **v0.18.0** (2026-10-15): `docs/ATTENDANCE_PHASE_PLAN.md`. Version 2 (salary)
released as **v0.20.0** (2026-10-17): `docs/SALARY_PHASE_PLAN.md`. Version 3 (salary extras) Part A, per-day pay,
released as **v0.21.0** (2026-10-17), Part B, field duty and expense claims, as **v0.22.0** (2026-10-17):
`docs/SALARY_EXTRAS_PHASE_PLAN.md`. Claims only for field staff **v0.22.1** and Office staff / Supervisor / Permanent
or Temporary **v0.23.0** (2026-10-17): `docs/ATTENDANCE_ROLES_PHASE_PLAN.md`. Build notes per phase are further down.

## At a glance
| | |
|---|---|
| Module id / roles | `attendance_salary` / **Plant staff** (`plant_staff`, the employee: tracked and paid; works only here, `PLANT_STAFF_MODULES`), **Office staff** (`office_staff`) and **Supervisor** (`supervisor`) since v0.23.0 |
| App / port | `apps/attendance-salary`, `:3006`; live `https://attendance.bluemins.life` (service `attendance-salary`, volume at `/data` for bill photos since v0.22.0) |
| Database | schema `attendance_salary`, login `attendance_app` (no BYPASSRLS, not the owner); 14 tables, FORCE RLS, no DELETE anywhere; the eight salary and claim tables are SELECT + INSERT only |
| Migrations | `0001_attendance.sql` (v0.18.0), `0002_salary.sql` (v0.20.0), `0003_per_day_pay.sql` (v0.21.0, per-day pay), `0004_claims.sql` (v0.22.0, claims), `0005_field_staff.sql` (v0.22.1), `0006_desk_and_staff_type.sql` (v0.23.0) |
| Env | `ATTEND_DATABASE_URL_APP`, `ATTEND_SESSION_SECRET` (also makes the QR key), `MODULE_URL_ATTENDANCE_SALARY`, `MODULE_SECRET_ATTENDANCE_SALARY`, `PLATFORM_URL`, `CRON_SECRET`; bill photos: `ATTEND_STORAGE_DIR` (live `/data/attendance`, with `RAILWAY_RUN_UID=0`) or `ATTEND_STORAGE_BUCKET` + `STORAGE_*`; backup: the five `BACKUP_*` |
| Jobs | `POST /api/cron/daily` (07:00 IST, `daily.yml` step "Attendance", GitHub variable `ATTENDANCE_URL`): outbox, "didn't mark OUT yesterday", and on the month's last day the salary review; `POST /api/cron/backup` (02:00 IST, `backup.yml` step "Attendance files", on with GitHub variable `ATTENDANCE_BACKUP_FILES=on`): new bill photos, encrypted, to R2; `POST /api/cron/morning` (hourly 08:00-11:00 IST, `evening.yml` step "Attendance (not marked)", same `ATTENDANCE_URL`): outbox and the not-marked alert at each plant's hour |
| Notifications | `corrected` (worker only, phone + bell), `outside` (owners, bell), `no_exit` (owners, bell), `salary_review` (owners, last day, phone + bell), `salary_paid` (the worker only, only with "Can see own salary"), `claim_new` (owners), `claim_decided` (the worker only), `storage` (owners, 80 % / 95 %); v0.23.0: `advance_given` (owners, phone), `desk_fix` (owners, bell), `scan` (supervisors only, bell), `not_marked` (owners + supervisors, phone); owner-only module (`OWNER_ONLY_ALERTS`; supervisors reached through `also_user_ids`) |

## Who may do what (`src/server/access.ts`, the one table)
Since v0.23.0 a person is a set of **capacities** from their roles: owner (`tenant_admin`), employee (Plant staff),
office (Office staff), supervisor (Supervisor); support alone. Each column below is one capacity; someone with two
(e.g. Office staff + Plant staff) gets both columns.

| Action | Owner | Plant staff (employee) | Office staff | Supervisor | PlantOps support |
|---|---|---|---|---|---|
| Mark IN / OUT (QR) (`mark`) | – | ✔ | – | – | – |
| Own calendar and days, never money (`see_own`) | – | ✔ (home, or `/my`) | – | – | – |
| Today board (`see_today`) | ✔ | – | ✔ | ✔ read-only; only Office staff names open their day | read-only |
| Staff list, anyone's calendar and days (`see_everyone`) | ✔ | – (404) | ✔ | – | read-only |
| Office staff list + their calendars and days (`see_office_staff`, v0.26.1) | – | – | – | ✔ tracked Office staff only, not themselves | – |
| Mark for someone, office phone (`mark_for`) | – (use Fix) | – | ✔ not themselves | ✔ Office staff only (v0.26.1) | – |
| Fix (add a time / cancel a mark) (`fix`) | ✔ | – | ✔ not themselves | ✔ Office staff only (v0.26.1) | – |
| Give an advance (`advance_add`) | ✔ | – | ✔ not themselves, ≤ 7 days back, ≤ ₹1 lakh; correct own entry the same day | – | – |
| A person's advances + still to recover (`advance_view`) | ✔ | – | ✔ | – | read-only |
| Settings (location, circle, QR, not-marked hour) | ✔ | – | – (404) | – (404) | read-only |
| Month CSV, Recent changes, Support access page | ✔ | – | – | – | Recent changes read-only |
| Salary tab, salary sections (`salary_view`) | ✔ | – (404) | – (404) | – (404) | read-only |
| Salary settings, Can see own salary, advance corrections of any age (`salary_edit`) | ✔ | – | – (404) | – (404) | – |
| Mark paid / undo, salary CSV | ✔ | – | – (404) | – (404) | – |
| Own salary slips (`see_own_salary`) | – | ✔ | – (404) | – (404) | – |
| Send own claims, My claims (`claim_own`; Field staff only since v0.22.1) | – (owner + Plant staff: approved at once) | ✔ | – (404) | – (404) | – |
| Claims tab, anyone's claims and photos (`claim_view`) | ✔ | – (404) | – (404) | – (404) | read-only |
| Approve / not approve / cancel, enter for someone (`claim_decide`) | ✔ | – | – (404) | – (404) | – |

Own salary slips are shown **only** when the owner ticked "Can see own salary" for that person, **only** for months
ticked Paid (not undone), **only** their own, from the frozen figures. Every other case is 404 (never 403), so
nothing hints that a salary page exists. Anyone else (e.g. a store keeper only) is refused by the module's own server.

## Attendance rules (owner, 2026-10-15)
- Circle 200 m by default (50–2,000 m); accuracy worse than **500 m** refused; a second tap within **2 minutes**
  refused; an IN with no OUT for **16 hours** = "no exit" (until then the person is "inside"); time and IN / OUT are
  the server's; only distance and accuracy are stored, never a scan's coordinates.
- A block belongs to the India date it started (night shifts stay on the first day); nothing worked out is stored.
- The QR key is never stored: HMAC of `ATTEND_SESSION_SECRET` + plant + the QR's date; the database keeps its hash.
  Reprint any time; "Make a new QR" stops old prints. **Changing `ATTEND_SESSION_SECRET` stops every printed QR.**
- Workers' launcher tiles carry no badge (the platform's tile request names no person; owner, 2026-10-15).

## Salary rules (owner, 2026-10-16; all in `src/lib/salary.ts`, used by the server, the CSV and the checking panel)
Full text and numbering: `docs/SALARY_PHASE_PLAN.md` "The rules".
- **Counted days:** days of the month that are over, inside Joined on (blank = first salary month) and Last day.
- **Day status** by the person's shift hours S: present ≥ S, half day ≥ S ÷ 2, otherwise absent (a "no exit" day
  counts 0 until the owner fixes it). A night shift counts on the day it started.
- **Absent days** = absent + ½ × half days; **paid leave used** = min(absent days, the person's paid leave, default
  2); unused leave lapses; **unpaid days** = the rest.
- **Day's pay** = salary ÷ 30 (always 30). **Full month:** salary − unpaid days × day's pay. **Part month** (joined
  or left during it): day's pay × (present + ½ half + leave used), never more than the salary. Never below 0.
- **Overtime** only with "Gets overtime": exact minutes over S per day, × the person's rate per hour.
- **Remaining** = earned + overtime pay − advances (the month's entries, corrections negative) − carried in (last
  month's minus) ± adjustment from last month.
- **Which setting:** the latest "from month" on or before the month; same from month → the newest saved. A month with
  no setting = not on salary (listed under "No salary set").
- **A month not over yet** shows the full salary minus the absences so far ("So far · 16 of 31 days").
- **Per day (rule 15, v0.21.0; owner 2026-10-17):** a person can be paid a day rate instead (Pay: Per day). Earned =
  day rate × (present + ½ × half days), rounded once; absent days earn nothing; no paid leave (saved as 0); no full /
  part month difference. Overtime, advances, carry and paid months as for monthly people. Months frozen before
  v0.21.0 (`rules: 1`) read as monthly.
- **Claims (rules 16-19, v0.22.0):** only **approved** claims count, in the month of their date. TA = the month's
  approved field-duty km added up × the TA rate, rounded once; DA = dates with approved field duty × the DA rate (two
  on one date = one day); no rate = ₹0; expenses = the approved amounts; remaining adds TA + DA + expenses. A field-duty
  day never changes attendance. A claim approved or cancelled after the month was paid comes next month as the usual
  adjustment. Paid months freeze the counted claims (`RULES_VERSION` 3; earlier months read as no claims).
- **Money** in whole paise as plain numbers (≤ ₹1 crore); rounded to the paisa once each for day's pay, the
  deduction (unpaid days × day's pay as shown), earned and overtime pay; screens show the nearest rupee, the slip
  and the dialog the exact amount.
- **Paid months are frozen:** ticking Paid saves the whole calculation (`figures`, `RULES_VERSION` 1; 2 since v0.21.0). The slip, the
  Salary tab row and the carry use it. A later change shows as "Changed after payment: ₹X → <next month>" and goes to
  the next month once as "Adjustment from <month>" (also when that month is paid too, and after an undo). Paid from
  the month's last day; a negative month is paid as ₹0 and its minus carries.

## The salary tables (migration `0002_salary.sql`; append-only, `attendance_app` SELECT + INSERT only)
| Table | Holds |
|---|---|
| `salary_settings` | per person from a month: pay basis (monthly / per day, `0003`), salary or day rate, shift, paid leave (0 for per day), Gets overtime + rate, Joined on / Last day, reason for a past month |
| `salary_advances` | advances; a correction is a negative entry linked to an advance of the same person, on its date, with a reason |
| `salary_visibility` | "Can see own salary" on / off; the newest row wins, no row = off |
| `salary_payments` | a month ticked Paid: paid amount (remaining or 0), frozen remaining, frozen `figures`, paid on, note |
| `salary_payment_undos` | undoing a payment (once per payment, with a reason) |
| `salary_claims` | one claim (`0004`): field duty (km in tenths) or expense (paise), date, what for, who entered it; never changes |
| `salary_claim_decisions` | approved / not approved / withdrawn (once) and cancelled (once, only after approved); the status is the newest |
| `salary_claim_files` | bill photos of expenses (JPEG / PNG / WebP ≤ 10 MB, sha256, storage key); never replaced or deleted |

`salary_tenants()` (security definer, plant ids only) lists plants for the month-end review.

## Not in this version
Salary extras (v0.21.0 / v0.22.0): advance requests from workers; claims for another person by a worker; a mileage log
per vehicle or GPS distance; km rates per vehicle; PDF bills (photos only); partial approval; claims outside a salary
month; "approve all"; DA or TA as a fixed monthly amount; claims in Hindi / Odia. Salary (v0.20.0): weekly offs and
holidays; leave requests or leave types; printed / PDF payslips; partial payments during the month
(record them as advances); deductions other than advances (PF, ESI, TDS); salary in Hindi / Odia; a worker seeing an
unpaid month; "mark all as paid". From version 1 still: a worker asking for a correction; a gate tablet; a selfie at
the scan; reports beyond the two CSVs. Roles (v0.23.0): teams per supervisor; a supervisor fixing marks; Office staff
entering claims, paying salary or seeing salaries; phone-level scan alerts; weekly offs / leave in the not-marked
count; a separate kiosk login.

## Open items
- Not yet tried on real phones (location needs https): Android, iPhone (Camera app → Safari), Google Lens.
- Salary not yet used at plant 001: the owner's checklist is in `docs/deployments/shared.md` (v0.20.0 row) and
  `docs/HANDBOOK.md` "Attendance: salary at month end".

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

# Salary (version 2), phase by phase
Plan: `docs/SALARY_PHASE_PLAN.md`. To be released as v0.20.0.

## 2026-10-16: Salary Phase 1 (database, access, notification kinds)
- Migration `0002_salary.sql`: `salary_settings`, `salary_advances`, `salary_visibility`, `salary_payments`,
  `salary_payment_undos`; `tenant_id` + FORCE RLS on all; `attendance_app` SELECT + INSERT only (no UPDATE, no
  DELETE); `salary_tenants()` (plant ids only). Additions approved with the migration: a correction's link includes
  the person (the database refuses correcting someone else's advance), `paid_paise` = the remaining or 0, advances
  ≤ ₹1 crore, reasons ≤ 300, indexes on payments and visibility per person. Applied to dev (by the owner) and test.
- Access table: `salary_view` (owner, owner + Plant staff, support), `salary_edit` / `salary_pay` / `salary_export`
  (owner, owner + Plant staff), `see_own_salary` (Plant staff, owner + Plant staff; permission + paid month checked in
  the query later). Refused `see_own_salary` answers **404**, never 403, so nothing hints that a salary page exists.
- `packages/types`: `attendance_salary.salary_review` (owners, phone + bell) and `attendance_salary.salary_paid`
  (`aboutYou`). Every Plant staff person sees "Your salary is paid" in their notification settings even without
  "Can see own salary" (the platform can't know the tick); accepted with the plan, they never receive it without it.
- Tests: Attendance 186 (+35: 11-table guard, 108 refused statements incl. every salary column, salary database
  checks, access table), platform 312 (settings list the new kinds).

## 2026-10-16: Salary Phase 2 (the rules)
- `src/lib/salary.ts`, pure (browser-safe; only `days.ts`): paise helpers (`toPaise`, `rupeesText` to the nearest
  rupee, `paiseText` exact, `hoursText`), `settingFor` (latest from month on or before; same from month → newest
  saved), `countedDates` (rule 1: days that are over, inside Joined on / Last day; full vs part month),
  `dayStatuses` + `countDays` (rules 2, 3, 9), `monthPay` (rules 4-10, 12, 13), `carryChain` (rules 11, 14),
  `FrozenMonth` and `RULES_VERSION = 1` for Phase 5.
- Money as plain whole paise (numbers, not BigInt: ≤ ₹1 crore is exact, and plain numbers go into JSON and the
  browser). Half days counted in half-day units. Rounding once each: day's pay = round(salary ÷ 30); full-month
  earned = salary − round(unpaid × day's pay as shown); overtime pay = round(minutes × rate ÷ 60).
- **Paid months (rule 14):** a paid month is worked out again with the carry and adjustment it should have now; the
  difference from its frozen remaining is the next month's "Adjustment from <month>". This counts a later change
  exactly once, also when the next month is paid too and after an undo. Carry from a paid month uses its frozen
  remaining.
- **Open month (owner, 2026-10-16, as the plan):** a person employed the whole month shows the salary minus the
  absences so far ("So far · 16 of 31 days"), not pay for the days so far.
- `src/server/salary.ts`: `loadSalaryData` (settings, advances, payments minus undone ones) and `salaryMonths(user,
  month, { personId?, now? })` (`salary_view`: owner + support; future / bad month 404): every person with a setting,
  months from their first salary month up to the asked one (months outside their employment skipped), marks loaded
  once with `loadMarks`. Drizzle definitions for the five tables in `schema.ts` (dates as strings, money as numbers).
- Tests: Attendance 216 (+30: 23 pure incl. the ₹9,040 example, 7 database).

## 2026-10-17: Salary Phase 3 (person page: salary and advances)
- `src/server/salary-edit.ts`: `saveSetting`, `saveVisibility`, `saveAdvance` (owner only, `salary_edit`; person via
  `knownPerson`; `lockPerson`; a new row + audit row each; the page sends the newest row id it saw, otherwise 409 "Just
  changed by …"), and `salaryPanel` for the page (`salary_view`). Routes `POST /api/salary/settings`, `/visibility`,
  `/advances`. Rupees typed with up to 2 decimals (no commas) → paise on the server; salary and advances ≤ ₹1 crore.
- Rules as the plan's Database section. Made while building: an overtime rate is at most ₹1,00,000 an hour (a typo
  gets a plain message); "Can see own salary" saved again with the same value adds no row; a correction is stored on
  **the corrected entry's own date** (it lowers the right month) and may take at most what is left of that entry;
  a correction can't be corrected; From month choices run from 12 months back to 3 ahead.
- Page `/staff/<user>` under the calendar (mock-up 2): summary strip (`salary-strip.tsx`), Salary box + history and
  the Can see own salary tick (`salary-box.tsx`), advances (`advances.tsx`). **Change from the mock-up:** a Correct
  button on each advance row instead of the "This corrects an earlier entry" tick box. Support sees the same figures
  read-only, without forms.
- Recent changes texts: `salary.set`, `salary.advance`, `salary.correction`, `salary.visibility` (`src/lib/changes.ts`).
- Tests: Attendance 230 (+14, `test/salary-edit.test.ts`).
- Checked on `pnpm dev` (plant 002 with Attendance switched on for the check, a temporary owner + worker with marks
  1-15 Oct, headless Chromium at 1280 and 390 px): save with overtime, advance + correction, Can see own salary,
  the 409 on a stale tab, Recent changes, no sideways scroll at 390 px; the worker gets 404 on the page and 403 on
  the save, and sees no "₹" or "salary". Found and fixed: the history date was the UTC day (now India date).
  Everything removed afterwards and plant 002's module list restored.

## 2026-10-17: Salary Phase 4 (Salary tab and checking panel)
- `src/server/salary-tab.ts`: `salaryTab` (`salary_view`: owner + support; future / bad month 404): one row per person
  on salary that month (people who left are marked "(left)"), totals (salary, earned, OT pay, advances, carried in,
  remaining, **remaining to pay** = positive rows only), negatives ("Ramu −₹2,100 carries to November"), active Plant
  staff with no salary, the pill (complete / so far). `salaryCsv` + `GET /api/salary/export?month=` (`salary_export`:
  owner only; audited `salary.export`, "Downloaded the October 2026 salary CSV"; one row per person, amounts as
  rupees with 2 decimals, overtime cells blank without overtime; cells neutralised).
- `/salary?month=` with a **Salary** tab in the owner nav (owner + support; CSV button owner only): month arrows,
  four totals, the table with a total row on a PC, a list with one-line summaries on a phone (mock-ups 1 and 3).
- **Checking panel** (`src/app/salary/check-panel.tsx`, client only, no API): Auto vs Yours boxes, recalculated at
  each keystroke with `panelInput` (new in `src/lib/salary.ts`: typed days / hours / rupees → `monthPay` input; an
  empty box = auto; "Paid leave" is the leave allowed) + `monthPay`; days check line, difference line, Reset.
- **Changes from the mock-ups (made while building):** the page column is 768 px wide, so on a PC the panel opens as
  a **drawer from the right** (not beside the table), and the table block widens past the column (centred, up to
  1200 px) so all 12 columns fit. The Paid column comes in Phase 5.
- Tests: Attendance 237 (+7, `test/salary-tab.test.ts`: a mixed plant with the worked example, a part month, no
  overtime, a −₹2,100 carry, someone who left and someone without salary; CSV; access; the panel's +₹120 example).
- Checked on `pnpm dev` (plant 002 with Attendance switched on for the check, a temporary owner + 3 workers, headless
  Chromium at 1280 and 390 px): totals and "carries to November", typing 16 overtime hours → "₹120 more than auto",
  a wrong day count shown in amber, Reset, the CSV download, the phone list and full-screen panel, no sideways
  scroll; the worker gets 404 on `/salary`, 403 on the CSV, and no "₹". Everything removed afterwards and plant
  002's module list restored.

## 2026-10-17: Salary Phase 5 (Paid and the worker's slip)
- `src/server/salary-pay.ts`: `payMonth` (`POST /api/salary/pay`, owner only): allowed from the month's last day
  (India date, database clock); paid-on not in the future; inside the person's lock: 409 if a payment that isn't
  undone exists ("Already marked paid by …"), the figures are worked out again and must equal the page's remaining
  (409 "The figures changed since the page loaded (now ₹X)…"), then a `salary_payments` row with `paid_paise` =
  remaining or 0 and the **frozen figures** (`freezeMonth` in `src/server/salary.ts`: setting, counted days, counts,
  advance entries, the full `monthPay` input and result, `RULES_VERSION`). `undoPayment` (`POST
  /api/salary/pay/undo`, reason 3-300, once, 409 after). Audited `salary.paid` / `salary.unpaid`.
- Salary tab: paid rows show the frozen figures (the panel checks those too); Paid column ("Mark paid" from the last
  day, "✓ Paid 30 Sept" + Undo), "N of M paid", "Changed after payment: +₹400 → October", "Adjustment from September:
  +₹400", totals "Paid ₹X · still to pay ₹Y"; on a phone Mark paid / Undo sit at the bottom of the checking panel.
  The confirm dialog (mock-up 6) is drawn at the end of the page (a portal): the widened table uses a CSS transform,
  which would otherwise trap it.
- Worker (`src/server/salary-slip.ts`): `canSeeOwnSalary` (Plant staff + the newest "Can see own salary" row on),
  `myPayments` / `mySlip` from the frozen figures only; every other case 404. `/my/salary` (paid months, newest
  first) and `/my/salary/<YYYY-MM>` (mock-up 7); "My attendance · My salary" tabs only with permission.
- `salary_paid` (`notify.ts`): to the worker only (`also_user_ids` + `only_listed`), only with permission, not when an
  owner pays themselves, dedupe `paid:<payment id>`, after the answer through `kit.notify` (outbox on failure).
- Tests: Attendance 248 (+11, `test/salary-pay.test.ts`).
- Checked on `pnpm dev` (plant 002 with Attendance switched on for the check, temporary owner + two workers,
  September data): both months marked paid through the dialog; the worker with permission saw the tabs, the list and
  the slip (₹9,440, matching mock-up 7) and got the bell; the one without saw attendance only, no "₹", 404 on both
  salary URLs; Undo and paying again through the page; Recent changes. Found and fixed: the dialog was trapped
  inside the widened table (now a portal); "Paying now" showed a rounded rupee (now the exact amount). Everything
  removed afterwards and plant 002's module list restored.

## 2026-10-17: Salary Phase 6 (worker counts, month-end review, support)
- `monthStatuses` (`src/server/salary.ts`): present / half / absent and overtime per day from the month's salary
  setting, **days only** (no amount, rate or shift in the answer); own month `see_own`, others `see_everyone`, else
  404; null without a setting (the calendar stays plain).
- Calendars (`calendar.tsx`): half days light amber with "½", absent light red "absent", "+2 h" overtime (only with
  Gets overtime), "no exit" keeps its own look; the key adds Half day / Absent / overtime. Worker's My attendance
  (`/` and `/my`) gets a tile row Present · Half days · Absent · Overtime (overtime only with Gets overtime) and "So far:
  N days counted"; the owner's person calendar shows the same colours.
- Month-end review (`notify.ts`): `salaryReview` counts no-exit person-days this month (up to yesterday, people on
  salary) and active Plant staff without a salary; `runDaily` sends it on the month's last day (India date) to the
  plants from `salary_tenants()` with someone on salary this month; "October salary review today" / "1 day with no
  exit to fix · 2 people without salary" (or "All set: check the figures and mark them paid"), dedupe
  `salary_review:<YYYY-MM>`, owners only (the platform decides), outbox on failure.
- Support: every salary write already refused (tested route by route); the Support access page now names "the Salary
  tab" and "a person's attendance and salary".
- Tests: Attendance 258 (+10, `test/salary-worker.test.ts`; `summary.test.ts` updated for the new wording).
- Checked on `pnpm dev` (plant 002 with Attendance switched on for the check, temporary owner + workers): the daily
  job run as if on 31 Oct 2026 07:00 IST (scratch script calling the real `runDaily`) sent one review; the owner's
  bell showed "October salary review today · 1 day with no exit to fix · 2 people without salary"; the worker's
  calendar at 390 px showed the tiles (9 / 4 / 3 / 6 h), the coloured days and no "₹". The review also reached plant
  002's real owner Sujata in the dev database (no phone registered): that one test notification was removed with the
  rest of the test data; plant 002's module list restored.

# Salary extras (version 3), phase by phase
Plan: `docs/SALARY_EXTRAS_PHASE_PLAN.md`. Part A (per-day pay) to be released as v0.21.0, Part B (claims) as v0.22.0.

## 2026-10-17: Salary extras Phase A1 (per-day pay: database and rules)
- Migration `0003_per_day_pay.sql` (approved by the owner): `salary_settings` gets `pay_basis` ('monthly' default, or
  'per_day') and `day_rate_paise` (> 0, ≤ ₹1 lakh); `monthly_paise` may be empty. One check: monthly = a salary and no
  day rate; per day = a day rate, no salary and 0 paid leave. Rows already saved read as monthly; nothing rewritten;
  grants unchanged (SELECT + INSERT). Applied to dev and test.
- `src/lib/salary.ts`: `PayBasis`; `SalarySetting` / `PayInput` / `FrozenMonth.setting` carry the basis and day rate
  (`PayInput.monthlyPaise` is 0 for per-day people). **Rule 15** in `monthPay`: earned = day rate × (present + ½ half
  days), rounded once, no paid leave, no full / part month difference, no cap; overtime, advances, carry and paid
  months unchanged. `RULES_VERSION` 2. `readFrozen`: a month frozen with `rules: 1` reads as monthly (its saved
  numbers are shown as they are); `frozenOf` uses it, so old slips and paid rows keep working.
- Server: `schema.ts` and `salary.ts` load and freeze the two columns; the person page's history line shows "per day
  ₹450 · …" for a per-day row (`settingText`). No screens or API change yet: the Salary box still saves monthly rows
  only (Pay choice in A2).
- Tests: Attendance 278 (+20): worked example A (₹9,850), shift edges, no paid leave, joined mid-month,
  overtime off, carry, Monthly → Per day from November, rounding once, a `rules: 1` frozen month (pure); the new
  database checks, the two new columns' refused UPDATEs (110 statements), a per-day month from real marks and an old
  slip (database).

## 2026-10-17: Salary extras Phase A2 (per-day pay: screens)
- `POST /api/salary/settings` takes `pay_basis` (default monthly) and `day_rate`. Per day: a day rate > ₹0 and ≤ ₹1
  lakh; the monthly salary is saved empty and paid leave as 0 whatever the browser sends. Monthly: as before, a day
  rate sent with it is ignored. Audit `salary.set` adds `basis` and `day_rate`; Recent changes and the history line
  read "per day ₹450 · 8 h · overtime ₹60/h".
- Salary box: **Pay: Monthly / Per day** first (mock-up 1); Per day shows "Day rate (₹)" with "Present day = ₹450 ·
  half day = ₹225 · absent = nothing" and "Paid leave doesn't apply to per-day pay." instead of the leave field. The
  person page's strip shows "Paid leave used —".
- Salary tab: a "per day" tag beside the name, "₹450 / day" in the Salary column (and first on the phone line), leave
  "—". `TabRow` carries `payBasis` / `dayRatePaise` from the month's input (frozen for paid months). **Made while
  building:** the total row's Salary adds monthly salaries only and shows "—" when everyone is per day (₹0 read as "no
  pay").
- Checking panel: "Day rate (₹)" box instead of Monthly salary, no Paid leave box, "Paid days 25 × ₹450"
  (`panelInput` field `dayRate`, same `monthPay`).
- CSV: "Pay basis" and "Day rate" after "Monthly salary" (in the file's existing header wording, not `pay_basis`);
  blank Monthly salary / Paid leave allowed / used / Unpaid days for per-day people.
- Slip: "24 present + 2 half days (25 days) × ₹450 = ₹11,250" and "Day rate ₹450" in the footer; monthly slips
  unchanged.
- Tests: Attendance 288 (+10).
- Checked on `pnpm dev` (plant 002 with Attendance switched on for the check, a temporary owner + per-day worker with
  worked example A's marks in September, headless Chromium at 1280 and 390 px): saved Per day through the Salary box
  (with a past-month reason), history and Recent changes text, the Salary tab table and phone list, the panel with a
  typed ₹500 ("₹1,250 more than auto"), the CSV, marked paid at exactly ₹9,850, the worker's slip; no sideways scroll.
  Everything removed afterwards and plant 002's module list restored.

## 2026-10-17: Salary extras Phase B1 (claims: database, access, platform)
- Migration `0004_claims.sql` (approved by the owner): `salary_settings.km_rate_paise` (TA per km, ≤ ₹1,000) and
  `da_day_paise` (DA per field-duty day, ≤ ₹1 lakh), empty = none; three new tables, all `tenant_id` + FORCE RLS +
  `tenant_isolation`, `attendance_app` SELECT + INSERT only:
  - `salary_claims`: one claim per row, field duty (`km_tenths` 0-99,999) or expense (`amount_paise` ≤ ₹10 lakh),
    `note` 3-200; the kind decides which of the two is set
  - `salary_claim_decisions`: approved / rejected / withdrawn / cancelled; a reason exactly for rejected and cancelled;
    partial unique indexes = decided once, cancelled once; the newest row is the status (none = waiting)
  - `salary_claim_files`: bill photos (JPEG / PNG / WebP, 1 byte-10 MB); **additions approved with the migration:**
    `storage_key` unique and a `sha256` fingerprint (as Complaint Box)
  - decisions and photos reference a claim of the same plant (two-column key)
  Applied to dev; the test database rebuilds from the migrations.
- Server rules that need several rows (only waiting → approved / rejected / withdrawn, only approved → cancelled, one
  field duty per person and date, 3 photos and only on expenses) come with the API in B3 / B4.
- Access table: `claim_own` (owner + Plant staff, Plant staff), `claim_view` (owner, owner + Plant staff, support),
  `claim_decide` (owner, owner + Plant staff). A worker asking for `claim_view` gets **404** (like `see_own_salary`).
- `packages/types`: `attendance_salary.claim_new` (owners), `claim_decided` (`aboutYou`, the worker), `storage`
  (owners); none urgent or bell only. Platform: "Attendance & Salary storage (MB)" in `MODULE_LIMIT_FIELDS`
  (`limits.modules.attendance_salary.storage_mb`), shown on the plan screen when Attendance is on.
- Tests: Attendance 315 (+27; 14-table guard, 148 refused statements, the claim checks, cross-plant inserts, access
  rows), platform 313 (+1; eight kinds, worker's three, the storage limit saved and read back).

## 2026-10-17: Salary extras Phase B2 (claims: rules)
- `src/lib/salary.ts`: `Claim` / `ClaimStatus`, `claimTotals(claims, rates)` (**rules 16-18**: TA = approved km added
  up × TA rate, rounded once; DA = dates with approved field duty × DA rate; expenses = approved amounts; no rate = ₹0;
  only approved claims count), `PayInput` / `PayResult` carry `taPaise`, `daPaise`, `expensesPaise`, **rule 19** in
  `monthPay` (remaining adds them). `SalarySetting` has `kmRatePaise` / `daDayPaise`. `RULES_VERSION` 3; `FrozenMonth`
  keeps the counted claims, field-duty days and km; `readFrozen` gives months frozen before (rules 1-2) ₹0 and no
  claims. A claim approved or cancelled after payment needs no new code: the live month changes, so the carry chain's
  "Changed after payment" / adjustment does it.
- `src/server/claims.ts`: `loadClaims` (status = cancelled if cancelled, else the one decision, else waiting; never by
  timestamps), photo counts, who decided and why. `salaryMonths` loads them; each `SalaryMonth` has `claims` (every
  status) and `claimTotals`; `freezeMonth` saves them. Drizzle definitions for the three tables and two columns.
- Attendance never reads claims: a field-duty day stays absent without marks.
- Tests: Attendance 325 (+10): worked example B (₹12,136) pure and from real marks and claims, 42.5 km, km summed
  before rounding, one DA per date, no rate, every non-approved status, an adjustment after payment and back, attendance
  unchanged, claims by date, isolation.

## 2026-10-17: Salary extras Phase B3 (worker: My claims)
- `src/server/claims.ts`: `insertClaim` (the plan's rules, shared with the owner's entries in B4: date not in the
  future and ≥ the earliest allowed, a salary setting for that month, field duty only with a TA or DA rate that month,
  km 0-9,999.9 with one decimal, amount > ₹0 and ≤ ₹10 lakh with 2 decimals, note 3-200, **one waiting-or-approved
  field duty per person and date** (409 "You already sent field duty for 17 Oct"), audited `claim.sent`); `sendClaim`
  (`claim_own`, 31 days back, inside the person's lock; an owner who is also Plant staff: approved at once, no
  notification), `withdrawClaim` (own waiting claim only; someone else's 404; decided 409), `myClaims` (own month
  only; 404 without a salary setting, for a future month or before the first salary month), `uploadClaimPhoto`,
  `readClaimPhoto`, `photoIds`.
- Routes: `POST /api/claims`, `POST /api/claims/photo?claim=<id>` (raw body, `handleUpload`), `POST
  /api/claims/withdraw`, `GET /claim-photos/<id>` (private, nosniff, no-store).
- Photos (as Complaint Box): type by content (JPEG / PNG / WebP, else 415), ≤ 10 MB (413), 3 per expense (409), by
  whoever entered the claim within 24 h while it is waiting, the plan's storage limit (413) with the **storage**
  notification at 80 % / 95 % (#8, owners, dedupe `storage:<step>:<plan MB>`). **Made while building:** an owner's own
  entry is approved at once, so photos may also be added to an approved claim **that owner entered** (otherwise owners
  could never attach a bill). Photos are served to the claim's person, the owner and support (logged), else 404.
  Storage: `ATTEND_STORAGE_DIR` (default `.data/attendance`) or `ATTEND_STORAGE_BUCKET` + the shared `STORAGE_*`.
- Screens (mock-ups 2-4): tabs "My attendance · My claims · My salary" (`myTabs`: My claims with any salary setting,
  My salary only with "Can see own salary"), `/my/claims` with month arrows, "+ Field duty" (only with a TA / DA rate)
  and "+ Expense", "Approved this month: field duty N days · N km · expenses ₹N", cards with status, reason, thumbnails,
  Withdraw and "+ Photo"; `/my/claims/new?kind=…` with photos shrunk on the phone (`src/lib/upload.ts`, a copy of
  Complaint Box's helper). Never a TA / DA rupee on these screens.
- `attendance_salary.claim_new` (#6) to the owners after the answer, through `kit.notify` (outbox on failure): "Expense
  from Anmol: ₹450" / "Field duty from Anmol: 18 Oct, 42 km", body = the note, dedupe `claim:<id>`.
- Recent changes: `claim.sent`, `claim.entered`, `claim.withdrawn`.
- Tests: Attendance 341 (+16, `test/claims-worker.test.ts`).
- Checked on `pnpm dev` (plant 002 with Attendance switched on for the check, a temporary owner + worker on salary with
  TA ₹3 / DA ₹150, headless Chromium at 390 px): field duty sent, the same day again refused with the plan's message,
  an expense with a real 3000 × 2000 photo (stored 1600 × 1067, 24 KB), My claims with the thumbnail, no TA / DA rupees;
  both owners' bells had the two "new claim" notifications. Everything removed afterwards (rows, the photo file, the
  notifications) and plant 002's module list restored.

## 2026-10-17: Salary extras Phase B4 (owner: Claims tab and rates)
- Salary box (mock-up 1): "Field duty" with **TA ₹ per km** (up to 2 decimals, ≤ ₹1,000) and **DA ₹ per day** (≤ ₹1
  lakh), both optional, from a month like the rest; `POST /api/salary/settings` takes `ta_rate` / `da_rate`; the
  history line and Recent changes add "· TA ₹3/km · DA ₹150/day". They work the same for Monthly and Per day people.
- `src/server/claims.ts`: `claimsTab` (`claim_view`: owner + support; a worker 404), `waitingClaims` (every month, for
  "Claims (N)" in the owner nav), `personClaims`, `decideClaim` (`claim_decide`; approve / not approve a **waiting**
  claim, cancel an **approved** one; reason 3-300 for not approving and cancelling; inside the person's lock, re-read
  there, so a withdrawal or another owner's decision gives 409 "Just changed: this claim was withdrawn by Ramu…"),
  `enterClaim` (Staff → person: approved at once, any date from the first salary month to today, same one-field-duty-a-
  day rule, no "new claim"). Each owner card has TA / DA at that person's rates for the claim's month ("no TA rate"
  without one). Routes `POST /api/claims/decide`, `POST /api/claims/enter`.
- Screens: owner nav **Claims (N)**; `/claims` (mock-up 5): month arrows, Waiting (N) / Approved / Not approved / All,
  a person filter, cards with "TA ₹126 (42 km × ₹3) · DA ₹150", thumbnails, who sent / entered it and when, Approve /
  Not approve (reason "B Anmol sees this") / Cancel approval…; Staff → person: "Claims · <month>" under Advances with
  "+ Field duty" / "+ Expense" for the owner (the same form as the worker's, `person` mode).
- `attendance_salary.claim_decided` (#7): to the worker only (`also_user_ids` + `only_listed`), "Your expense on 18 Oct
  was approved / was not approved: <reason> / was cancelled: <reason>", body = what they typed, dedupe
  `decision:<id>`; never for an owner's own claim. **Link `/my/claims?m=<YYYY-MM>`** (the page's own month parameter;
  the plan wrote `?month=`).
- Recent changes: `claim.approved`, `claim.rejected`, `claim.cancelled`, `claim.entered`.
- **Made while building:** a worker adding a photo to their own claim that the owner entered gets the plain "Only the
  person who entered this claim can add its photos" (someone else's claim stays 404).
- Tests: Attendance 351 (+10, `test/claims-owner.test.ts`).
- Checked on `pnpm dev` (plant 002, temporary owner + worker, headless Chromium at 1280 and 390 px): the Salary box with
  TA 3 / DA 150 and the history line, the Claims tab with "Claims (2)" and "TA ₹126 (42 km × ₹3) · DA ₹150", approve and
  not approve with a reason through the screen, the person page section, the worker's list after the decisions; the
  worker alone got the two "your claim" notifications. Everything removed afterwards.

## 2026-10-17: Salary extras Phase B5 (Salary tab, slip, standard pieces)
- Salary tab (mock-up 6): **TA, DA, Expenses** columns between OT pay and Advances (and in the total row), "TA ₹546 · DA
  ₹900 · Exp ₹1,650" on the phone line, a "TA + DA + expenses" totals tile (and "Claims ₹X" on the phone), a banner
  "N claims waiting for October · Review ›" → `/claims?month=…&status=waiting`, "N claims waiting" under a name.
  `TabRow` has the month's rates, field-duty days, km and waiting claims (the frozen ones for a paid month; waiting is
  always live).
- Checking panel: TA / DA / Expenses (₹) boxes when the person has a rate or claim money (`panelInput` fields `ta`,
  `da`, `expenses`; the same `monthPay`).
- CSV: "Field duty days", "Km", "TA rate", "TA", "DA rate", "DA", "Expenses", "Claims waiting" after "Overtime pay" (in
  the file's existing wording; the plan wrote `field_duty_days`…).
- Mark paid: TA / DA / Expenses lines, and "1 claim for September is still waiting. Approve or reject it first; if you
  approve it later it comes as an adjustment next month." Paying is still allowed.
- Slip (mock-up 7, frozen figures): "Field duty 2 days · 60.5 km", "TA 60.5 km × ₹3", "DA 2 days × ₹150", each
  approved expense (date · what for) and "Expenses"; months frozen before claims show none of it.
- Month-end review body adds "N claims waiting"; the owner's tile adds "N claims waiting" (warn; at most 3 badges, "in
  now" makes way); support's log names "the Claims tab" and "a bill photo".
- Backup: `POST /api/cron/backup` (`backupNewFiles("attendance_salary", …)`, CRON_SECRET; "not set up" without the
  `BACKUP_*` variables); `backup.yml` step "Attendance files" **skipped until the GitHub variable
  `ATTENDANCE_BACKUP_FILES` is `on`** (made while building: `ATTENDANCE_URL` is already set for the daily jobs, and the
  workflow runs from `main`, so it would fail every night before v0.22.0 and its `BACKUP_*` variables are live); the
  dump check now includes the `attendance_salary` schema. Dev dependency `age-encryption` (as Complaint Box) for the
  backup test.
- Tests: Attendance 364 (+13, `test/claims-salary.test.ts`; `salary-tab.test.ts` totals gained the three fields).
- Checked on `pnpm dev` (plant 002, temporary owner + worker with September marks and claims, headless Chromium at 1280
  and 390 px): the Salary tab with the banner, the tile and the columns (TA ₹181.50 for 60.5 km, DA ₹300, expenses
  ₹450, ₹12,932), the panel "Matches the automatic figure", the mark-paid warning, paying, and the worker's slip
  without the waiting claim. Everything removed afterwards and plant 002's module list restored.

## 2026-10-17: Phase C, claims only for field staff (v0.22.1)
Plan: `docs/ATTENDANCE_ROLES_PHASE_PLAN.md` "Claims only for field staff".
- Migration `0005_field_staff.sql`: `salary_settings.field_staff boolean not null default false`; rows with a TA or DA
  rate ticked once (as the migration owner); check `salary_settings_rates_need_field_staff` (a rate needs the tick).
  Grants unchanged (SELECT + INSERT); the append-only list has one more refused UPDATE (149).
- Salary box: "Field staff: can send field duty and expense claims" in the Field duty panel; TA / DA boxes only when
  ticked (sent empty otherwise); `saveSetting` refuses a rate without it ("Tick Field staff first"); audit `field`;
  history / Recent changes "· field staff".
- `claims.ts`: `mayClaim` (the tick in that month's setting; owners only need a setting); `insertClaim` refuses a
  non-owner's own claim without it ("Claims are only for field staff. Ask the owner."); the owner's entries and an
  owner's own claims are unchanged. `hasOwnClaims` / `myClaims` (404) open My claims when ticked in a month the person
  may still date a claim in, or with any claim on record. The view has `canAdd` (buttons) and `canAddAny`
  (`/my/claims/new`, 404 without).
- **Made while building:** My claims also opens for someone ticked only **last month** while those dates are inside the
  31 days (the plan said "ticked this month"), so the tick for an earlier month can actually be used from the screen.
- My claims without `canAdd`: "Only the owner can add claims for you." instead of the buttons.
- Tests: `test/claims-field-staff.test.ts` (10: backfill replayed in a rolled-back transaction, the check, append-only,
  the tick from a month, rate without tick, not ticked → no tab / 404 / 400 for both kinds via the API, ticked, last
  month only, the owner's entry read-only, withdraw / decide after unticking, owner + Plant staff). Fixtures that set
  TA / DA rates now tick Field staff.

## 2026-10-17: Phase R1, roles, database, access (v0.23.0)
Plan: `docs/ATTENDANCE_ROLES_PHASE_PLAN.md`.
- Platform migration `0015_attendance_roles.sql`: roles `office_staff` "Office staff" and `supervisor` "Supervisor",
  both `module_id = attendance_salary`. `packages/types`: both in `ROLE_IDS` / `ROLE_MODULE` (so `roleWorksIn` /
  `canAccessModule` open Attendance to them), `isEmployee(roles)` = holds Plant staff, four new kinds (`advance_given`,
  `desk_fix` bell only, `scan` bell only, `not_marked`), `corrected` relabelled "Your attendance was changed". Platform
  `ROLE_LABELS` has both names; the role buttons list them when Attendance is on (proper hints in R5).
- Attendance migration `0006_desk_and_staff_type.sql`: `punches.source` also `'desk'` (+ `punches_desk_check`: distance
  and accuracy, no reason, never yourself), `salary_settings.staff_type` (permanent default / temporary),
  `plant_settings.not_marked_hour` (8-11, default 10, null = Off). **Changed while building (owner's OK):** the plan
  said UPDATE on `plant_settings` was already allowed, but it is column by column, so 0006 also grants
  `update (not_marked_hour)` to `attendance_app`. No rows change.
- Access: `Who` is now a list of capacities (`owner`, `employee`, `office`, `supervisor`; `support` alone); `can()` is
  true when any of them allows the action. New rows `see_today`, `mark_for`, `advance_add`, `advance_view`;
  `see_everyone` and `fix` gain office. Salary and claims actions answer 404 to Office staff / Supervisors (never 403);
  workers, owners, support and others keep their earlier messages. Header label Owner / Office staff / Supervisor /
  Plant staff / Read-only.
- Only employees are tracked: `people.ts` (`staffList`, `knownPerson`) and the month-end "no salary set" count use
  `isEmployee`. A `desk` mark counts like a scan in `sessions.ts` (never "changed").
- Office staff already pass `see_everyone` / `fix` here; the "not yourself" checks and their screens come in R2
  (nothing is deployed before R6).
- Tests: Attendance 387 (access table for every combination, `test/roles.test.ts`, desk / staff type / alert hour
  database checks, append-only list 150), platform 315 (roles table matches `ROLE_IDS`, Office staff / Supervisor in
  Attendance contacts and handoff, settings list, role buttons 11).


## 2026-10-17: Phase R2, Office staff (v0.23.0)
Plan: `docs/ATTENDANCE_ROLES_PHASE_PLAN.md` "Office staff", mock-ups 1-4 and 8.
- **Mark for someone** (`/desk`, `src/server/desk.ts`, `POST /api/desk/mark`, `mark_for`): every active employee (the
  platform's Plant staff list, `activeEmployees` in `people.ts`) with their state ("IN since 8:02 · by Ramesh", "OUT
  at 14:10", "Not in today") and one Mark IN / OUT button; yourself greyed ("Scan the QR for your own attendance", 403
  on the server). The same rules as a scan: plant location set, office phone's accuracy ≤ 500 m, inside the circle,
  2-minute double tap, IN / OUT decided by the server (409), per-person lock. Saved as `source = 'desk'` with the
  office phone's distance / accuracy, `created_by` = Office staff; audited `mark.desk`. Outside the circle: "The office
  phone is 1.2 km from the plant" and no "outside" alert. Someone who left (only in old marks): 404. No notification.
  `lastValidMark` now also returns the mark's source and author.
- **Fix** (`fixes.ts`): Office staff may add / cancel for anyone but themselves (403 "Ask the owner to fix your own
  attendance"; no Fix panel on their own day). The worker gets `corrected` as before; the owners get `desk_fix` (bell,
  `deskfix:<mark or cancel id>`), never for the owner's own fixes. The day view says "added by Sujata", "by Ramesh
  (office)" and "Cancelled by <name>" (was "added by owner").
- **Advances** (`saveAdvance`, now `advance_add`; the owner's rules unchanged): Office staff never for themselves (403),
  only an active employee with a salary set for that month ("Ask the owner to set this person's salary first"), today
  back to 7 days, ≤ ₹1 lakh, and correct only an entry they made the same India day (403 "Only the owner can correct
  this entry"). The owners get `advance_given` (phone + bell, `advance:<id>`), none for corrections or the owner's own.
- **Person page, Office view:** the month + `Advances` from `advancePanel()` (`advance_view`): the month's entries
  (who entered each), "Still to recover from earlier months" (the month's carried-in balance, via
  `salaryMonthsOf`, the access-free core of `salaryMonths`), the earliest date they may pick, and which entries they
  may correct. No salary strip, box, history, "Can see own salary", claims or slip; `/salary`, `/claims`, `/settings`
  answer 404 to them.
- **Tabs:** `OwnerNav` shows each tab from its access-table action (Today `see_today`, Mark for someone `mark_for`,
  Staff `see_everyone`, Salary, Claims, Recent changes `view_changes`, Settings); non-owners who are Plant staff get
  "My attendance" as a tab (`/my` shows the tabs for them).
- **Recent changes:** Office staff's entries read "Ramesh (office)" (`byLabel` in `audit.ts`).
- Owners refused `mark_for` are told "Owners use Fix on the person's day to add a time".
- Tests: `test/office.test.ts` (13); Attendance 400.

## 2026-10-17: Phase R3, Supervisor (v0.23.0)
Plan: `docs/ATTENDANCE_ROLES_PHASE_PLAN.md` "Supervisor", mock-ups 5-7 and 10.
- **Today board:** `todayBoard` needs `see_today`; its people come from `activeEmployees` (no `see_everyone`), and
  `boardFor(tenantId)` is the access-free core used by the tile and the morning job. The home page shows the board to
  everyone with `see_today`; for a Supervisor (no `see_everyone`) the names are plain text: no links, no "· Fix".
  "Inside now" says "· by Ramesh" for a desk mark. Supervisor tabs: Today (+ My attendance with Plant staff).
- **Scan alert** `attendance_salary.scan` (`sendScanAlert` in `notify.ts`, from the punch and desk routes after the
  answer): "Bindu IN 08:02" (body "by Ramesh" for a desk mark), bell, `scan:<mark id>`, `also_user_ids` = the plant's
  supervisors from the platform's contacts minus whoever marked and the person marked, `only_listed` (never owners).
  Nothing for a refused scan or a plant without supervisors.
- **Not-marked alert** `attendance_salary.not_marked`: `POST /api/cron/morning` (`runMorning`, CRON_SECRET) retries the
  outbox, then for each plant with marks in the last 3 days (`attendance_tenants()`) whose `not_marked_hour` has come
  (no settings row = 10:00; null = Off): the board's "Not marked" list, if not empty, as "3 people not marked by 10:00"
  / "Bindu, Kedar, Ramu" (5 names, then "+N"), phone + bell, `notmarked:<date>`, to owners + supervisors
  (`also_user_ids`, no `only_listed`). Skipped while the platform can't be reached (the board would be wrong). Later
  runs the same day repeat the same dedupe key, so the platform keeps one.
- **Settings:** "Not-marked alert" card (08:00 / 09:00 / 10:00 / 11:00 / Off), `PUT /api/settings/not-marked`
  (`saveNotMarkedHour`, owner), audited `settings.not_marked` ("Not-marked alert 10:00 → 08:00"); support read-only.
- **`evening.yml`:** second schedule line `30 2-5 * * *`; step "Attendance (not marked)" (`ATTENDANCE_URL`) only on it;
  Lab Records / Floor Stock skip it; "Run workflow" by hand runs all three.
- Tests: `test/supervisor.test.ts` (9); `punch.test.ts` now mocks `after()` (a saved scan sends the scan alert);
  Attendance 409. Checked on `pnpm dev` (plant 002, temporary Office staff / Supervisor / workers) at 390 px with a
  faked location: `/desk` before and after a real tap, the Office person page with advances and Correct on their own
  entry only, `/salary` 404 for Office staff, the owner's day "IN by Ramesh Tmp (office)", the Supervisor's read-only
  board (bell 1 from the scan alert), `/staff` 404 for the Supervisor, Settings with the not-marked card saved at 09:00.

## 2026-10-17: Phase R4, Permanent / Temporary (v0.23.0)
Plan: `docs/ATTENDANCE_ROLES_PHASE_PLAN.md` "Permanent / Temporary", mock-up 9.
- Salary box: "Staff type: Permanent / Temporary" (`staff_type` in `SettingInput`, default permanent), saved from a
  month like the rest (`salary_settings.staff_type`, migration 0006); audit `staff_type`; history / Recent changes
  "· temporary". Rows saved before 0006 read Permanent.
- Salary tab: `TabRow.staffType` (the month's setting), a "TEMP" tag beside the name (table and phone list), and a
  "Manpower cost" card with the total and Permanent / Temporary each: people, cost (`costOf` = earned + overtime + TA +
  DA + expenses; advances are not a cost) and to pay. The checking panel and `src/lib/salary.ts` are unchanged.
- CSV: "Staff type" (`permanent` / `temporary`) after "Pay basis".
- Tests: `test/staff-type.test.ts` (4); Attendance 413. Checked on `pnpm dev` (plant 002, temporary data): the Salary
  box set to Temporary in the browser at 390 px, the Salary tab at 390 and 1280 px with the split and the tag.

## 2026-10-17: Phase R5, platform screens (v0.23.0)
Plan: `docs/ATTENDANCE_ROLES_PHASE_PLAN.md` "Platform screens".
- **Role buttons** (`roleChoices`, `ROLE_HINTS` in `apps/platform/src/lib/permissions.ts`): "Office staff · Attendance:
  marks for others, fixes times, advances (no salaries)", "Supervisor · Attendance: Today board and IN / OUT alerts";
  only with Attendance on (a role already held shows "not switched on").
- **Permissions:** both roles in the Attendance column ("Office staff, Supervisor" when both); 🔔 for anyone holding a
  role listed on one of the module's kinds (`NOTIFICATION_KINDS[…].roles`), i.e. supervisors; never a ticked bell in
  an owner-only module. Two lines in the key.
- **Launcher:** a staff tile carries `subtitle` only when a role has its own line (`MODULES.attendance_salary.staffBy`,
  `roleLine` in `apps/platform/src/lib/modules.ts`): Office staff "Attendance desk", Supervisor "Today board"; others
  keep "Mark attendance". One-module rule unchanged (Office staff only lands in Attendance; + Document keeper sees
  tiles).
- **Tile "desk" view** (Phase 0 finding 2): `SummaryView` = owner / staff / desk and `DESK_ROLES` in `packages/types`;
  the platform's `summaryViewFor(roles, module)` sends `desk` to a non-owner holding a desk role; `verifySummaryRequest`
  accepts it through the shared schema (an unknown view is refused). Attendance answers `desk` with the owner's
  attendance badges (in now / not marked from 11:00 / no exit), never the claims badge, and "Not set up yet" (info)
  before the location and QR exist. Lab Records and the rest treat anything but "owner" like staff (no change).
- **Notification settings** (`kindsFor`): `roles` (non-owners holding one receive it in an owner-only module) and
  `noOwners` on `NOTIFICATION_KINDS`. A Supervisor sees "Someone marked IN / OUT" (Bell / Off) and "People not marked
  (morning)"; owners no longer see the every-scan kind; "about you" kinds in Attendance only for Plant staff (Office
  staff / Supervisors alone see none of them).
- Tests: platform 320 (+5 in `test/attendance.test.ts`), auth 53 (+1), Attendance 413 (+1 desk view in
  `summary.test.ts`). Checked on `pnpm dev` (plant 002, temporary users and dev sessions, all removed): Manage users
  with the two role buttons, Permissions with the key, the Office staff launcher ("Attendance desk"), the
  Supervisor's notification page with its alert and the two settings.

## 2026-10-17: "Ask for DA" on a field duty (v0.24.0)
Asked by the owner 2026-10-17: a field-duty person sometimes eats at home, so they choose per day whether to ask for DA.
- **Database:** migration `0007_claim_wants_da.sql` (approved by the owner): `salary_claims.wants_da`, yes / no on a
  field duty, empty on an expense (check `salary_claims_wants_da_check`); every field duty saved before is set to yes,
  so nothing counted or paid changes. Grants unchanged (SELECT + INSERT): the choice is fixed once sent; a mistake is
  withdrawn while waiting and sent again.
- **Rule 17 now:** DA = the dates with approved field duty **that asked for DA** × the DA rate (`daDays` in
  `claimTotals`, `asksDa()` in `src/lib/salary.ts`); TA unchanged (all approved km). `RULES_VERSION` 4; months frozen
  with `rules: 3` read `daDays` = `fieldDutyDays` (every field-duty day had DA then). Missing / null `wantsDa` = asked.
- **Screens:** Field duty form tick box "Ask for DA (food allowance) for this day", ticked by default (owner), also on
  the owner's entry for someone; 0 km with no DA is refused ("nothing to claim"). Claim cards "42 km · DA asked" / "42
  km · no DA"; the owner's card "no DA asked" instead of the DA rupees; My claims "· DA N days" when it differs from
  the field-duty days; slip and checking panel "DA N days"; CSV gains a "DA days" column after "TA"; the owners' "new
  claim" title ends ", no DA".
- Tests: Attendance 418 (+4: rule B5a, API 8a, two database checks).

## 2026-10-18: location accuracy (B-04, v0.25.3)
Plant 001 widened the circle to 2,000 m; live readings showed why: the phone's **first** location is often the network
fix (±200-500 m), which placed people 1.0-1.7 km away, while good GPS readings (±4-17 m) were within 190 m.
- `src/lib/locate.ts` `bestLocation()`: watches up to 20 s, takes the most accurate reading, stops early at ±30 m.
  Used by the scan button, the office desk and the owner's "Use my current location" (pin warning above ±50 m).
- `MAX_ACCURACY_M` 500 → **150** (owner, 2026-10-18), on the server (scan + desk) and checked on the phone first: a
  rough reading isn't sent; the screen shows how to turn on precise location (Android: Google Location Accuracy;
  iPhone: Precise Location). The button shows "Finding your location… ±450 m" while waiting.
- **The QR is unchanged** (owner): saving the circle never touches the QR key; plant 001 sets the circle to 300 m and
  re-checks the pin after the release.
- Tests: `test/locate.test.ts` (5), punch 150 / 151 m, desk 151 m refused.

## 2026-10-19: Supervisor marks and fixes the Office staff (v0.26.1)
Asked by the owner 2026-10-19 (Office staff can't mark or fix themselves; the Supervisor now does it for them).
Decisions: Office staff only; mark now **and** Fix (add / cancel with a reason); Office staff still scan the QR themselves.
- Access: `see_office_staff` (new, supervisor), `mark_for` and `fix` gain supervisor. The person is checked in
  `people.ts`: `officeStaffFor` (active, Plant staff + Office staff, not themselves), used by `knownPerson`,
  `staffList`, `reachableEmployees` (desk list) and `requireReach` (`dayStamp`, `cancelFix`, `monthStatuses`); anyone
  else is 404. A Supervisor who is also Office staff has `see_everyone` and reaches everyone (never themselves).
- Screens: Supervisor tabs Today · Mark for someone · Office staff (`/staff`, titled "Office staff"); the Today board
  links only the Office staff (`reach`); person month without salary / advances; day with Fix.
- Labels: `byLabel` "Sunil (supervisor)"; desk marks "IN by Sunil" for everyone (the role isn't stored on the mark);
  "This phone is 1.2 km from the plant". Owners get `desk_fix` for a Supervisor's fix as for Office staff.
- No migration; SSO token unchanged. Tests: `supervisor.test.ts` 10-12, access / office tests updated.

## 2026-10-20: "Mark days" on the person's month (v0.28.0)
Asked by the owner 2026-10-20 (some people don't mark IN / OUT; the owner wants to mark their days ON / OFF from the
calendar, several at once). Mock-up approved: https://claude.ai/artifact/GZKHK5ovwTPFjtoEL6fihw.
- Owner only (`day_mark`). **Mark days** above the calendar → taps pick days (tick + outline) instead of opening them;
  only today and earlier (future days aren't links); any weekday, Sunday like any day; at most 31 at once. The bottom
  bar marks them all **ON / OFF / Clear**; Cancel / Done leaves without saving. Picks survive moving month (this tab's
  sessionStorage).
- Server: `setDayMarks` + `DayMarksInput` (`POST /api/day-marks`), one transaction, all or nothing (one future day
  refuses the whole save); each day its own `day_marks` row and its own Recent changes line; a day that already has
  that mark is skipped. `setDayMark` (the day page) now goes through it.
- Calendar day links carry `data-day`. No migration; platform and SSO token unchanged.
- Tests: `day-marks.test.ts` +2 (Attendance 443).

## 2026-10-23: Lunch break and short days, rule 21 (v0.29.1)
Asked by the owner 2026-10-23 after checking Reeta's and Damayanti's October: the shift is 8 h work + 1 h lunch, and a
day under 8 h must not be a half day. "Build as recommended" the same day. No IN / OUT time changes: only the
calculation.
- **Rule 21** (`src/lib/salary.ts`, `RULES_VERSION` 6): work = time at the plant − the lunch break (`workMinutes`).
  Work ≥ the work hours = a full day, overtime = work over it (₹/h as before). Work below = a **short day**: the month's
  short-day work ÷ the work hours = days paid (exact to the minute, e.g. 61h 57m ÷ 8 = 7.74). No marks = absent.
  **No more half days** (status `half` stays only for months paid before). ON / OFF day marks unchanged.
- **Lunch:** taken off in full from 5 h at the plant (recommended by me, owner OK). *Made while building:* from 4 h to
  5 h the work stays 4 h (with a 1 h break), so staying a minute longer never gives less work than leaving earlier. A
  break the person marked themselves (OUT / IN, `WorkDay.gapMinutes`) counts towards the lunch, never taken off twice.
- **Monthly staff, same rule** (owner): the time short days are short is missing time; paid leave covers missing time
  first (absent days and short time together), the rest is taken off at salary ÷ 30 per day, pro rata to the minute.
  With no short days every figure is exactly the half-day arithmetic of before (test).
- Pay is worked out in minutes and rounded once; `PayResult`'s `*Halves` fields stay for the screens and may be
  fractions (`halvesText` shows 2 decimals). `PayInput.shiftMinutes` added; `DayCounts.short` / `shortMinutes`.
- **Database:** migration `0009_lunch_break.sql` (approved by the owner): `salary_settings.lunch_minutes` 0-180 in
  15-minute steps, default 0; grants unchanged (SELECT + INSERT). `shift_minutes` now means a full day's **work**.
- **Screens:** Salary box "Work hours a day" + "Lunch break (hours)" ("9 h at plant = 8 h work + 1 h lunch");
  calendar cells show work, amber "short", "+57m" overtime, and a rule line in the key; month tiles / salary strip
  Full · Short · Absent with "Short-day work 61h 57m ÷ 8 h = 7.74 days"; day page "Work for salary" box (At plant −
  Lunch = Work → Full / Short / Absent · overtime), hours only, never money, on the owner's and the worker's day page;
  Salary tab Full / Short columns and Days text; checking panel boxes "Short days" + "Short-day work (hours)"; slip
  "11 full + 1 off + 9 short (61h 57m ÷ 8 h = 7.74 days) = 19.74 days × ₹250"; CSV "Work hours", "Lunch hours",
  "Full days", "Short days", "Short-day hours", "Short days as days" (Half days kept, 0 since).
- **Live data at the time:** no month paid yet anywhere, so nothing frozen changes. Existing settings have no lunch:
  their work = time at the plant until the owner sets it. Reeta's setting says 9 h (540) from 20 Oct: the owner sets
  8 h work + 1 h lunch from October (reason required, a past month).
- **Salary band** (owner, same day): this pattern is named `PV_SALARY_DAY_STAFF` (`SALARY_BAND` in
  `src/lib/salary.ts`), a name only: everyone is on it, no database change. Shown in the Salary box, above the Salary
  tab table, on the slip and as the CSV's "Salary band" column; saved as `band` in a paid month's frozen figures (none
  before rule 21). A second band only when the owner asks for another pattern.
- Tests: `short-days.test.ts` (+9: lunch, monotonic, OUT / IN break, statuses, Reeta ₹5,156.77, Damayanti ₹2,824.16,
  monthly with leave, unchanged without short days, panel); older tests that expected half days updated.
