# Office staff and Supervisor (Attendance & Salary roles): Phase Plan and Build Prompts

**Status:** Asked by the owner on 2026-10-17; recommendations accepted the same day. **Built after Salary extras
Part B (v0.22.0)**, as release **v0.23.0**. Mock-ups approved 2026-10-17 (scan alert bell-only shown and accepted).
**Added 2026-10-17 (owner): Phase C, claims only for field staff** (a "Field staff" tick per person), a small release
**v0.22.1** built first with one small migration. **Phase 0 done 2026-10-17** (plan checked against the code; two
answers from the owner, see "Phase 0 findings"). **Phase C built 2026-10-17** (v0.22.1, see
`apps/attendance-salary/NOTES.md`); next is R1.

**What the owner asked (2026-10-17):**
1. **Office staff:** enter attendance times for people without a smartphone, and enter the cash advances staff take
   from the office.
2. **Supervisor:** a notification when someone marks IN / OUT, and similar uses later.

**Owner's answers (2026-10-17):**
- **Plant staff = everyone on the payroll, permanent or temporary**, so the owner sees the complete manpower cost.
  Office staff and supervisors who are paid through PlantOps hold their role **+ Plant staff**.
- **Office staff** is a different person from plant workers: an office job, like Document keeper (one person may
  hold both).
- Accepted recommendations:
  - Office staff: **"Mark for someone"** (IN / OUT now, office phone's location) **plus Fix** for real mistakes
  - Office staff sees the person's **advances this month + what is still to recover from earlier months**, never a
    salary
  - Supervisor covers **all Plant staff** (teams later)
  - Scan alerts **in the bell by default**, plus a read-only **Today board** and one phone alert **"N people not
    marked by 10:00"** (hour set by the owner)
  - **Permanent / Temporary** on each person, with the cost split on the Salary tab

**Changed while planning (accepted with the mock-ups, 2026-10-17):** the scan alert is **bell only (Bell / Off)**. Notification
settings can only lower a level (`notification_prefs`: bell / off), so "bell by default, phone if you want" would
need a platform schema change. Phone buzzes go to the 10:00 alert instead.

**Mock-ups (approved by the owner 2026-10-17):** https://claude.ai/artifact/7WCaE4WWCLbYhegZ9nSYBn
1. Office · Mark for someone 2. Office · person page (attendance + advances, no salary) 3. Office · Add advance
4. Office · salary pages 404 5. Supervisor · Today board 6. Supervisor · bell 7. Supervisor · notification settings
8. Owner · bell 9. Owner · Salary tab with the Permanent / Temporary split 10. Owner · Settings "Not-marked alert".

**Added by the owner (2026-10-17), Phase C:** only the people who do field work (at plant 001: Dillip and Kedar) may
fill in claims. **The owner ticks them, like Permanent / Temporary**, on the person's Salary box; only a ticked person
can see and fill in claims. Everyone else sees no My claims tab and no claim buttons. When the owner enters a claim
for someone, that person sees it on their side.

## Phase 0 findings (2026-10-17)
Checked against the code; the plan below already includes these:
1. **No `/today` page.** The Today board is the home page `/` (the owner's `no_exit` links to `/?day=`); an owner who is
   also Plant staff sees their own month at `/my`. Office staff and Supervisors use `/` the same way (Supervisor
   read-only), with their own attendance at `/my` when they also hold Plant staff. Notification links are `/`.
2. **Tile numbers for Office staff / Supervisor (owner's answer: add a "desk" view).** The tile request only said
   `view: "owner" | "staff"`, never who is looking, so a module couldn't give numbers to Office staff without giving
   them to every worker. The summary request's `view` becomes `"owner" | "staff" | "desk"`: the platform sends `desk`
   to a non-owner who holds a role listed for that module in `DESK_ROLES` (`packages/types`;
   `attendance_salary: ["office_staff", "supervisor"]`). Attendance answers `desk` with the owner's attendance badges
   (in now / not marked / no exit), **never the claims badge** (no money); other modules treat `desk` like `staff`.
   This changes the CLAUDE.md "Summary request" / "Launcher tiles" contract (not the SSO token); built in R5.
3. **The Today board loads the staff list through `see_everyone`.** Supervisors get `see_today` only, so R3 gives the
   board an internal staff-list helper without opening `see_everyone` to them.
4. **evening.yml is one job** (Lab Records + Floor Stock). With a second (morning) schedule line, the Attendance
   morning step runs only on the morning schedule and the other steps only on the evening one
   (`github.event.schedule`; "Run workflow" by hand runs them all).
5. **Not-marked count (owner's answer: same as the board).** The alert counts exactly the Today board's "Not marked"
   list (every active Plant staff person with no mark today, salary set or not), from one shared function, so the
   alert, the board and the tile agree.
6. **My claims already shows "Entered by <name>"** on claims someone else entered; kept ("Entered by Sujata") instead
   of "Entered by the owner".
7. `corrected`'s settings label today is "Your attendance changed by the owner"; it becomes "Your attendance was
   changed" (R2).

## Names used in this plan
| Thing | Value |
|---|---|
| Module / app | `attendance_salary`, `apps/attendance-salary` on `:3006`, live `attendance.bluemins.life` |
| New roles (platform) | `office_staff` "Office staff", `supervisor` "Supervisor", both `module_id = attendance_salary` |
| Platform migration | `0015_attendance_roles.sql` |
| Module migrations | `0005_field_staff.sql` (Phase C), `0006_desk_and_staff_type.sql` (R1) |
| New helper | `isEmployee(roles)` in `packages/types` (= holds Plant staff) |
| New notification kinds | `attendance_salary.advance_given`, `attendance_salary.desk_fix`, `attendance_salary.scan`, `attendance_salary.not_marked` |
| Release | v0.22.1 (Phase C), v0.23.0 (R1–R6) |

## Agreed design

### Claims only for field staff (Phase C, v0.22.1)
**Who is "field staff":** a person the owner has ticked as **Field staff** in their Salary box. Today "+ Expense" and
the My claims tab are open to everyone with a salary setting, and "+ Field duty" only needs a TA or DA rate.
- **The tick** (Salary box, next to Pay and Staff type): **"Field staff: can send field duty and expense claims"**,
  off by default. Like every Salary box choice it is saved **from a month** (a new `salary_settings` row), so earlier
  months keep what they had, and it shows in the salary history ("… · field staff") and Recent changes.
- **TA / DA rates** stay in the Salary box. The rate boxes are shown only when the tick is on. A rate without the tick
  is refused (400 "Tick Field staff first").
- **Send a claim yourself** (`claim_own`): only for a date whose month has the tick in your salary setting. Expense =
  tick; field duty = tick **and** a TA or DA rate (as today). Otherwise the server refuses it (400 "Claims are only for
  field staff. Ask the owner."), whatever the screen shows.
- **My claims tab and page** (`/my/claims`): shown when the tick is on this month **or** the person has at least one
  claim on record (any status, whoever entered it). Otherwise the tab is not shown and the page answers 404, as for
  someone without a salary setting today.
- **On My claims:** "+ Field duty" / "+ Expense" only for a ticked month. A month without the tick shows the list
  only, with "Entered by <owner's name>" on claims the owner entered (as today), and the line "Only the owner can add
  claims for you."
- **The owner enters for someone** (Staff → person → Claims): unchanged and **not limited by the tick**. Expenses can
  be entered for anyone with a salary setting, field duty only with a rate (which needs the tick). They are approved at
  once and show on that person's My claims (the tab appears because a claim exists) and on their slip as today.
- **Claims already sent** by someone who isn't ticked stay as they are: the owner decides them as usual, and the person
  sees them and may still withdraw one that is waiting or add photos within the existing rules. They just can't send
  new ones.
- **Existing people:** the migration ticks every saved salary setting that already has a TA or DA rate, so anyone set
  up for field duty in v0.22.0 keeps working; everyone else starts unticked.
- **Unchanged:** owners (and an owner who is also Plant staff) enter claims from the person page as today; the Claims
  tab, Salary tab, slips, rules 16–19, notifications, support view. No platform change, SSO token unchanged.

### One rule first: who is an employee
Today the module asks `roleWorksIn(role, "attendance_salary")` to mean "this person is tracked" (`session.ts`
`whoFor`, `people.ts`, `notify.ts` salary review). With two new roles that work in the module, Office staff and
Supervisors would wrongly appear on the Today board, the Staff list and the "no salary set" count.
- New `isEmployee(roles)` = holds `plant_staff`. **Tracked, paid, marks own attendance = employee only.**
- `roleWorksIn` keeps meaning "may open the module"; `office_staff` and `supervisor` work in it through
  `ROLE_MODULE`, so the platform's recipient re-check and `canAccessModule` work unchanged.
- `OWNER_ONLY_ALERTS` stays: nobody can be ticked for Attendance. Supervisors are reached with `also_user_ids`
  (+ `only_listed` where owners should not get it), re-checked by the platform as today.

### Who a person is, in the access table
`Who` becomes a **set** of capacities: `owner`, `employee`, `office`, `supervisor` (and `support` alone). Today's
`owner_worker` = {owner, employee}. `can(user, action)` is true when any capacity allows it. Examples:
- Ramesh = Office staff + Plant staff → {office, employee}: marks his own attendance, marks for others.
- Sunil = Supervisor + Plant staff → {supervisor, employee}.
- Office staff + Supervisor (+ Plant staff) → {office, supervisor, employee}: all of Office staff's rights (which
  already include the Today board, with buttons) plus the Supervisor's alerts (`scan`, `not_marked`). The "not self"
  rules stay. The scan alert still leaves out whoever made the mark, so a desk mark they made themselves doesn't
  alert them. Still no salary pages (neither role has them). One Attendance tile on the launcher.

### Office staff
**Mark for someone** (`/desk`, mock-up 1):
- A list of active employees (search by name), each with their state now ("IN since 8:02" / "Not in"), and one big
  button: **Mark IN** / **Mark OUT** (the server decides, as for a scan).
- The office phone's browser location is checked like a scan: the plant circle and ≤ 500 m accuracy. No QR needed:
  Office staff is a trusted role, and the location still proves the desk is at the plant.
- Time = the server's "now". The 2-minute double-tap rule and the per-person lock apply.
- Stored as a mark with **source `desk`**, the office phone's distance / accuracy, `created_by` = Office staff, no
  reason. The day view shows "IN 8:05 · by Ramesh (office)". It counts exactly like a scan (not "changed").
- **Never for yourself:** Office staff marks their own attendance with the QR like everyone else (403 "Scan the QR
  for your own attendance").

**Fix** (same screen as the owner's, same rules: reason 3–300, never in the future, cancel once, 409 if the day
changed, the night-shift next-morning rule):
- Office staff may fix **anyone except themselves** (403 "Ask the owner to fix your own attendance").
- The worker gets `corrected` as today (label becomes "Your attendance was changed"); the owner gets `desk_fix`
  (bell).
- Paid months: the existing rule applies (the change shows as "changed after payment" and carries to the next month).

**What Office staff sees:** the Today board, the Staff list, each person's attendance month and days, and a
**person page without the Salary box, the Salary tab, salary history, slips, overtime pay or claims**. No Settings,
QR, CSV, Recent changes, Mark paid or Support access.

**Advances** (person page → Advances, mock-ups 2–3):
- **+ Advance:** date (today by default, at most 7 days back, never in the future), amount (₹1 – ₹1 lakh), note.
  Stored in `salary_advances` like the owner's (no schema change; `created_by` shows who).
- They see: the person's advances this month (who entered each), and **"Still to recover from earlier months:
  ₹X"** when the carried balance is negative. Never earned pay, salary or remaining-to-pay.
- **Correct** an advance: only one **they** entered, on the **same India day** (the existing correction row: negative,
  linked, with a reason). Anything older: only the owner.
- Never an advance for themselves (403).
- Only for a person with a salary setting for that month (else 400 "Ask the owner to set this person's salary first").
- The owner gets `advance_given` (**phone + bell**): "Ramesh gave ₹2,000 advance to Bindu".

### Supervisor
- **Today board, read-only** (the home page `/`, mock-ups 5–7): who is in now, who marked OUT, who has not marked yet. No fix
  buttons, no calendars, no money. The Staff list and person pages stay closed (403).
- **Scan alert** `attendance_salary.scan` (**bell only**, Bell / Off): "Bindu IN 8:02" / "Bindu OUT 18:15" (desk
  marks add "· by Ramesh"). Sent to every active supervisor of the plant (`also_user_ids` + `only_listed`), except
  the person who marked. Not to owners. Dedupe `scan:<mark id>`. Refused scans ("outside") are not sent.
- **Not-marked alert** `attendance_salary.not_marked` (**phone + bell**): at the owner's hour (default 10:00, choices
  08:00–11:00 or Off, mock-up 10), once per plant per day: "3 people not marked by 10:00" / "Bindu, Kedar, Ramu". To
  owners and supervisors. Who counts: exactly the Today board's "Not marked" list (every active employee with no mark
  today, salary set or not; owner 2026-10-17), from the same function, so the alert, the board and the tile agree
  (people who left drop off; weekly offs and leave come later, so a day off will show here).
- **Later** (not in this version): teams, leave requests, checking field-duty claims.

### Permanent / Temporary
- Salary box: a new choice **Staff type: Permanent / Temporary** (default Permanent), from a month like the rest;
  history line "… · temporary".
- Salary tab: the totals strip adds **"Permanent (8): ₹1,52,000 · Temporary (5): ₹32,500"** (remaining to pay and
  earned + overtime + claims, both split); a small "temp" tag beside the name. Checking panel unchanged.
- CSV: column `staff_type`.
- Nothing else changes: the rules in `src/lib/salary.ts` don't look at it.

### Who sees what (new columns)
| | Owner | Office staff | Supervisor | Employee (Plant staff) | Support |
|---|---|---|---|---|---|
| Mark own attendance (QR) | with Plant staff | with Plant staff | with Plant staff | yes | no |
| Mark for someone (`desk`) | no (owner uses Fix) | yes, not self | no | no | no |
| Fix | yes | yes, not self | no | no | no |
| Today board | yes | yes | read-only | no | read-only |
| Staff list, anyone's calendar / days | yes | yes | no | own only | read-only |
| Salary box, Salary tab, slips, claims, CSV | yes | **never** | never | own slip with permission; own claims only when ticked Field staff, or when the owner entered one (Phase C) | read-only |
| Add / correct advance | yes | add; correct own same day; not self | no | no | no |
| See a person's advances + still to recover | yes | yes | no | no | read-only |
| Settings, QR, Recent changes, Support access | yes | no | no | no | read-only (not Support access) |

New access rows in `src/server/access.ts`: `mark_for` (office), `see_today` (owner, office, supervisor, support),
`advance_add` (owner, office), `advance_view` (owner, office, support); `see_everyone` and `fix` gain office. The
"not self" rules are server checks next to the table. A refused page answers 403 with a plain message; salary pages
answer 404 to Office staff and Supervisors (they never learn salary pages exist).

### Notifications (N5+)
| # | Kind | When | Who | Title / body | Link | Dedupe key | Level |
|---|---|---|---|---|---|---|---|
| 9 | `attendance_salary.advance_given` | Office staff adds an advance (not the owner's own) | Owners | "Advance ₹2,000 to Bindu" / "Given by Ramesh · <note>" | `/staff/<user>?month=<YYYY-MM>` | `advance:<id>` | Phone + bell |
| 10 | `attendance_salary.desk_fix` | Office staff adds or cancels a mark (not "Mark for someone") | Owners | "Ramesh changed Bindu's attendance" / "17 Oct: added IN 08:10 · <reason>" | `/staff/<user>/<date>` | `deskfix:<mark or cancel id>` | Bell only |
| 11 | `attendance_salary.scan` | Any saved IN / OUT (scan or desk) | Supervisors only (`only_listed`), minus whoever marked | "Bindu IN 08:02" | `/` | `scan:<mark id>` | Bell only |
| 12 | `attendance_salary.not_marked` | Morning job at the plant's hour, once a day, only if anyone is missing | Owners + supervisors | "3 people not marked by 10:00" / names (up to 5, then "+N") | `/` | `notmarked:<date>` | Phone + bell |

- Platform: the settings screen (`kindsFor`) must offer `scan` and `not_marked` to supervisors and `advance_given`
  / `desk_fix` to nobody but owners. New flag in `NOTIFICATION_KINDS`: `roles?: RoleId[]` (non-owners who may
  receive it in an owner-only module). `corrected` gets `aboutYou` as now; its label changes.
- All through `kit.notify`, the outbox and `kit.retryOutbox`. The morning job: `POST /api/cron/morning`
  (`CRON_SECRET`), called hourly 02:30–05:30 UTC (08:00–11:00 IST) from `evening.yml` (a second schedule line), which
  also retries the outbox. The Attendance step runs only on that morning line, Lab Records / Floor Stock only on the
  evening line (`github.event.schedule`; "Run workflow" by hand runs them all).

### Platform screens
- Role buttons (`roleChoices`): "Office staff · Attendance: marks for others, fixes times, advances (no salaries)"
  and "Supervisor · Attendance: Today board and IN / OUT alerts"; shown only when Attendance is switched on.
- Permissions screen: the two roles in the Attendance column; 🔔 for supervisors.
- Launcher tile: Office staff "Attendance desk"; Supervisor "Today board"; badges for both = the owner's "N in now /
  N not marked today / N no exit", never the claims badge (no money). One-module rule unchanged (Office staff +
  Document keeper sees the tile screen).
- **Tile "desk" view** (Phase 0 finding 2, owner 2026-10-17): the summary request's `view` becomes
  `"owner" | "staff" | "desk"`. The platform sends `desk` to a non-owner holding a role in `DESK_ROLES[module]`
  (`packages/types`, `attendance_salary: ["office_staff", "supervisor"]`); `verifySummaryRequest` accepts it; modules
  that don't know it treat it like `staff`. Workers' tiles stay without badges. CLAUDE.md contract wording in R6.
- `max_users` counts them like anyone else. SSO token unchanged (roles are already in it); only the summary request's
  `view` gains `desk`.

### Not in this version
Teams per supervisor; a supervisor fixing marks; Office staff entering claims, paying salary or seeing salaries;
phone-level scan alerts; weekly offs / leave in the not-marked count; a separate kiosk device login; Hindi / Odia.

## Database (shown to the owner before it runs)
SSO token unchanged. (Not a database change, but a contract change approved in Phase 0: the summary request's `view`
gains `"desk"`, R5.)

### Platform `0015_attendance_roles.sql`
```text
insert into platform.roles (id, module_id, label) values
  ('office_staff', 'attendance_salary', 'Office staff'),
  ('supervisor',   'attendance_salary', 'Supervisor');
```
No new table, no grant change (like `0013` / `0014`). This is a permissions change: it needs the owner's OK.

### Module `0005_field_staff.sql` (Phase C)
```text
salary_settings  (existing)
  + field_staff boolean not null default false
  + check: field_staff or (km_rate_paise is null and da_day_paise is null)   -- a TA / DA rate needs the tick
  backfill (once, in the migration): field_staff = true where km_rate_paise or da_day_paise is set
```
- The backfill runs as the migration owner; the app login `attendance_app` still has only SELECT + INSERT on
  `salary_settings` (grants unchanged). No new table, so the FORCE RLS guard count stays.
- It changes saved rows (only the new column): this needs the owner's OK when the migration is shown.

### Module `0006_desk_and_staff_type.sql` (R1)
```text
punches  (existing)
  ~ source check: 'scan' | 'owner' | 'desk'           -- 'owner' keeps meaning "a fix" (by owner or Office staff)
  + check: source <> 'desk' or (distance_m not null and accuracy_m not null and reason is null
                                and created_by <> user_id)

salary_settings  (existing; saved rows read as permanent)
  + staff_type text not null default 'permanent' check (staff_type in ('permanent', 'temporary'))

plant_settings  (existing; UPDATE already allowed)
  + not_marked_hour smallint null default 10 check (not_marked_hour between 8 and 11)   -- null = Off
```
- Replacing the `source` check drops and re-adds a constraint on an existing table; no rows change.
- Grants unchanged: `attendance_app` SELECT + INSERT on `punches` / `salary_settings`, UPDATE only on
  `plant_settings`. No new table, so the FORCE RLS guard count stays.

## Phases
Finish and test each phase before the next. Each ends with the tests of every touched app, `typecheck`, build and a
short dated note in `apps/attendance-salary/NOTES.md`.

| Phase | What | Result |
|---|---|---|
| **0** | Readiness ✅ 2026-10-17 | v0.22.0 live; plan checked against the code (findings 1–7 above; mock-ups and bell-only scan alert approved 2026-10-17) |
| **C** | Claims only for field staff, release v0.22.1 | My claims and sending claims only with a TA / DA rate; owner-entered claims still shown; deployed before R1 |
| **R1** | Roles, database, access | Both migrations, `isEmployee`, roles in `packages/types`, `Who` as a set, access rows, every "employee" use switched |
| **R2** | Office staff | `/desk`, Fix for Office staff, Office person page, advances, `advance_given`, `desk_fix` |
| **R3** | Supervisor | Today board read-only, `scan` alert, morning job + `not_marked`, Settings hour |
| **R4** | Permanent / Temporary | Salary box choice, tab split, tag, CSV, history line |
| **R5** | Platform screens | Role buttons, Permissions, launcher tiles + `desk` view badges, settings flag `roles` |
| **R6** | Release v0.23.0 | Docs, CLAUDE.md roles section, migrations on the live copy, deploy, owner's checklist |

### Phase 0: Readiness
- v0.22.0 committed, tagged and live.
- Re-read this plan against: `access.ts`, `session.ts`, `people.ts`, `notify.ts`, `marks.ts`, `fixes.ts`,
  `today.ts`, `salary-edit.ts`, `salary-tab.ts`, `src/lib/sessions.ts` (a `desk` mark must not show "changed"),
  `src/lib/salary.ts`, `packages/types` (`ROLE_MODULE`, `NOTIFICATION_KINDS`), platform `notifications.ts`
  (`recipientsFor`, `kindsFor`), `permissions.ts` (`roleChoices`), `launcher.ts`, `evening.yml`.
- Mock-ups and the bell-only scan alert: approved by the owner 2026-10-17 (done).
- Also re-read for Phase C: `db/migrations/0004_claims.sql`, `salary-edit.ts` and the Salary box,
  `src/server/claims.ts` (`hasFieldDutyRate`, `insertClaim`, `hasOwnClaims`, `myClaims`,
  the photo and withdraw rules), `src/app/my-tabs.tsx`, `src/app/my/claims/page.tsx`, `src/app/my/claims/new/page.tsx`,
  `src/app/api/claims/*`.
- Exit: the owner says "start". **Done 2026-10-17**: see "Phase 0 findings".

### Phase C: Claims only for field staff (v0.22.1)
- Migration `0005_field_staff.sql` (show it first; apply to dev + test).
- Salary box: the **Field staff** tick through `POST /api/salary/settings` (saved from a month like the rest); the TA /
  DA boxes only when ticked; a rate without the tick refused; history line "· field staff"; Recent changes.
- `src/server/claims.ts`: one helper for "may send own claims for this month" (= the tick in that month's setting;
  field duty also needs a rate, as now); `insertClaim` refuses a self-entered claim (field duty or expense, not an
  owner's entry) without it; `hasOwnClaims` = ticked this month or any claim on record; `myClaims` 404 on the same rule
  and returns `canAdd` per month; `/my/claims/new` 404 without the tick.
- Screens: My claims buttons only with `canAdd`; "Entered by <name>" on owner-entered claims (already there); the "Only the owner
  can add claims for you." line. No mock-up needed (the existing mock-up 2 minus the buttons; the tick is one line in
  the Salary box).
- HANDBOOK "Attendance: field duty and expenses": tick Field staff for the people who do field work; others see no
  claims. NOTES.md note; v0.22.1.
- Tests: the migration backfill (a row with a rate is ticked, one without is not) and the new check; the tick saved
  from a month leaves earlier months as they were; a rate without the tick refused; a worker not ticked gets no tab,
  404 on `/my/claims` and `/my/claims/new`, and 400 for an own field duty **and** an own expense (API, not just the
  screen); ticked: expense works, field duty works only with a rate; the owner's expense for a person not ticked is
  saved, approved, makes the tab appear and shows read-only with "Entered by <owner's name>"; a waiting claim sent before
  the tick was removed can still be withdrawn and decided; a tick only in an earlier month allows claims dated in that
  month (31-day rule unchanged); an owner who is also Plant staff is unaffected; UPDATE / DELETE on `salary_settings`
  still refused; the existing claims tests still pass.
- Check the Salary box and My claims at 390 px in headless Chrome on `pnpm dev` (worker ticked and not ticked, and
  with an owner entry).
- Release: ask before committing ("Release v0.22.1: claims only for field staff"), tag, push; ask before the live
  copy (migration `0005`, then deploy `attendance-salary`). Owner at plant 001: tick Field staff on Dillip and Kedar
  (already ticked if they have TA / DA rates); check nobody else is ticked; check a worker like Bindu has no My claims
  tab.

### Phase R1: Roles, database, access
- Both migrations (show them first; apply to dev + test).
- `packages/types`: `office_staff`, `supervisor` in the role list and `ROLE_MODULE`; `isEmployee`; the four kinds.
- Module: `Who` as a set; new access rows; `whoFor`, `people.ts`, `notify.ts` (no-salary count) use `isEmployee`.
- Tests: an Office-staff-only / Supervisor-only user is never on Today, Staff, the salary review or the not-salary
  count; the access table for every combination (Office + Plant staff, Supervisor + Plant staff, Office + Supervisor +
  Plant staff, owner + Plant staff);
  the new `punches` check (desk with reason refused, desk by self refused, desk without distance refused); the
  staff_type and hour checks; UPDATE / DELETE still refused; the platform knows both roles.

### Phase R2: Office staff
- `/desk` + `POST /api/desk/mark` (location rules, double tap, lock, not self); Fix open to Office staff (not self);
  the Office person page (no salary parts); `POST /api/salary/advances` for Office staff (7 days back, ₹1 lakh, has a
  salary setting, not self, correct own same day only); advances list + still to recover.
- `advance_given` and `desk_fix` to owners; `corrected` to the worker for Office staff fixes.
- Tests: every allowed and refused case above; salary URLs 404 for Office staff; a desk mark counts in the month like a
  scan and isn't "changed"; notification once each, none for the owner's own entries; audit + Recent changes ("by
  Ramesh (office)").
- Check `/desk`, the person page and Add advance at 390 px in headless Chrome with a faked location.

### Phase R3: Supervisor
- Today board for Supervisors (read-only) at `/` (the board loads its people through an internal helper, so
  `see_everyone` stays closed to them); `scan` after each saved mark (supervisors only, minus the marker);
  `POST /api/cron/morning` + `not_marked` at the plant's hour, counting the board's "Not marked" list; the Settings
  choice (mock-up 10); `evening.yml` morning line (Attendance step only on it).
- Tests: Supervisor refused everything but Today; scan alert to supervisors only, never to owners or the marker, not
  for refused scans; not-marked once per day, only when someone is missing, at the right hour, Off sends nothing,
  people who left not counted, counts exactly the board's "Not marked" people (incl. someone without a salary);
  outbox retry.
- Check the Today board at 390 px in headless Chrome.

### Phase R4: Permanent / Temporary
- Salary box choice through `POST /api/salary/settings`; history line; tab totals split and tag; CSV column.
- Tests: old rows read Permanent; the split equals the per-person sums for a mixed plant; CSV; a change from a month
  leaves earlier months as they were.
- Check the Salary box and tab at 390 px and 1280 px.

### Phase R5: Platform screens
- `roleChoices`, the Permissions screen, launcher tiles and badges, `kindsFor` with the `roles` flag; the summary
  request's `desk` view (`DESK_ROLES` in `packages/types`, platform launcher, `verifySummaryRequest` in
  `packages/auth`, Attendance's `summaryFor`).
- Tests: the `desk` view (Office staff / Supervisor tile gets in now / not marked / no exit and never the claims badge;
  a worker's tile still none; an owner's unchanged; another module given `desk` answers like `staff`; a bad `view`
  refused); the role buttons only with Attendance on; Office staff + Document keeper sees the tile screen; a Supervisor's
  settings list has `scan` / `not_marked` and nothing else from Attendance; an Office staff's has none (only
  `corrected` if also Plant staff); Permissions grid cells.

### Phase R6: Release v0.23.0
- NOTES.md (access table, desk marks, new kinds), CLAUDE.md (roles section, the summary request's `desk` view in
  "Other platform-signed tokens" / "Launcher tiles", dated status note), HANDBOOK
  ("Attendance: office desk and supervisor"), `docs/deployments/shared.md`; v0.23.0.
- Live, one step at a time with the owner's OK: platform `0015`, module `0006`, deploy `platform` and
  `attendance-salary`, `evening.yml`, checks.
- Owner at plant 001:
  1. give one office person Office staff + Plant staff, and one person Supervisor + Plant staff
  2. Office staff marks IN for a worker without a phone from the office; the supervisor's bell shows it
  3. Office staff fixes a wrong time; the owner's bell shows it; the worker gets "Your attendance was changed"
  4. Office staff gives an advance; the owner's phone buzzes; Office staff can't open the Salary tab
  5. next morning: the not-marked alert at the chosen hour
  6. set Temporary on the temporary workers; the Salary tab shows the split

## Build prompts
Paste **one** phase prompt into a new Claude Code session at `~/projects/plantops_platform`. Run them in order.

### Shared header (each phase prompt's first line points here; no need to paste it)
```text
We are adding two Attendance & Salary roles, Office staff and Supervisor, plus a Permanent / Temporary staff type, to
apps/attendance-salary and the platform. The agreed design is docs/ATTENDANCE_ROLES_PHASE_PLAN.md: read it fully,
plus CLAUDE.md, docs/ATTENDANCE_PHASE_PLAN.md, docs/SALARY_PHASE_PLAN.md, docs/SALARY_EXTRAS_PHASE_PLAN.md and
apps/attendance-salary/NOTES.md, before anything else. Follow the module's conventions (one access table in
src/server/access.ts, sessions.ts for worked time, 409 on stale changes, per-person lock, audit + Recent changes,
outbox, support view, whole paise). Apps import shared code only from packages/*.

Rules: start in plan mode and wait for my approval; show every migration before running it; ask before any change
to schema, permissions, tenant isolation or the SSO token that is not already in the plan; enforce access on the
server; only Plant staff (isEmployee) are tracked and paid; Office staff and Supervisors never see a salary, slip,
earned pay or claims (salary pages 404); nobody marks, fixes or gives an advance for themselves through the office
tools; nothing is ever updated or deleted in the marks and salary tables; no secrets in code, docs or tests. Write
tests with the feature (real Postgres test database). Explain each change in plain language; I am not a full-time
developer. At the end of the phase run the tests of every touched app, typecheck and build, and add a short dated
note to apps/attendance-salary/NOTES.md. Don't commit until I say so. Keep this version to what the plan lists.
Phase C (claims only for field staff, v0.22.1, migration 0005_field_staff.sql) is built and released before R1.
```

### Phase 0 prompt
```text
Before anything else, read the "Shared header" in docs/ATTENDANCE_ROLES_PHASE_PLAN.md (Build prompts section) and
follow it for this whole session.

Phase 0 only: change no code.
1. Tell me whether v0.22.0 is committed, tagged, pushed and live.
2. Re-check the plan against the code listed in its Phase 0; list anything that no longer matches and propose the
   edit.
3. The mock-ups and the bell-only scan alert were approved on 2026-10-17. Ask me about anything step 2 raised, one
   question at a time with a recommended answer.
4. Update the plan with my answers, then ask whether to start Phase C.
```

### Phase C prompt
```text
Before anything else, read the "Shared header" in docs/ATTENDANCE_ROLES_PHASE_PLAN.md (Build prompts section) and
follow it for this whole session.

Build Phase C (Claims only for field staff, v0.22.1) of docs/ATTENDANCE_ROLES_PHASE_PLAN.md, exactly as its "Claims
only for field staff" design section:
- apps/attendance-salary/db/migrations/0005_field_staff.sql exactly as the plan's Database section (the field_staff
  column, its check and the backfill). Show it first; after my OK apply it to dev and test.
- the "Field staff" tick in the Salary box, saved from a month; TA / DA boxes only when ticked
- a person sends their own claims (field duty and expense) only for a month where they are ticked, refused on the
  server; the My claims tab and page only when ticked this month or with a claim on record; owner-entered claims
  shown read-only with "Entered by <name>"
No platform or SSO token change, and no other schema change: if you find one is needed, stop and ask.
Tests: the Phase C list in the plan. Then check the Salary box and My claims at 390 px in headless Chrome on pnpm dev
(plant 002, temporary users and data, removed afterwards). Update HANDBOOK and NOTES.md, then ask me before
committing v0.22.1 and again before running migration 0005 and deploying attendance-salary on the live copy.
```

### Phase R1 prompt
```text
Before anything else, read the "Shared header" in docs/ATTENDANCE_ROLES_PHASE_PLAN.md (Build prompts section) and
follow it for this whole session.

Build Phase R1 (Roles, database, access) of docs/ATTENDANCE_ROLES_PHASE_PLAN.md:
- apps/platform/db/migrations/0015_attendance_roles.sql and
  apps/attendance-salary/db/migrations/0006_desk_and_staff_type.sql exactly as the plan's Database section. Show
  both first; after my OK apply them to dev and test.
- packages/types: the two roles, ROLE_MODULE, isEmployee, the four notification kinds.
- apps/attendance-salary: Who as a set of capacities, the new access rows, and every place that uses roleWorksIn to
  mean "employee" (session.ts, people.ts, notify.ts) switched to isEmployee. No new screens yet.
Tests: the Phase R1 list in the plan. Show me the list of cases before writing them.
```

### Phase R2 prompt
```text
Before anything else, read the "Shared header" in docs/ATTENDANCE_ROLES_PHASE_PLAN.md (Build prompts section) and
follow it for this whole session.

Build Phase R2 (Office staff) of docs/ATTENDANCE_ROLES_PHASE_PLAN.md, following mock-ups 1-4 and 8: /desk and
POST /api/desk/mark, Fix for Office staff, the Office person page without salary parts, advances for Office staff
with every rule in the plan, and the advance_given / desk_fix notifications through the outbox.
Tests: the Phase R2 list in the plan. Then on pnpm dev (plant 002, temporary users and data, removed afterwards)
check /desk, the person page and Add advance at 390 px in headless Chrome with a faked location.
```

### Phase R3 prompt
```text
Before anything else, read the "Shared header" in docs/ATTENDANCE_ROLES_PHASE_PLAN.md (Build prompts section) and
follow it for this whole session.

Build Phase R3 (Supervisor) of docs/ATTENDANCE_ROLES_PHASE_PLAN.md, following mock-ups 5, 6, 7 and 10: the read-only Today
board (home page /) for Supervisors, the scan notification, POST /api/cron/morning with the not_marked notification at the plant's
hour, the Settings choice, and the evening.yml schedule line.
Tests: the Phase R3 list in the plan. Then check the Today board at 390 px in headless Chrome on pnpm dev (temporary
data, removed afterwards).
```

### Phase R4 prompt
```text
Before anything else, read the "Shared header" in docs/ATTENDANCE_ROLES_PHASE_PLAN.md (Build prompts section) and
follow it for this whole session.

Build Phase R4 (Permanent / Temporary) of docs/ATTENDANCE_ROLES_PHASE_PLAN.md, following mock-up 9: the Staff type
choice in the Salary box and POST /api/salary/settings, the history line, the Salary tab split and tag, and the CSV
column. The salary rules in src/lib/salary.ts do not change.
Tests: the Phase R4 list in the plan. Then check the Salary box and tab at 390 px and 1280 px in headless Chrome.
```

### Phase R5 prompt
```text
Before anything else, read the "Shared header" in docs/ATTENDANCE_ROLES_PHASE_PLAN.md (Build prompts section) and
follow it for this whole session.

Build Phase R5 (Platform screens) of docs/ATTENDANCE_ROLES_PHASE_PLAN.md: the role buttons (roleChoices), the
Permissions screen, the launcher tiles and badges for Office staff and Supervisor (the summary request's "desk"
view, Phase 0 finding 2), and the roles flag in NOTIFICATION_KINDS used by kindsFor.
Tests: the Phase R5 list in the plan. Then check Manage users, Permissions and the launcher in headless Chrome at
390 px on pnpm dev (temporary users, removed afterwards).
```

### Phase R6 prompt
```text
Before anything else, read the "Shared header" in docs/ATTENDANCE_ROLES_PHASE_PLAN.md (Build prompts section) and
follow it for this whole session.

Phase R6 (Release v0.23.0) of docs/ATTENDANCE_ROLES_PHASE_PLAN.md:
1. Docs: NOTES.md, CLAUDE.md (the "Users and roles" section, the summary request's "desk" view and a dated status note), docs/HANDBOOK.md,
   docs/deployments/shared.md. Run every app's tests, typecheck and all builds.
2. Ask me before committing; then commit "Release v0.23.0: Office staff and Supervisor", tag v0.23.0 and push main.
3. Ask me before touching the live copy. Then, one step at a time with my OK: platform migration 0015, module
   migration 0006, production branch, deploy platform and attendance-salary, and the live checks.
4. Give me the owner's checklist for plant 001 from the plan and record what was verified in the deploy record.
```

### All phases prompt (one long session instead of the prompts above)
```text
Before anything else, read the "Shared header" in docs/ATTENDANCE_ROLES_PHASE_PLAN.md (Build prompts section) and
follow it for this whole session.

Build docs/ATTENDANCE_ROLES_PHASE_PLAN.md (Phase 0 if not done, then Phase C with its v0.22.1 release, then R1 to
R6), in order, in this session. For each
phase: enter plan mode, show me the plan for that phase only, wait for my approval, build it with its tests, run the
tests of every touched app, typecheck and build, add the dated NOTES.md note, then stop, give me a short
plain-language summary and ask whether to start the next phase. Show every migration before running it. Never
commit, push or touch the live copy without asking me at that moment. If the context gets long, finish the current
phase and tell me to start a new session with the next phase's prompt from the plan.
```
