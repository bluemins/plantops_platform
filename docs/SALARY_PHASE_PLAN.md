# Salary (Attendance & Salary, version 2): Phase Plan and Build Prompts

**Status:** Design agreed with the owner on 2026-10-16 (rules, overtime per person, checking panel, mock-ups):
- monthly salary per person; day's pay = salary ÷ 30; every day of the month counts (no weekly off)
- present = full / half day by the person's shift hours
- paid leave 2 per month, unused leave lapses
- overtime only for people the owner sets to "Gets overtime", at the owner's rate per hour
- advances ("credit") entered by the owner; advances above a month's pay carry into the next month
- an owner-only **Salary** tab with a **checking panel** (a calculator, nothing saved)
- **Paid** tick per person per month (added 2026-10-16): freezes that month's calculation; undo with a reason
- **Staff see salary only with the owner's permission** (added 2026-10-16): a per-person tick "Can see own salary"
  (off by default). With it on, the worker sees **their own** calculation for **months ticked Paid** only. Without
  it, staff see attendance only.

**Phase 0 done (2026-10-16):** every item that was *(to confirm)* is settled (see "Phase 0: Readiness").

It builds on Attendance version 1 (v0.18.0, `apps/attendance-salary`, `docs/ATTENDANCE_PHASE_PLAN.md`). To be
released as **v0.20.0** (v0.19.0 went to Floor Stock "Made from"). Each migration is still shown to the owner before
it runs (CLAUDE.md working rules).

**Mock-ups (approved basis, 2026-10-16):** https://claude.ai/artifact/AYP7ZJ5fhZ38m2aBT3f8mJ
1. Salary tab with the checking panel (PC) 2. Staff → person: Salary box and Advances (PC) 3. Salary tab (phone)
4. Checking panel (phone) 5. Worker's own calendar with overtime 6. Mark paid (owner) 7. Worker's own salary slip
(paid month, permission on).
Differences from the mock-ups agreed in this plan: the Salary box also has **Paid leave per month** (default 2) and
optional **Joined on / Last day** dates (confirmed in Phase 0).

## Purpose
At the end of the month the owner wants to see, per person, how many days they were present, half present and
absent, the paid leave used, the overtime hours, the salary earned, the advances already taken, and **how much is
still to be paid**. Today this is worked out by hand. The attendance marks are already in the app, so the numbers come
from them; nothing is typed twice. The owner can still check any figure with the checking panel.

## Names used in this plan
| Thing | Value |
|---|---|
| Module / app | `attendance_salary`, `apps/attendance-salary` on `:3006`, live `attendance.bluemins.life` |
| Database schema / login | `attendance_salary` / `attendance_app` (unchanged) |
| New migration | `apps/attendance-salary/db/migrations/0002_salary.sql` |
| New tables | `salary_settings`, `salary_advances`, `salary_visibility`, `salary_payments`, `salary_payment_undos` |
| Pure rules | `apps/attendance-salary/src/lib/salary.ts` (next to `sessions.ts`) |
| New notification kinds | `attendance_salary.salary_review` (owners), `attendance_salary.salary_paid` (the worker) |
| Release | v0.20.0 |

## Agreed design (owner, 2026-10-16)

### Who sees what
| | Owner (`tenant_admin`, with or without Plant staff) | Worker (Plant staff) | PlantOps support |
|---|---|---|---|
| Salary tab, salary settings, advances | yes, edit | **never** | read-only, logged on the owner's Support access page |
| Mark paid / undo paid; "Can see own salary" tick | yes | no | no |
| Salary CSV | yes (audited) | no | no |
| Own month: present / half / absent counts | — | yes | — |
| Own overtime hours | — | yes, **only if "Gets overtime"** that month | — |
| Own salary slip (how it was worked out) | — | **only if the owner ticked "Can see own salary" for this person AND the month is ticked Paid**; the frozen figures; their own only | — |
| Unpaid months' money, salary settings, other people | — | **never** | — |

Salary stays owner-only (CLAUDE.md, owner 2026-10-15) unless the owner gives a person permission, and then only for
that person's paid months (owner, 2026-10-16). Without permission a worker's app shows attendance only, with no
Salary section and no hint that one exists. All of this goes into the one access table
(`src/server/access.ts`), checked on the server; screens only hide what the table already refuses.

### The rules (one pure function, `src/lib/salary.ts`; nothing worked out is stored)
For one person and one calendar month (India dates):

1. **Counted days** = every day of the month that is **over** (today and later are not counted: an open month says
   "so far"), and inside the person's employment: from **Joined on** (blank = the first day of the first salary
   setting's month) to **Last day** (blank = still working). A person who has left (no longer active Plant staff)
   still appears on the Salary tab for every month they were on salary.
2. **Worked minutes per day** come from `sessions.ts` (`WorkDay.minutes`): complete blocks only. A "no exit" day
   counts 0 until the owner fixes it, so it shows as absent. The owner should fix missed OUTs before the month-end
   review (the review notification says how many are left).
3. **Day status** with the person's **shift hours** S:
   - **present** if worked ≥ S
   - **half day** if worked ≥ S ÷ 2 and < S
   - **absent** otherwise (including no marks at all)
4. **Absent days** = absent + 0.5 × half days.
5. **Paid leave used** = min(absent days, the person's paid leave per month; default 2). Unused leave **lapses**.
6. **Unpaid days** = absent days − paid leave used.
7. **Day's pay** = monthly salary ÷ 30 (always 30, whatever the month's length).
8. **Salary earned**:
   - **full month** (employed every day of the month): salary − unpaid days × day's pay. A full month with no
     unpaid days gives exactly the salary, whether the month has 28 or 31 days.
   - **part month** (joined or left during it): day's pay × (present + 0.5 × half days + paid leave used), never more
     than the monthly salary.
   - never below 0.
9. **Overtime** (only if "Gets overtime" in that month's setting): for each counted day, worked − S when positive;
   added up for the month. **Exact minutes** (owner, Phase 0: no rounding to 30-minute steps; 8 h 40 m on an 8 h
   shift = 40 minutes), shown as hours with up to 2 decimals. **Overtime pay** = hours × the person's rate. Without "Gets overtime": no hours, no pay, "—" on
   screens, and the extra hours only help reach a full day.
10. **Advances** = the sum of the person's advance entries dated in that month (corrections are negative entries).
11. **Carried in** = what the previous month left unpaid the other way round: if last month's remaining was below 0,
    that amount (as a positive number) is taken off this month. Worked out live month by month from the person's first
    salary month, so a fix in an old month flows through.
12. **Remaining to pay** = earned + overtime pay − advances − carried in ± adjustment from last month (rule 14). Below 0 → shown in red, "carries to
    <next month>".
13. **Money**: stored and worked out in whole paise (integers, like Order Capture). Day's pay, earned and overtime pay
    are rounded to the nearest paise once each; screens show the nearest rupee. Order Capture's helpers
    (`apps/order-capture/src/lib/money.ts`) are the model, but apps don't share code, so `salary.ts` has its own
    copy that also runs in the browser.
14. **Paid months are frozen.** Ticking Paid saves that month's full calculation (every input and result above, plus
    the advance entries and the rules version) as it stands at that moment. From then on:
    - the worker (with permission) and the Salary tab show the **frozen** figures for that month
    - the carry into the next month uses the frozen remaining (rule 11)
    - if something about that month changes later (an attendance fix, a back-dated advance or setting), the owner
      sees "Changed after payment: ₹X" on that month, and the difference (live remaining − frozen remaining, + or −)
      is added to the next month as **"Adjustment from <month>"**, once
    - Paid can be ticked from the last day of the month onwards (the last day itself is not over yet, so anything
      that day changes flows as an adjustment)
    - **Undo paid** (owner, reason ≥ 3) makes the month live again; the worker stops seeing it

**Worked example** (also a test): salary ₹12,000, shift 8 h, paid leave 2, overtime ₹60/h, October 2026 (31 days),
full month. 26 present, 2 half, 3 absent → absent days 4, paid leave 2, unpaid 2, day's pay ₹400, earned ₹11,200;
overtime 14 h → ₹840; advances ₹3,000; carried in 0 → **remaining ₹9,040**.

**Which setting applies:** each setting row has a **from month**. A month uses the newest row whose from month is on
or before it. Changing a salary "from November" leaves October's figures as they were. A person with no setting
for a month is **not on salary** that month and is left out of the Salary tab (listed under "No salary set").

### Owner: Staff → person page (`/staff/<user>`, below the calendar; mock-up 2)
- **Month summary strip:** present, half days, absent, paid leave used ("2 of 2"), overtime (or "—"), remaining.
- **Salary box:**
  - monthly salary (₹, > 0), shift hours a day (1–16, step 0.5; hint "full day ≥ 8 h · half day ≥ 4 h"), paid leave
    per month (0–10, step 0.5, default 2), **Gets overtime** tick box (off by default) with **overtime rate (₹ /
    hour)** shown and required only when ticked, **from month** (this month or a later one; an earlier month needs a
    reason, ≥ 3 characters), optional Joined on / Last day.
  - **Can see own salary** tick box (off by default; not tied to a month): "Shows <name> how their salary was
    worked out, for months you tick Paid." Saved on its own (new row, audited, Recent changes).
  - **History** list: "From Oct 2026: ₹12,000 · 8 h · overtime ₹60/h — bluemins, 1 Oct".
  - Saving is a new row (append-only); audited; shown in Recent changes. 409 if someone saved in between.
- **Advances · <month>:** list (date, amount, note, who), month total; **+ Advance** form: amount (₹, > 0), date
  (today by default; never in the future; not before the person's first salary month), note (≤ 200, optional).
  A **correction** is an entry linked to an earlier one, with a negative amount and a reason; it may not take more
  than what is left of that entry. Entries are never deleted or changed. Audited; Recent changes.

### Owner: Salary tab (`/salary?month=YYYY-MM`; mock-ups 1 and 3)
- New tab in the owner nav: Today · Staff · **Salary** · Recent changes · Settings.
- Month arrows (no months after the current one); pill "Month complete · 31 days" or "So far · 16 of 31 days".
- Four totals: salary earned, overtime pay, advances taken, **remaining to pay** (the sum of the positive
  remainders) with the negatives named ("Ramu −₹2,100 carries to November").
- Table, one row per person on salary: salary, present, half, absent, paid leave, OT hours, earned, OT pay,
  advances, carried in, **remaining**; a total row; "—" where there is no overtime; negative remaining in red.
  Wide table scrolls inside its box. On a phone: a list of people with a one-line summary and the remaining amount.
- "No salary set: <names>" under the table, linking to their Staff pages.
- **Paid column** (mock-up 6): per row a **Mark paid** button, or "✓ Paid 31 Oct" with **Undo**. Mark paid opens a
  confirm: "Mark Anmol's October salary as paid: ₹9,040", paid on (date, today by default, not in the future), note
  (optional: cash / UPI / bank), and the line "Anmol can see how it was worked out" or "Anmol sees attendance only
  (Can see own salary is off)". A negative remaining can be marked paid too (₹0 paid; the minus carries).
  Allowed from the last day of the month. 409 if already paid. Paid rows show the frozen figures; a paid month that
  changed since shows "Changed after payment: ₹X → next month".
- Totals add "Paid ₹X · still to pay ₹Y".
- **Download CSV** (`GET /api/salary/export?month=YYYY-MM`): one row per person with every column above plus shift
  hours and the overtime rate; owner only; audited; formulas neutralised.

### Owner: checking panel (mock-ups 1 and 4)
- Tapping a person on the Salary tab opens a side panel (full screen on a phone).
- Two columns: **Auto** (from the server) and **Yours** (editable boxes) for salary, present, half days, absent,
  paid leave days, overtime hours and rate (only for people with overtime), advances, carried in.
- Every change recalculates at once with **the same `salary.ts` functions** (imported into the client component,
  so the panel can never disagree with the server's rules), showing day's pay, unpaid days × day's pay, earned,
  overtime pay, advances, carried in, remaining (yours) and remaining (auto), and "Yours is ₹X more / less than auto"
  or "Matches the automatic figure".
- A line checks present + half + absent = the month's counted days ("… = 31 days ✓" or an amber warning).
- **Reset** and closing put the automatic figures back. **Nothing is saved or sent to the server.** No API.

### Worker: My attendance (mock-up 5)
- Above the calendar: present, half days, absent for the month; **overtime hours** only for people with "Gets
  overtime" that month.
- Calendar cells show the day's hours and "+2 h" overtime; half days and absent days get their own colour.
- No rupee amount, advance or salary setting on these screens.
- The owner's person calendar shows the same marks.

### Worker: My salary (only with permission; mock-up 7)
- Shown only when the owner ticked **Can see own salary** for this person. Otherwise there is no Salary link, page
  or API answer (404), and nothing on the screens hints at one.
- **My salary** (`/my/salary`): the person's months that are **ticked Paid**, newest first ("October 2026 · paid
  31 Oct · ₹9,040"). Unpaid months are not listed.
- **Salary slip** (`/my/salary/<YYYY-MM>`), the frozen figures only: monthly salary; present / half / absent; paid
  leave used of allowed; unpaid days × day's pay; salary earned; overtime hours × rate (only with overtime); each
  advance (date, amount, note); carried in; adjustment from last month; **paid amount, paid on, by whom**.
- Never another person's slip (404), never an unpaid or undone month, never the salary settings history.
- The owner turning permission off hides the slips again at once; turning it on shows all already-paid months.

### Notifications (N5+)
| # | Kind | When | Who | Title / body | Link | Dedupe key | Level |
|---|---|---|---|---|---|---|---|
| 4 | `attendance_salary.salary_review` | Daily job (07:00 IST) on the **last day of the month**, plants with at least one person on salary | Owners | "October salary review today" / "3 days with no exit to fix · 2 people without salary" (the parts that apply; "All set" otherwise) | `/salary?month=<YYYY-MM>` | `salary_review:<YYYY-MM>` (once per plant per month) | Phone + bell; not urgent; can be set to bell / off |

| 5 | `attendance_salary.salary_paid` | Owner ticks Paid, **only if the person has Can see own salary** | **The worker only** (`also_user_ids` + `only_listed`) | "Your October salary is paid" / "Tap to see how it was worked out" | `/my/salary/<YYYY-MM>` | `paid:<payment id>` | Phone + bell; not urgent; `aboutYou` |

#4 on the last day at 07:00 IST (confirmed in Phase 0). No notification for undo, for advances or for setting changes;
nothing about money ever reaches a worker without permission. Both kinds go into `NOTIFICATION_KINDS`, through
`kit.notify` and the existing outbox / `kit.retryOutbox`.

### Standard pieces
- **Recent changes:** salary set / changed, advance added, advance corrected, Can see own salary on / off, marked
  paid, paid undone (owner + support).
- **Support view:** Salary tab and person salary sections read-only, page views logged; every write refused.
- **Tile:** unchanged (no money on the launcher).
- **Backups:** no files; the five tables are in the nightly dump with the schema.

### Not in this version
Weekly offs and holidays; leave requests or leave types; printed / PDF payslips; partial payments during the month
(record those as advances); deductions other than advances (PF, ESI, TDS); salary in Hindi / Odia; a worker seeing an
unpaid month; "mark all as paid".

## Database (shown to the owner before it runs)
Migration `apps/attendance-salary/db/migrations/0002_salary.sql`. Five **new** tables; **no existing table changes**.
Platform database and SSO token unchanged.

```text
salary_settings  (append-only; the newest row for a person and from_month wins)
  id uuid pk, tenant_id uuid, user_id uuid, user_name text (1–100)
  from_month date            -- always the 1st of a month
  monthly_paise bigint       -- > 0, ≤ 1 crore rupees
  shift_minutes int          -- 60–960, a multiple of 30
  paid_leave_halfdays int    -- 0–20 (= 0–10 days in half days), default 4 (= 2 days)
  gets_overtime boolean
  ot_rate_paise int null     -- required (> 0) when gets_overtime, null otherwise
  joined_on date null, left_on date null   -- left_on ≥ joined_on
  reason text null           -- required (≥ 3) when from_month is before the current month (server rule)
  created_by uuid, created_by_name text, created_at timestamptz

salary_advances  (append-only)
  id uuid pk, tenant_id uuid, user_id uuid, user_name text
  on_date date
  amount_paise bigint        -- ≠ 0; > 0 for an advance, < 0 only for a correction
  note text null (≤ 200)
  corrects_id uuid null      -- the corrected entry (same plant, same person); required when amount < 0
  reason text null           -- required (≥ 3) when corrects_id is set
  created_by uuid, created_by_name text, created_at timestamptz

salary_visibility  (append-only; the newest row for a person wins; no row = off)
  id uuid pk, tenant_id uuid, user_id uuid, user_name text
  can_see boolean
  created_by uuid, created_by_name text, created_at timestamptz

salary_payments  (append-only; one row each time a month is ticked Paid)
  id uuid pk, tenant_id uuid, user_id uuid, user_name text
  month date                 -- the 1st of the paid month
  paid_on date               -- not in the future (server rule)
  paid_paise bigint          -- ≥ 0 (the remaining, or 0 when it was negative)
  remaining_paise bigint     -- the frozen remaining (may be < 0)
  figures jsonb              -- the frozen calculation: inputs, results, advance entries, rules version
  note text null (≤ 200)
  created_by uuid, created_by_name text, created_at timestamptz

salary_payment_undos  (append-only; once per payment)
  id uuid pk, tenant_id uuid, payment_id uuid (→ salary_payments, same plant), reason text (≥ 3, ≤ 300)
  created_by uuid, created_by_name text, created_at timestamptz
  unique (tenant_id, payment_id)
```
- At most one payment that is not undone per person and month: checked by the server inside a transaction with a
  per-person lock (as for marks), 409 otherwise.
- All five: `tenant_id` + ENABLE + **FORCE** row-level security + the `tenant_isolation` policy; `unique (tenant_id, id)`;
  `salary_advances (tenant_id, corrects_id)` references `salary_advances (tenant_id, id)`; indexes on
  `(tenant_id, user_id, from_month)` and `(tenant_id, user_id, on_date)`.
- `attendance_app`: SELECT, INSERT only (no UPDATE, no DELETE).
- `attendance_salary.salary_tenants()` (security definer, plant ids only) for the review job.
- The FORCE RLS guard test's table count goes from 6 to 11.

## Phases
Finish and test each phase before the next. Each phase ends with the tests of every touched app, `typecheck`, build,
and a short dated note in `apps/attendance-salary/NOTES.md`.

| Phase | What | Result |
|---|---|---|
| **0** | Readiness ✅ 2026-10-16 | v0.18.0 live and in use; this plan checked against the code; open items settled |
| **1** | Database, access, platform kinds | Migration 0002, access table rows, the two kinds in `packages/types` |
| **2** | The rules | `src/lib/salary.ts` pure functions + month / carry / frozen-month calculation from the database |
| **3** | Person page: salary and advances | Salary box with history, Gets overtime, Can see own salary, advances with corrections, Recent changes |
| **4** | Salary tab and checking panel | Month table, totals, phone list, CSV, the client-only checking panel |
| **5** | Paid and the worker's slip | Mark paid / undo, frozen figures, adjustments, My salary + slip with permission, salary_paid notification |
| **6** | Worker counts, review notification, support | Worker counts + overtime on the calendar, the review notification, support read-only |
| **7** | Release and deploy | Docs, v0.20.0, migration on the live copy, deploy, the owner's checklist at plant 001 |

### Phase 0: Readiness
- v0.18.0 committed, tagged and live (`docs/deployments/shared.md`); Attendance switched on at plant 001.
- Re-read this plan against the code: `sessions.ts` (`WorkDay.minutes`, India dates), `access.ts`, `calendar.ts`,
  `export.ts`, the Staff pages, `changes.ts`, `notify.ts` / outbox, `daily` cron route, `NOTIFICATION_KINDS`,
  `OWNER_ONLY_ALERTS`, Order Capture's paise helpers.
- The owner confirms or changes each *(to confirm)* item: support sees salary; Joined on / Last day; overtime in exact
  minutes vs 30-minute steps; an earlier "from month" needs a reason; the review notification's day and time.
- Exit: the owner says "start".

**Done 2026-10-16:**
- v0.18.0 and v0.19.0 committed, tagged and pushed; `production` = `b12380b` (v0.19.0); `attendance.bluemins.life/health`
  OK with the database. Attendance in use at plant 001 (owner).
- Checked against the code; changes made to this plan: release v0.20.0 (v0.19.0 was taken); five tables, not two;
  `salary.ts` gets its own paise helpers (apps don't share code); a worker's My attendance is `/`, an owner with
  Plant staff has it on `/my` (both use `my-month.tsx`); people who left stay on the Salary tab for their months.
- Owner's answers: Joined on / Last day **yes** (optional); overtime in **exact minutes**; support sees salary
  **read-only, logged**; an earlier from month **needs a reason**; review notification on the **last day at 07:00**.

### Phase 1: Database, access, platform kinds
- Migration `0002_salary.sql` (above); show it first; apply to dev + test.
- Access table: `salary_view` (owner, owner_worker, support), `salary_edit` and `salary_pay` (owner, owner_worker),
  `salary_export` (owner, owner_worker), `see_own_salary` (owner_worker, worker; and then only with permission +
  paid month, checked in the query); worker `see_own` unchanged.
- `packages/types`: `attendance_salary.salary_review` (owners) and `attendance_salary.salary_paid` (`aboutYou`, the
  worker) in `NOTIFICATION_KINDS`; neither urgent nor bell-only.
- Tests: isolation and the FORCE RLS guard over 11 tables; refusals for `attendance_app` (UPDATE / DELETE on all
  five new tables; database checks: overtime without rate, rate without overtime, from_month / month not the 1st,
  negative amount without corrects_id / reason, shift out of range, negative paid, a second undo); the access table
  per role; the platform settings page lists the new kinds.

### Phase 2: The rules
- `src/lib/salary.ts`, pure, no database, usable in the browser:
  - `dayStatuses(workDays, shiftMinutes, countedDates)` → present / half / absent per day + overtime minutes
  - `monthPay(input)` → absent days, paid leave used, unpaid, day's pay, earned, overtime hours / pay, remaining
  - `carryChain(months)` → carried in and adjustment per month, using the frozen remaining of paid months (rules
    11, 12, 14)
  - money in paise, rounding once per step (rule 13)
- `src/server/salary.ts`: load settings, advances and the person's marks + cancels for the needed months, run
  `sessions.ts` then `salary.ts`; one person or the whole plant; months from the first salary month up to the asked
  month (for the carry).
- Tests (pure): the worked example (₹9,040); exactly S minutes = present, S − 1 = half, S ÷ 2 − 1 = absent; a no-exit
  day = absent; 28 / 30 / 31-day months with no absence give the salary; paid leave 2 vs 0 vs 10; half days using half
  a leave; overtime off gives no hours even on 12 h days; overtime on 31 days; part month (joined on the 15th, left on
  the 10th); earned never below 0; carry from a negative month and no carry from a positive one; a chain of 3 months;
  a setting from November leaves October unchanged; today and future days not counted; a night shift counts on the
  day it started; rounding in paise; a paid month whose live figures changed gives one adjustment (+ and −) in the
  next month and the chain stays right after an undo.
- Tests (database): settings history pick, advances by India date, isolation.

### Phase 3: Person page: salary and advances
- `/staff/<user>`: month summary strip, Salary box + history, Can see own salary tick, Advances list + form +
  correction (mock-up 2).
- `POST /api/salary/settings`, `POST /api/salary/visibility` and `POST /api/salary/advances` (owner only; user id checked against the plant's
  people; the expected newest row sent back for a 409; amounts in rupees with up to 2 decimals → paise on the
  server; rules from the Database section).
- Audit + Recent changes texts: "Salary for Anmol from Nov 2026: ₹12,000 · 8 h · overtime ₹60/h",
  "Advance ₹2,000 to Anmol on 3 Oct: Cash", "Advance corrected −₹500 (Anmol, 12 Oct): typed twice".
- Tests: owner only (worker, store keeper, support refused); overtime rate required only when ticked; from month in
  the past needs a reason; future advance date refused; correction larger than what is left refused; correction of
  another person's entry refused; stale save 409; nothing ever updated or deleted; audit rows written.
- Check the page at 390 px and on a PC in headless Chrome.

### Phase 4: Salary tab and checking panel
- `/salary?month=` (owner + support read-only): totals, table, total row, "No salary set", phone list (mock-ups 1
  and 3); owner nav gets the **Salary** tab.
- Checking panel as a client component using `src/lib/salary.ts` (mock-ups 1 and 4); no API, nothing saved.
- `GET /api/salary/export?month=` CSV (owner, audited, formulas neutralised).
- Tests: the table numbers equal `monthPay` per person for a plant with mixed cases (full month, part month, no
  overtime, negative carry); people without a setting listed separately; months after the current one refused; CSV
  columns and owner-only; a worker gets 403 / 404 for every salary URL; the panel's calculation (pure, same function)
  for an edited overtime value gives the +₹120 example.
- Check both screens at 390 px and 1280 px in headless Chrome.

### Phase 5: Paid and the worker's slip
- Salary tab Paid column + confirm (mock-up 6): `POST /api/salary/pay` (person, month, paid on, note, the expected
  remaining; 409 if it changed or the month is already paid; allowed from the month's last day) saves the frozen
  `figures`; `POST /api/salary/pay/undo` (payment id, reason; once). Audited; Recent changes.
- Paid rows show the frozen figures, "Changed after payment: ₹X → next month" when the live figures differ, and the
  next month shows "Adjustment from <month>". Totals add Paid / still to pay.
- Worker `/my/salary` and `/my/salary/<YYYY-MM>` (mock-up 7): only with Can see own salary, only paid (not undone)
  months, only their own, from the frozen `figures`.
- `salary_paid` notification to the worker only, only with permission; through the outbox.
- Tests: pay owner-only; double pay 409; pay before the month's last day refused; future paid-on refused; undo once,
  then pay again allowed; the frozen figures don't move when an attendance fix comes later, and the adjustment shows
  next month; a worker without permission gets 404 on every salary URL and no "₹" anywhere; with permission they see
  only paid months, only their own (another person's month 404), and lose them at once when permission is turned
  off or the payment undone; notification sent only with permission, to the worker only, once per payment.
- Check the confirm and the slip at 390 px in headless Chrome.

### Phase 6: Worker counts, review notification, support
- Worker `/` and an owner-with-Plant-staff's `/my` (My attendance, both `my-month.tsx`): present / half / absent
  counts and overtime hours (only with Gets overtime); calendar cells with hours and "+N h" (mock-up 5); same on the
  owner's person calendar.
- `salary_review` in `src/server/notify.ts`, sent by the daily job on the last day of the month (`salary_tenants()`),
  with the number of unfixed no-exit days and people without a setting; outbox as for the other kinds.
- Support: Salary tab and salary sections read-only, views logged, every salary write refused.
- Tests: a worker never receives an amount on the attendance screens (page HTML and their APIs checked for "₹");
  overtime hidden for a worker without it; review sent once per plant per month, only on the last day, only to owners; outbox on 5xx; support
  writes refused and page views logged.

### Phase 7: Release and deploy
- `apps/attendance-salary/NOTES.md` (rules, tables, access table), CLAUDE.md dated status note (and Phase 8's line:
  salary built), `docs/HANDBOOK.md` "Attendance: salary at month end", `docs/deployments/shared.md`; v0.20.0.
- Live, one step at a time: migration 0002 on the shared copy (as for earlier module migrations, see HANDBOOK);
  deploy `attendance-salary` and `platform` (new kind) from `production`; checks: `/health`, the Salary tab 401 / 403
  for a worker session, the daily job with a wrong secret 401.
- Then the owner at plant 001:
  1. set salary, shift, paid leave and overtime for each person
  2. enter this month's advances
  3. open the Salary tab and check two people with the checking panel against the notebook
  4. a worker checks their calendar shows overtime and no money
  5. download the CSV
  6. at month end: the review notification arrives; fix any no-exit days; read "remaining to pay"
  7. tick Can see own salary for one person, mark their month Paid; they get the notification and see only their
     own slip; a person without the tick sees attendance only

## Build prompts
Paste **one** phase prompt, as it is, into a new Claude Code session at `~/projects/plantops_platform`. Its first
line makes the session read the shared header below. Each starts in plan mode and waits for approval. Run them in
order. The "All phases" prompt at the end does the same work in one long session, stopping after each phase.

### Shared header (each phase prompt's first line points here; no need to paste it)
```text
We are adding Salary (Attendance & Salary version 2) to the Attendance module of PlantOps (apps/attendance-salary,
v0.18.0). The agreed design is docs/SALARY_PHASE_PLAN.md (owner agreed on 2026-10-16; mock-ups at
https://claude.ai/artifact/AYP7ZJ5fhZ38m2aBT3f8mJ): read it fully, plus CLAUDE.md, apps/attendance-salary/NOTES.md
and docs/ATTENDANCE_PHASE_PLAN.md, before anything else. Follow the module's own conventions (one access table in
src/server/access.ts, sessions.ts for worked time, 409 on stale changes, audit + Recent changes, outbox, support
view, CSV) and Order Capture's money handling (whole paise). Apps import shared code only from packages/*.

Rules: start in plan mode and wait for my approval; show every migration before running it; ask before any change
to schema, permissions, tenant isolation or the SSO token that is not already in the plan; never trust tenant ids,
user ids, amounts' owners or dates from the browser; enforce access on the server; a worker sees money ONLY as
their own frozen salary slip for months ticked Paid AND only when the owner ticked "Can see own salary" for them
(otherwise attendance only, and salary URLs answer 404); never another person's attendance or salary; nothing worked
out is stored except the frozen figures of a paid month; nothing is ever
updated or deleted in the salary tables; no secrets in code, docs or tests. Write tests with the feature (real
Postgres test database). Explain each change in plain language; I am not a full-time developer. At the end of the
phase run the tests of every touched app, typecheck and build, and add a short dated note to
apps/attendance-salary/NOTES.md. Don't commit until I say so.

The salary rules live in ONE pure file, src/lib/salary.ts, used by the server, the CSV and the browser's checking
panel, so the numbers can never disagree. Keep this version to what the plan lists; no weekly offs, holidays, leave
requests, payslips or statutory deductions.
```

### Phase 0 prompt
```text
Before anything else, read the "Shared header" in docs/SALARY_PHASE_PLAN.md (Build prompts section) and follow it
for this whole session.

Phase 0 only: check readiness, change nothing.
1. Tell me whether v0.18.0 is committed, tagged, pushed and live (docs/deployments/shared.md, git), and whether
   plant 001 has Attendance switched on; if not, list what is left.
2. Re-check docs/SALARY_PHASE_PLAN.md against the current code: sessions.ts (WorkDay.minutes, India dates),
   access.ts, calendar.ts, export.ts, the Staff pages, changes.ts, notify.ts / outbox, the daily cron route,
   NOTIFICATION_KINDS / OWNER_ONLY_ALERTS, Order Capture's paise helpers. List anything that no longer matches and
   propose the edit.
3. List the "(to confirm)" items and ask me to confirm or change each, one question at a time with a recommended
   answer.
4. Update the plan with my answers (and the mock-ups if anything changes), then ask me whether to start Phase 1.
```

### Phase 1 prompt
```text
Before anything else, read the "Shared header" in docs/SALARY_PHASE_PLAN.md (Build prompts section) and follow it
for this whole session.

Build Phase 1 (Database, access, platform kinds) of docs/SALARY_PHASE_PLAN.md:
- apps/attendance-salary/db/migrations/0002_salary.sql exactly as the plan's Database section (five new tables,
  FORCE RLS, tenant_isolation policy, checks, the references for corrections and undos, indexes, salary_tenants(),
  SELECT + INSERT only for attendance_app). Show it to me first; after my OK apply it to dev and test.
- src/server/access.ts: the rows listed in the plan's Phase 1 (salary_view, salary_edit, salary_pay, salary_export,
  see_own_salary).
- packages/types: attendance_salary.salary_review (owners) and attendance_salary.salary_paid (the worker, aboutYou)
  in NOTIFICATION_KINDS; neither urgent nor bell-only.
Tests: isolation and the FORCE RLS guard over all 11 tables; every UPDATE / DELETE on the new tables refused for
attendance_app (list each statement); the database checks named in the plan; the access table per role (owner,
owner + plant staff, plant staff, store keeper, support); the platform's notification settings list the new kinds.
```

### Phase 2 prompt
```text
Before anything else, read the "Shared header" in docs/SALARY_PHASE_PLAN.md (Build prompts section) and follow it
for this whole session.

Build Phase 2 (The rules) of docs/SALARY_PHASE_PLAN.md:
- src/lib/salary.ts: pure functions with no database or Node-only imports (it must also run in the browser):
  dayStatuses, monthPay, carryChain, the paise helpers; every rule 1–13 of the plan's "The rules" section, with a
  comment pointing to the plan.
- src/server/salary.ts: load the settings history, the advances and the marks + cancels for the months needed, run
  sessions.ts then salary.ts, for one person or the whole plant, from the person's first salary month up to the asked
  month (for the carry). No new screens yet.
Tests: every pure case the plan lists for Phase 2 (start with the ₹9,040 worked example), and the database cases
(settings history pick, advances by India date, isolation). Show me the list of cases before writing them.
```

### Phase 3 prompt
```text
Before anything else, read the "Shared header" in docs/SALARY_PHASE_PLAN.md (Build prompts section) and follow it
for this whole session.

Build Phase 3 (Person page: salary and advances) of docs/SALARY_PHASE_PLAN.md, following mock-up 2:
- /staff/<user>: the month summary strip, the Salary box (monthly salary, shift hours, paid leave per month, Gets
  overtime + rate shown only when ticked, from month, and the other fields the plan confirmed in Phase 0) with its
  history, the "Can see own salary" tick (off by default, saved on its own), and Advances for the month with the
  + Advance form and corrections.
- POST /api/salary/settings, POST /api/salary/visibility and POST /api/salary/advances: owner only through the access table; the person must be
  one of the plant's people; rupees with up to 2 decimals turned into paise on the server; 409 when the newest row
  changed; every rule of the plan's Database section; audit rows and Recent changes texts as in the plan.
Tests: the Phase 3 list in the plan. Then check the page in headless Chrome at 390 px and 1280 px on pnpm dev with
plant 002 and temporary users, and remove the test data afterwards.
```

### Phase 4 prompt
```text
Before anything else, read the "Shared header" in docs/SALARY_PHASE_PLAN.md (Build prompts section) and follow it
for this whole session.

Build Phase 4 (Salary tab and checking panel) of docs/SALARY_PHASE_PLAN.md, following mock-ups 1, 3 and 4:
- the Salary tab in the owner nav and /salary?month=YYYY-MM: month arrows, Month complete / So far pill, the four
  totals, the table with a total row (scrolls inside its box), "—" without overtime, negatives in red with "carries
  to <month>", "No salary set" names, and the phone list layout
- the checking panel: a client component (side panel on a PC, full screen on a phone) with Auto and Yours columns,
  live recalculation with the SAME src/lib/salary.ts functions, the days check line, the difference line and Reset;
  no API call, nothing saved
- GET /api/salary/export?month=YYYY-MM: owner only, audited, formulas neutralised
- support sees the tab read-only
Tests: the Phase 4 list in the plan. Then check both screens in headless Chrome at 390 px and 1280 px on pnpm dev
(plant 002, temporary users and data, removed afterwards), including typing in the panel.
```

### Phase 5 prompt
```text
Before anything else, read the "Shared header" in docs/SALARY_PHASE_PLAN.md (Build prompts section) and follow it
for this whole session.

Build Phase 5 (Paid and the worker's slip) of docs/SALARY_PHASE_PLAN.md, following mock-ups 6 and 7:
- the Paid column and confirm on the Salary tab; POST /api/salary/pay (saves the frozen figures from
  src/lib/salary.ts; 409 if the remaining changed or the month is already paid; allowed from the month's last day)
  and POST /api/salary/pay/undo (reason, once); audit + Recent changes
- paid rows show the frozen figures and "Changed after payment: ₹X → next month"; the next month shows "Adjustment
  from <month>"; totals add Paid / still to pay
- worker /my/salary and /my/salary/<YYYY-MM>: only when the owner ticked "Can see own salary", only paid (not undone)
  months, only their own, built from the frozen figures; 404 in every other case
- attendance_salary.salary_paid to the worker only (also_user_ids + only_listed), only with permission, through the
  outbox
Tests: the Phase 5 list in the plan. Then on pnpm dev (plant 002, temporary users and data, removed afterwards):
mark a month paid for a worker with permission and one without, log in as each and show me what they see at 390 px.
```

### Phase 6 prompt
```text
Before anything else, read the "Shared header" in docs/SALARY_PHASE_PLAN.md (Build prompts section) and follow it
for this whole session.

Build Phase 6 (Worker counts, review notification, support) of docs/SALARY_PHASE_PLAN.md, following mock-up 5:
- worker's My attendance: present / half / absent counts and overtime hours (only with Gets overtime that month);
  calendar cells with the day's hours and "+N h"; the same on the owner's person calendar; never a rupee amount
- attendance_salary.salary_review in src/server/notify.ts, sent by POST /api/cron/daily on the last day of the month
  (India date) to owners, plants from salary_tenants(), with the unfixed no-exit days and people without salary;
  dedupe salary_review:<YYYY-MM>; through kit.notify and the existing outbox
- support: every salary page read-only with page views logged, every salary write refused
Tests: the Phase 6 list in the plan, including a check that no attendance page or API answer for a worker contains
"₹". On pnpm dev, run the daily job with a faked last-day date and show me the owner's bell.
```

### Phase 7 prompt
```text
Before anything else, read the "Shared header" in docs/SALARY_PHASE_PLAN.md (Build prompts section) and follow it
for this whole session.

Phase 7 (Release and deploy) of docs/SALARY_PHASE_PLAN.md:
1. Docs: apps/attendance-salary/NOTES.md (the rules, the five tables, the access table, what's not in this version),
   a dated CLAUDE.md status note (and Phase 8's line: salary built), docs/HANDBOOK.md "Attendance: salary at month
   end", docs/deployments/shared.md. Run every app's tests, typecheck and all builds.
2. Ask me before committing; then commit "Release v0.20.0: Salary", tag v0.20.0 and push main.
3. Ask me before touching the live copy. Then, one step at a time with my OK: migration 0002 on the shared copy,
   production branch, deploy attendance-salary and platform, and the live checks in the plan.
4. Give me the owner's checklist for plant 001 from the plan, and record what was verified in the deploy record.
```

### All phases prompt (one long session instead of the prompts above)
```text
Before anything else, read the "Shared header" in docs/SALARY_PHASE_PLAN.md (Build prompts section) and follow it
for this whole session.

Build the whole of docs/SALARY_PHASE_PLAN.md, phases 0 to 7, in order, in this session. For each phase: enter plan
mode, show me the plan for that phase only, wait for my approval, build it with its tests, run the tests of every
touched app, typecheck and build, add the dated NOTES.md note, then stop and give me a short plain-language summary
and ask whether to start the next phase. Show every migration before running it. Never commit, push or touch the
live copy without asking me at that moment. If the context gets long, finish the current phase and tell me to start
a new session with the next phase's prompt from the plan.
```
