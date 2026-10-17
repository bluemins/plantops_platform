# Attendance & Salary: module notes

Version 1 (attendance) released as **v0.18.0** (2026-10-15): `docs/ATTENDANCE_PHASE_PLAN.md`. Version 2 (salary)
released as **v0.20.0** (2026-10-17): `docs/SALARY_PHASE_PLAN.md`. Version 3 (salary extras) Part A, per-day pay,
released as **v0.21.0** (2026-10-17): `docs/SALARY_EXTRAS_PHASE_PLAN.md`. Build notes per phase are further down.

## At a glance
| | |
|---|---|
| Module id / role | `attendance_salary` / **Plant staff** (`plant_staff`; works only here, `PLANT_STAFF_MODULES`) |
| App / port | `apps/attendance-salary`, `:3006`; live `https://attendance.bluemins.life` (service `attendance-salary`, no volume) |
| Database | schema `attendance_salary`, login `attendance_app` (no BYPASSRLS, not the owner); 11 tables, FORCE RLS, no DELETE anywhere; the five salary tables are SELECT + INSERT only |
| Migrations | `0001_attendance.sql` (v0.18.0), `0002_salary.sql` (v0.20.0), `0003_per_day_pay.sql` (v0.21.0, per-day pay) |
| Env | `ATTEND_DATABASE_URL_APP`, `ATTEND_SESSION_SECRET` (also makes the QR key), `MODULE_URL_ATTENDANCE_SALARY`, `MODULE_SECRET_ATTENDANCE_SALARY`, `PLATFORM_URL`, `CRON_SECRET` |
| Jobs | `POST /api/cron/daily` (07:00 IST, `daily.yml` step "Attendance", GitHub variable `ATTENDANCE_URL`): outbox, "didn't mark OUT yesterday", and on the month's last day the salary review |
| Notifications | `corrected` (worker only, phone + bell), `outside` (owners, bell), `no_exit` (owners, bell), `salary_review` (owners, last day, phone + bell), `salary_paid` (the worker only, only with "Can see own salary"); owner-only module (`OWNER_ONLY_ALERTS`) |

## Who may do what (`src/server/access.ts`, the one table)
| Action | Owner | Owner + Plant staff | Plant staff | PlantOps support |
|---|---|---|---|---|
| Mark IN / OUT (QR) | – | ✔ | ✔ | – |
| Own calendar and days (with present / half / absent / overtime counts, never money) | – | ✔ (`/my`) | ✔ (home) | – |
| Everyone: Today, staff, person pages | ✔ | ✔ | – (404) | read-only |
| Fix (add a time / cancel a mark) | ✔ | ✔ | – | – |
| Settings (location, circle, QR) | ✔ | ✔ | – | read-only |
| Month CSV | ✔ | ✔ | – | – |
| Recent changes | ✔ | ✔ | – | read-only |
| Support access page | ✔ | ✔ | – | – |
| Salary tab, salary sections (`salary_view`) | ✔ | ✔ | – (404) | read-only |
| Salary settings, advances, Can see own salary (`salary_edit`) | ✔ | ✔ | – | – |
| Mark paid / undo (`salary_pay`) | ✔ | ✔ | – | – |
| Salary CSV (`salary_export`) | ✔ | ✔ | – | – |
| Own salary slips (`see_own_salary`) | – | ✔ | ✔ | – |

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

`salary_tenants()` (security definer, plant ids only) lists plants for the month-end review.

## Not in this version
Weekly offs and holidays; leave requests or leave types; printed / PDF payslips; partial payments during the month
(record them as advances); deductions other than advances (PF, ESI, TDS); salary in Hindi / Odia; a worker seeing an
unpaid month; "mark all as paid". From version 1 still: a worker asking for a correction; a supervisor role; marking
for another person; a gate tablet; a selfie at the scan; reports beyond the two CSVs.

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
