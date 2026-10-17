# Salary extras (Attendance & Salary, version 3): Phase Plan and Build Prompts

**Status:** Asked by the owner on 2026-10-17 (after v0.20.1). The answers below and the five proposed items were
confirmed the same day, and the mock-ups approved. **Part A (per-day pay) built 2026-10-17, release v0.21.0;
Part B (claims) built 2026-10-17, release v0.22.0** (phase notes in `apps/attendance-salary/NOTES.md`).

Three additions to the salary built in version 2 (`docs/SALARY_PHASE_PLAN.md`, v0.20.0):
1. **Per-day workers:** some people are paid a **day rate** instead of a monthly salary, plus overtime as today.
2. **TA and DA for field duty:** **TA = ₹ per km travelled**, **DA = a fixed ₹ per field-duty day**, rates per person.
3. **Expenses:** money a person spent for the plant, repaid with that month's salary.

**Owner's answers (2026-10-17):**
- per day = **day rate × present days, half day = half the rate, absent = nothing, no paid leave**; overtime unchanged
- TA **per km**, DA **fixed per field-duty day**; rates **per person** in the Salary box (blank = none), from a month
- **the worker enters** km / field-duty days and expenses from the phone; **the owner approves**; only approved entries
  count
- a field-duty day **does not count as present**: attendance still comes only from the QR marks
- an expense can have an **optional photo** of the bill (the module starts storing files)

**Proposed in this plan, confirmed by the owner (2026-10-17):**
- **two releases:** v0.21.0 = per-day pay (Part A, small, no files); v0.22.0 = field duty (TA / DA) + expenses +
  photos (Part B)
- a worker may enter a claim **up to 31 days back**, never in the future; the owner any date from the person's first
  salary month
- a worker sees the amounts **they typed** (their own expenses) and the km on My claims, even without "Can see own
  salary"; the **TA / DA rupees** only on their salary slip (so only with the permission, for paid months)
- an owner who also holds Plant staff: **their own claims count as approved when entered**
- up to **3 photos per expense**, photos only (JPEG / PNG / WebP, shrunk on the phone), added within 24 h by whoever
  entered it while the claim is still waiting

**Mock-ups (approved by the owner 2026-10-17):** https://claude.ai/artifact/WJUENrcCJ2jj6WvubgnFu1
1. Owner · Salary box (Per day + TA / DA rates) 2. Worker · My claims 3. Worker · Add expense 4. Worker · Add field
duty 5. Owner · Claims (waiting) 6. Owner · Salary tab (phone) with TA / DA / Expenses 7. Worker · Salary slip.

## Names used in this plan
| Thing | Value |
|---|---|
| Module / app | `attendance_salary`, `apps/attendance-salary` on `:3006`, live `attendance.bluemins.life` |
| Database schema / login | `attendance_salary` / `attendance_app` (unchanged) |
| New migrations | Part A `0003_per_day_pay.sql`; Part B `0004_claims.sql` |
| Changed table | `salary_settings` (new columns, see Database) |
| New tables (Part B) | `salary_claims`, `salary_claim_decisions`, `salary_claim_files` |
| Pure rules | `src/lib/salary.ts` (extended; `RULES_VERSION` 2 in Part A, 3 in Part B) |
| New notification kinds (Part B) | `attendance_salary.claim_new` (owners), `attendance_salary.claim_decided` (the worker), `attendance_salary.storage` (owners) |
| New plan limit (Part B) | `limits.modules.attendance_salary.storage_mb` ("Attendance & Salary storage (MB)") |
| Releases | v0.21.0 (Part A), v0.22.0 (Part B) |

## Agreed design

### Part A: per-day workers
**Salary box** (`/staff/<user>`, mock-up 1): a new first choice **Pay: Monthly / Per day**.
- **Monthly:** exactly as today (monthly salary, paid leave per month, ÷ 30).
- **Per day:** **Day rate (₹)** replaces Monthly salary; **Paid leave per month is hidden and saved as 0**. Shift hours,
  Gets overtime + rate, from month, Joined on / Last day, reason for a past month: unchanged.
- Changing between Monthly and Per day is a new setting row "from <month>", like any change; earlier months keep
  their own basis.
- History line: "From Nov 2026: per day ₹450 · 8 h · overtime ₹60/h — bluemins, 1 Nov".

**Rules (new rule 15, `src/lib/salary.ts`):**
15. **Per-day pay:** earned = day rate × (present + ½ × half days), rounded to the paisa once. Absent days earn
    nothing; there is no paid leave and no full / part month difference (the counted days of rule 1 still limit the
    month to the employment). Day status (rule 3), overtime (rule 9), advances, carry, adjustment and paid months
    (rules 10–14) are unchanged. "Day's pay" on screens is the day rate.

**Worked example A** (also a test): day rate ₹450, shift 8 h, overtime ₹60/h, October 2026. 24 present, 2 half,
5 absent → earned 25 × ₹450 = ₹11,250; overtime 10 h → ₹600; advances ₹2,000 → **remaining ₹9,850**.

**Where it shows:**
- Salary tab table and phone list: a small "per day" tag beside the name; the Salary column shows "₹450 / day";
  "Paid leave" shows "—".
- Checking panel: "Day rate" instead of "Salary"; no paid-leave box; the same `monthPay` runs.
- CSV: new columns `pay_basis` (monthly / per_day) and `day_rate`; `monthly_salary` blank for per-day people.
- Salary slip: "26 present + 2 half days × ₹450 = ₹11,250" instead of the unpaid-days line.
- Paid months saved before this release keep showing as they were (their frozen figures have `rules: 1`).

### Part B: field duty (TA / DA) and expenses: "claims"
A **claim** is one entry a person sends for one date: either **Field duty** (km travelled + where; gives TA and DA)
or an **Expense** (amount + what for + optional bill photos). Only **approved** claims count, in the month of their
date.

**Salary box additions** (mock-up 1, both optional, from a month like the rest):
- **TA ₹ per km** (e.g. 3; up to 2 decimals, so ₹2.50 works)
- **DA ₹ per field-duty day** (e.g. 150)
- Both blank = this person gets no TA / DA and the worker sees no "+ Field duty" button for that month.
- The rates work the same for **Monthly and Per day** people (owner, 2026-10-17): anyone can get TA / DA. Worked
  example B is a monthly person.

**Worker: My claims** (`/my/claims`, mock-ups 2–4):
- A new tab beside My attendance (and My salary when allowed): **My attendance · My claims · My salary**. My claims is
  shown to anyone with a salary setting, whatever "Can see own salary" says.
- Month arrows; the month's claims, newest first, each with date, Field duty "42 km · Cuttack delivery" or Expense
  "₹450 · diesel for generator" (+ photo count), and its status: **Waiting**, **Approved**, **Not approved: <reason>**,
  **Withdrawn**, **Cancelled: <reason>**.
- **Withdraw** on a waiting claim (own only).
- **+ Field duty** (only when the month's setting has a TA or DA rate): date (today by default), km (0–9,999.9, one
  decimal; 0 allowed = DA only), where / what for (3–200 characters).
- **+ Expense:** date, amount (₹, > 0, up to ₹10 lakh), what for (3–200), up to 3 bill photos (shrunk on the phone to
  ≤ 1600 px JPEG, like Complaint Box; can be added later within 24 h while still waiting).
- Dates: not in the future, at most 31 days back, and only in a month the person has a salary setting.
- **One field-duty claim per person per date** (waiting or approved); a second one → 409 "You already sent field duty
  for 18 Oct". Expenses: as many as needed.
- No TA / DA rupee amount on this page (only km and days); the slip shows them, with permission.

**Owner: Claims tab** (`/claims`, mock-up 5):
- New owner tab with the waiting count: Today · Staff · Salary · **Claims (3)** · Recent changes · Settings.
- Filter Waiting (default) / Approved / Not approved / All, month arrows, person filter.
- Each claim card: person, date, kind, km → "TA ₹126 · DA ₹150" at that person's rates (or "no TA rate"), or the
  expense amount with photo thumbnails (tap → full photo), the note, who entered it and when.
- **Approve** (one tap) / **Not approve** (reason ≥ 3, required). An approved claim can be **Cancelled** later (reason).
- 409 "just changed by …" when two people act at once or the worker withdrew it meanwhile.
- **Person page** (`/staff/<user>`): a "Claims · <month>" section under Advances with the same list, plus **+ Field
  duty** and **+ Expense** for the owner to enter on the person's behalf; those are **approved at once** (any date from
  the person's first salary month up to today).

**Rules (new rules 16–19, `src/lib/salary.ts`):**
16. **TA** = (the month's approved field-duty km added up) × the month's TA rate per km, rounded to the paisa once.
    No TA rate that month → ₹0 (the claim still shows).
17. **DA** = the number of dates with an approved field-duty claim in the month × the month's DA per day. No DA rate →
    ₹0. A field-duty day **never** changes the day's attendance status.
18. **Expenses** = the month's approved expense amounts added up.
19. **Remaining to pay** = earned + overtime pay **+ TA + DA + expenses** − advances − carried in ± adjustment
    (rule 12 extended). Waiting, not approved, withdrawn and cancelled claims count 0.
- A claim approved or cancelled **after its month was paid** changes that month's live figures, so it shows as
  "Changed after payment: ₹X" and goes to the next month as "Adjustment from <month>" (rule 14, unchanged).
- Nothing worked out is stored; the frozen figures of a paid month also keep the list of claims that counted.

**Worked example B** (also a test): worked example from version 2 (monthly ₹12,000, remaining ₹9,040), plus in
October: field duty approved on 6 dates, 182 km in all, TA ₹3/km → ₹546; DA ₹150/day → ₹900; expenses approved ₹450
+ ₹1,200 = ₹1,650 (a waiting ₹300 and a not-approved ₹800 don't count) → **remaining ₹12,136**.

**Where else it shows:**
- **Salary tab** (mock-up 6): three new columns **TA**, **DA**, **Expenses** between OT pay and Advances; the phone
  list's summary line gets "TA ₹546 · DA ₹900 · Exp ₹1,650"; the totals strip adds "Claims ₹X"; a banner "3 claims
  waiting for October · Review" links to `/claims?month=…&status=waiting`.
- **Checking panel:** boxes for TA, DA and Expenses (₹), Auto and Yours, same arithmetic.
- **Mark paid:** when the person has waiting claims for that month: "2 claims for October are still waiting. Approve
  or reject them first; if you approve them later they come as an adjustment next month." Paying is still allowed.
- **CSV:** `field_duty_days`, `km`, `ta_rate`, `ta`, `da_rate`, `da`, `expenses`, `claims_waiting`.
- **Salary slip** (mock-up 7, frozen): "Field duty 6 days · 182 km", "TA 182 km × ₹3 = ₹546", "DA 6 days × ₹150 =
  ₹900", each expense (date, amount, what for), "Expenses ₹1,650".
- **Month-end review notification** body adds "N claims waiting".
- **Recent changes:** claim sent, approved, not approved, withdrawn, cancelled, entered by the owner, TA / DA rates in
  the salary history line ("… · TA ₹3/km · DA ₹150/day").

### Who sees what (Part B rows; Part A changes nothing here)
| | Owner (with or without Plant staff) | Worker (Plant staff) | PlantOps support |
|---|---|---|---|
| Send own claims, add photos, withdraw a waiting one | owner + Plant staff only (counts as approved) | yes, own only | no |
| My claims (own list, km, own typed amounts) | owner + Plant staff only | yes, own only | — |
| Claims tab, anyone's claims and photos | yes | **never** (404) | read-only, page and photo views logged |
| Approve / not approve / cancel; enter for someone | yes | no | no |
| TA / DA rupees | yes | only on own slip (permission + paid month) | read-only |

All of this goes into the one access table (`src/server/access.ts`): `claim_own` (owner_worker, worker), `claim_view`
(owner, owner_worker, support), `claim_decide` (owner, owner_worker). A photo is served only to its claim's person,
the owner or support (logged); every other request 404.

### Notifications (N5+, Part B)
| # | Kind | When | Who | Title / body | Link | Dedupe key | Level |
|---|---|---|---|---|---|---|---|
| 6 | `attendance_salary.claim_new` | A worker sends a claim (not the owner's own entries) | Owners | "Expense from Anmol: ₹450" / "Field duty from Anmol: 18 Oct, 42 km"; body = the note | `/claims?status=waiting` | `claim:<claim id>` | Phone + bell; not urgent; can be bell / off |
| 7 | `attendance_salary.claim_decided` | Owner approves, does not approve, or cancels a worker's claim | **The worker only** (`also_user_ids` + `only_listed`) | "Your expense on 18 Oct was approved" / "… was not approved: <reason>" / "… was cancelled: <reason>" | `/my/claims?month=<YYYY-MM>` | `decision:<decision id>` | Phone + bell; `aboutYou` |
| 8 | `attendance_salary.storage` | A photo upload passes 80 % / 95 % of the plan's storage | Owners | "Attendance storage 80 % full" | `/claims` | `storage:<80\|95>:<plan MB>` | Phone + bell |

No notification for a withdrawal or for the owner's own entries. Rupees reach the worker only as the amount they
typed themselves (#7 says "your expense on 18 Oct", no TA / DA amount). All through `kit.notify` and the existing
outbox / `kit.retryOutbox`.

### Standard pieces (Part B)
- **Files:** the shared `packages/module-kit/src/storage.ts` (local disk at `ATTEND_STORAGE_DIR`, or S3-compatible
  with `ATTEND_STORAGE_*`, the same as Complaint Box); type checked by content; ≤ 10 MB before shrinking; the plan's
  storage limit; private, served only through the module.
- **Backups:** `POST /api/cron/backup` with `backupNewFiles`, the five `BACKUP_*` variables on `attendance-salary`, a
  step in `backup.yml` (skipped until set); the three new tables are in the nightly dump with the schema.
- **Railway:** a volume at `/data` on `attendance-salary` (it has none today).
- **Support view:** Claims tab and photos read-only, views logged on the owner's Support access page.
- **Tile:** owner tile adds "N claims waiting" when there are any (no money on the launcher).

### Not in this version
Advance requests from workers; claims for another person by a worker; a mileage log per vehicle or GPS distance;
different km rates per vehicle; PDF bills (photos only); partial approval (not approve it and enter the right amount
instead); claims outside a salary month; "approve all"; DA or TA as a fixed monthly amount; claims in Hindi / Odia.

## Database (shown to the owner before it runs)
Platform database and SSO token unchanged in both parts.

### Part A: `0003_per_day_pay.sql`, one change to an existing table
```text
salary_settings  (existing; rows already saved become "monthly" and stay valid)
  + pay_basis text not null default 'monthly'   -- 'monthly' | 'per_day'
  + day_rate_paise int null                       -- > 0, ≤ ₹1 lakh a day
  ~ monthly_paise becomes nullable                -- its existing check (> 0, ≤ ₹1 crore) stays
  + check: (monthly  and monthly_paise not null and day_rate_paise null)
        or (per_day  and day_rate_paise not null and monthly_paise null and paid_leave_halfdays = 0)
```
- No data is rewritten; adding a column with a default doesn't touch the rows. Grants unchanged (SELECT + INSERT).
- This is the first change to an existing salary table; it needs the owner's OK like any schema change.

### Part B: `0004_claims.sql`, two more columns and three new tables
```text
salary_settings  (existing)
  + km_rate_paise int null      -- TA per km, > 0, ≤ ₹1,000
  + da_day_paise int null       -- DA per field-duty day, > 0, ≤ ₹1 lakh

salary_claims  (append-only; one row per claim, its details never change)
  id uuid pk, tenant_id uuid, user_id uuid, user_name text (1–100)
  kind text                     -- 'field_duty' | 'expense'
  on_date date
  km_tenths int null            -- field_duty only: 0–99,999 (= 0–9,999.9 km)
  amount_paise bigint null      -- expense only: > 0, ≤ ₹10 lakh
  note text                     -- 3–200 characters
  created_by uuid, created_by_name text, created_at timestamptz   -- created_by ≠ user_id = entered by the owner
  check: field_duty ↔ (km_tenths not null and amount_paise null); expense ↔ (amount_paise not null and km_tenths null)
  unique (tenant_id, id), unique (tenant_id, user_id, id)

salary_claim_decisions  (append-only; the newest decision is the claim's status; none = waiting)
  id uuid pk, tenant_id uuid, claim_id uuid (→ salary_claims, same plant)
  decision text                 -- 'approved' | 'rejected' | 'withdrawn' | 'cancelled'
  reason text null              -- required (3–300) for rejected and cancelled
  created_by uuid, created_by_name text, created_at timestamptz
  unique (tenant_id, claim_id) where decision in ('approved','rejected','withdrawn')   -- decided once
  unique (tenant_id, claim_id) where decision = 'cancelled'                            -- cancelled once

salary_claim_files  (append-only; bill photos)
  id uuid pk, tenant_id uuid, claim_id uuid (→ salary_claims, same plant)
  storage_key text, content_type text ('image/jpeg' | 'image/png' | 'image/webp'), size_bytes int (1 – 10 MB)
  created_by uuid, created_by_name text, created_at timestamptz
```
- Server rules (inside a transaction with the per-person lock, as for marks and payments): waiting → approved /
  rejected (owner) or withdrawn (the claim's own person); approved → cancelled (owner); no other move (409). One
  waiting-or-approved field-duty claim per person and date. At most 3 photos per claim, only on expenses.
- All three new tables: `tenant_id` + ENABLE + **FORCE** row-level security + the `tenant_isolation` policy;
  indexes on `(tenant_id, user_id, on_date)` and `(tenant_id, claim_id)`.
- `attendance_app`: SELECT, INSERT only (no UPDATE, no DELETE).
- The FORCE RLS guard test's table count goes from 11 to 14.

## Phases
Finish and test each phase before the next. Each phase ends with the tests of every touched app, `typecheck`, build,
and a short dated note in `apps/attendance-salary/NOTES.md`.

| Phase | What | Result |
|---|---|---|
| **0** | Readiness | v0.20.1 live; this plan checked against the code; open items settled ✅ 2026-10-17; mock-ups approved |
| **A1** | Per-day: database and rules ✅ 2026-10-17 | Migration 0003, rule 15, `RULES_VERSION` 2, server loading |
| **A2** | Per-day: screens ✅ 2026-10-17 | Salary box Pay choice, Salary tab, checking panel, CSV, slip |
| **A3** | Release v0.21.0 ✅ 2026-10-17 (live; owner step open) | Docs, migration on the live copy, deploy, the owner sets one per-day person |
| **B1** | Claims: database, access, platform ✅ 2026-10-17 | Migration 0004, access rows, three kinds, plan storage limit |
| **B2** | Claims: rules ✅ 2026-10-17 | Rules 16–19, `RULES_VERSION` 3, claims in the month calculation and frozen figures |
| **B3** | Worker: My claims ✅ 2026-10-17 | Tab, list, + Field duty, + Expense with photos, withdraw, claim_new notification |
| **B4** | Owner: Claims tab and rates ✅ 2026-10-17 | TA / DA rates in the Salary box, Claims tab, approve / not approve / cancel, owner entries, claim_decided |
| **B5** | Salary tab, slip, standard pieces ✅ 2026-10-17 | Columns, panel, CSV, mark-paid warning, slip, review count, tile, support, backup, storage notification |
| **B6** | Release v0.22.0 ✅ 2026-10-17 (live; owner checklist open) | Docs, volume + `BACKUP_*`, migration on the live copy, deploy, the owner's checklist |

### Phase 0: Readiness
- v0.20.1 committed, tagged and live (`docs/deployments/shared.md`).
- Re-read this plan against the code: `src/lib/salary.ts` (`SalarySetting`, `monthPay`, `panelInput`, `FrozenMonth`),
  `src/server/salary.ts`, `salary-edit.ts`, `salary-pay.ts`, `salary-slip.ts`, `salary-tab.ts`, `access.ts`,
  `my-tabs.tsx`, `owner-nav.tsx`, the Salary box, Complaint Box's file upload (`files.ts`, `storage.ts`, the phone
  shrinking), `backup.ts`, `MODULE_LIMIT_FIELDS`, `NOTIFICATION_KINDS`.
- The owner confirms or changes each *(to confirm)* item and approves the mock-ups.
- Exit: the owner says "start".

**Settled 2026-10-17:** the owner confirmed all five proposed items (two releases, 31 days back, what a worker sees,
an owner's own claims approved at once, 3 photos per expense), TA / DA for monthly people too, and approved the
mock-ups.

### Phase A1: Per-day: database and rules
- Migration `0003_per_day_pay.sql` (above); show it first; apply to dev + test.
- `src/lib/salary.ts`: `SalarySetting.payBasis` + `dayRatePaise`, `monthlyPaise` nullable; rule 15 in `monthPay`
  (`PayInput.payBasis`, `dayRatePaise`); `RULES_VERSION` 2; `FrozenMonth.setting` gains the two fields (a frozen
  month with `rules: 1` reads as monthly).
- `src/server/salary.ts` / `schema.ts`: load the new columns.
- Tests (pure): worked example A (₹9,850); present / half / absent at the shift edges; no paid leave even when a row
  says so; joined mid-month; overtime off; carry from a negative per-day month; a person switching Monthly → Per day
  from November leaves October unchanged; a `rules: 1` frozen month still renders. Tests (database): the new check
  refuses per-day without a rate, per-day with a monthly salary, per-day with paid leave, monthly without a salary;
  old rows still valid; UPDATE / DELETE still refused.

### Phase A2: Per-day: screens
- Salary box: Pay choice (mock-up 1, without the TA / DA rows), day-rate field, paid leave hidden for per day; the API
  (`POST /api/salary/settings`) takes `pay_basis` and `day_rate` and enforces the rules; history line.
- Salary tab and phone list ("per day" tag, "₹450 / day", leave "—"), checking panel (Day rate box, no leave box), CSV
  columns, salary slip line.
- Tests: the API rules per basis; the tab numbers equal `monthPay` for a plant with a monthly and a per-day person; CSV
  columns; the slip for a per-day paid month; the panel with a typed day rate.
- Check the Salary box, tab and slip at 390 px and 1280 px in headless Chrome.

### Phase A3: Release v0.21.0
- NOTES.md (rule 15, the changed table), CLAUDE.md dated status note, HANDBOOK "Attendance: salary at month end"
  (per-day people), `docs/deployments/shared.md`; v0.21.0.
- Live, one step at a time with the owner's OK: migration 0003 on the shared copy, deploy `attendance-salary`, checks.
- Owner at plant 001: set one per-day person, check the Salary tab with the checking panel against the notebook.

### Phase B1: Claims: database, access, platform
- Migration `0004_claims.sql` (above); show it first; apply to dev + test.
- `access.ts`: `claim_own`, `claim_view`, `claim_decide`.
- `packages/types`: the three kinds in `NOTIFICATION_KINDS` (`claim_decided` with `aboutYou`).
- Platform: "Attendance & Salary storage (MB)" in `MODULE_LIMIT_FIELDS`.
- Tests: isolation and the FORCE RLS guard over 14 tables; every UPDATE / DELETE on the new tables refused; the
  database checks (kind ↔ km / amount, note length, reason for rejected / cancelled, a second decision, a second
  cancel); the access table per role; the plan screen saves the new limit.

### Phase B2: Claims: rules
- `src/lib/salary.ts`: `PayInput` gains `taPaise`, `daPaise`, `expensesPaise` (worked out by a new pure
  `claimTotals(claims, setting)`: rules 16–18); rule 19 in `remainingPaise`; `RULES_VERSION` 3; `FrozenMonth` keeps
  the counted claims.
- `src/server/salary.ts`: load claims with their newest decision for the months needed.
- Tests (pure): worked example B (₹12,136); km with decimals (42.5 km × ₹3 = ₹127.50); km summed before rounding;
  two field-duty claims on one date count one DA day (the server stops this, the rule is safe anyway); no TA rate →
  ₹0; waiting / rejected / withdrawn / cancelled count 0; a claim approved after payment → one adjustment next month,
  and cancelled after that → the adjustment goes back; field duty doesn't change present / absent. Tests (database):
  status from the newest decision; claims by India date; isolation.

### Phase B3: Worker: My claims
- `/my/claims` and the tab (mock-ups 2–4); `POST /api/claims` (field duty / expense), `POST /api/claims/photo` (raw
  body, like Complaint Box), `POST /api/claims/withdraw`; date, rate and one-per-date rules; photos shrunk on the phone.
- `claim_new` to owners after the answer, through the outbox.
- Tests: worker only for own claims; future / 32-days-back / no-salary-month dates refused; field duty without a rate
  refused; second field duty on a date 409; photo type / size / count / 24 h / waiting-only / storage limit; withdraw
  own waiting only; another person's claim 404; no TA / DA "₹" on the page; notification once per claim, not for an
  owner's own entry.
- Check the three screens at 390 px in headless Chrome, with a real photo upload.

### Phase B4: Owner: Claims tab and rates
- Salary box TA / DA rates (mock-up 1) through `POST /api/salary/settings`; history line.
- `/claims` (mock-up 5) with the owner nav tab and count; `POST /api/claims/decide` (approve / reject + reason /
  cancel + reason; 409 on a stale or withdrawn claim); photo view; person page "Claims · <month>" with owner entries
  (approved at once).
- `claim_decided` to the worker only, through the outbox.
- Tests: owner only (worker, store keeper, support refused); every allowed and refused move; reason required; owner
  entries approved at once with no claim_new; audit + Recent changes; photo served to owner / own person / support
  (logged) only.
- Check the Claims tab and the Salary box at 390 px and 1280 px in headless Chrome.

### Phase B5: Salary tab, slip, standard pieces
- Salary tab columns, phone summary line, totals, waiting banner (mock-up 6); checking panel boxes; CSV columns;
  mark-paid warning; slip lines (mock-up 7); review notification count; tile badge; support read-only and logged;
  `POST /api/cron/backup` + `backup.yml` step; storage notification.
- Tests: the tab numbers equal `monthPay` with claims for a mixed plant; CSV; the warning only with waiting claims; the
  slip from frozen figures (and a `rules: 2` month without claim lines); review body; backup of claim photos (fake
  S3); support writes refused; storage 80 / 95 % once each.
- Check the Salary tab, the panel and the slip at 390 px and 1280 px in headless Chrome.

### Phase B6: Release v0.22.0
- NOTES.md (rules 16–19, tables, access rows), CLAUDE.md status note, HANDBOOK (claims), `docs/deployments/shared.md`;
  v0.22.0.
- Live, one step at a time with the owner's OK: volume `/data` on `attendance-salary`, `ATTEND_STORAGE_DIR` and the
  five `BACKUP_*` variables, migration 0004, deploy `attendance-salary` and `platform`, checks (`/health`, a worker
  session gets 404 on `/claims`, photo 404 without a session, backup with a wrong secret 401).
- Owner at plant 001:
  1. set TA / DA rates for the field staff
  2. a worker sends a field-duty claim and an expense with a bill photo from their phone; the owner's phone gets the
     notification
  3. approve one, do not approve the other; the worker gets each notification
  4. the Salary tab shows TA / DA / Expenses; check one person with the checking panel
  5. at month end: mark paid; the slip (with permission) shows the claims
  6. the next night's backup has the photo

## Build prompts
Paste **one** phase prompt, as it is, into a new Claude Code session at `~/projects/plantops_platform`. Its first
line makes the session read the shared header below. Each starts in plan mode and waits for approval. Run them in
order. The "All phases" prompts at the end do one part in one long session, stopping after each phase.

### Shared header (each phase prompt's first line points here; no need to paste it)
```text
We are adding Salary extras (Attendance & Salary version 3) to apps/attendance-salary (salary built in v0.20.0):
per-day pay (Part A) and field-duty TA / DA + expense claims with owner approval and bill photos (Part B). The agreed
design is docs/SALARY_EXTRAS_PHASE_PLAN.md (mock-ups at https://claude.ai/artifact/WJUENrcCJ2jj6WvubgnFu1): read it
fully, plus CLAUDE.md, docs/SALARY_PHASE_PLAN.md and apps/attendance-salary/NOTES.md, before anything else. Follow
the module's own conventions (one access table in src/server/access.ts, sessions.ts for worked time, 409 on stale
changes, audit + Recent changes, outbox, support view, CSV, whole paise) and Complaint Box's file handling
(packages/module-kit storage, raw-body upload, photos shrunk on the phone). Apps import shared code only from
packages/*.

Rules: start in plan mode and wait for my approval; show every migration before running it; ask before any change
to schema, permissions, tenant isolation or the SSO token that is not already in the plan; never trust tenant ids,
user ids, amounts' owners or dates from the browser; enforce access on the server; a worker sees only their own
claims and the amounts they typed, TA / DA rupees only on their own paid-month slip with "Can see own salary", and
never another person's attendance, claims, photos or salary (404); a field-duty day never changes attendance;
only approved claims count; nothing worked out is stored except the frozen figures of a paid month; nothing is ever
updated or deleted in the salary tables; no secrets in code, docs or tests. Write tests with the feature (real
Postgres test database). Explain each change in plain language; I am not a full-time developer. At the end of the
phase run the tests of every touched app, typecheck and build, and add a short dated note to
apps/attendance-salary/NOTES.md. Don't commit until I say so.

The salary rules live in ONE pure file, src/lib/salary.ts, used by the server, the CSV and the browser's checking
panel, so the numbers can never disagree. Keep this version to what the plan lists.
```

### Phase 0 prompt
```text
Before anything else, read the "Shared header" in docs/SALARY_EXTRAS_PHASE_PLAN.md (Build prompts section) and
follow it for this whole session.

Phase 0 only: check readiness, change nothing.
1. Tell me whether v0.20.1 is committed, tagged, pushed and live (docs/deployments/shared.md, git).
2. Re-check docs/SALARY_EXTRAS_PHASE_PLAN.md against the code listed in its Phase 0. List anything that no longer
   matches and propose the edit.
3. The proposed items were confirmed on 2026-10-17; list anything new the check in step 2 raised and ask me about
   each, one question at a time with a recommended answer. Ask whether the mock-ups are approved.
4. Update the plan with my answers, then ask me whether to start Phase A1.
```

### Phase A1 prompt
```text
Before anything else, read the "Shared header" in docs/SALARY_EXTRAS_PHASE_PLAN.md (Build prompts section) and
follow it for this whole session.

Build Phase A1 (Per-day: database and rules) of docs/SALARY_EXTRAS_PHASE_PLAN.md:
- apps/attendance-salary/db/migrations/0003_per_day_pay.sql exactly as the plan's Part A database section. Show it to
  me first; after my OK apply it to dev and test.
- src/lib/salary.ts: pay basis + day rate in SalarySetting, PayInput and FrozenMonth; rule 15 in monthPay;
  RULES_VERSION 2; a frozen month with rules 1 reads as monthly.
- src/server/salary.ts and schema.ts load the new columns. No new screens yet.
Tests: the Phase A1 list in the plan (start with worked example A, ₹9,850). Show me the list of cases before writing
them.
```

### Phase A2 prompt
```text
Before anything else, read the "Shared header" in docs/SALARY_EXTRAS_PHASE_PLAN.md (Build prompts section) and
follow it for this whole session.

Build Phase A2 (Per-day: screens) of docs/SALARY_EXTRAS_PHASE_PLAN.md, following mock-up 1 (without the TA / DA rows)
and mock-up 6's "per day" row:
- the Salary box Pay choice (Monthly / Per day), day rate, paid leave hidden for per day; POST /api/salary/settings
  takes pay_basis and day_rate and enforces the plan's rules; the history line
- the Salary tab table and phone list, the checking panel, the CSV columns and the salary slip for per-day people
Tests: the Phase A2 list in the plan. Then check the screens in headless Chrome at 390 px and 1280 px on pnpm dev
(plant 002, temporary users and data, removed afterwards).
```

### Phase A3 prompt
```text
Before anything else, read the "Shared header" in docs/SALARY_EXTRAS_PHASE_PLAN.md (Build prompts section) and
follow it for this whole session.

Phase A3 (Release v0.21.0) of docs/SALARY_EXTRAS_PHASE_PLAN.md:
1. Docs: NOTES.md, a dated CLAUDE.md status note, docs/HANDBOOK.md (per-day people), docs/deployments/shared.md. Run
   every app's tests, typecheck and all builds.
2. Ask me before committing; then commit "Release v0.21.0: per-day pay", tag v0.21.0 and push main.
3. Ask me before touching the live copy. Then, one step at a time with my OK: migration 0003 on the shared copy,
   production branch, deploy attendance-salary, and the live checks.
4. Give me the owner's step for plant 001 from the plan and record what was verified in the deploy record.
```

### Phase B1 prompt
```text
Before anything else, read the "Shared header" in docs/SALARY_EXTRAS_PHASE_PLAN.md (Build prompts section) and
follow it for this whole session.

Build Phase B1 (Claims: database, access, platform) of docs/SALARY_EXTRAS_PHASE_PLAN.md:
- apps/attendance-salary/db/migrations/0004_claims.sql exactly as the plan's Part B database section (two columns,
  three new tables, FORCE RLS, tenant_isolation, checks, the two partial unique indexes, references, indexes, SELECT
  + INSERT only for attendance_app). Show it to me first; after my OK apply it to dev and test.
- src/server/access.ts: claim_own, claim_view, claim_decide.
- packages/types: attendance_salary.claim_new, attendance_salary.claim_decided (aboutYou), attendance_salary.storage.
- apps/platform: "Attendance & Salary storage (MB)" in MODULE_LIMIT_FIELDS.
Tests: the Phase B1 list in the plan (list each refused UPDATE / DELETE statement).
```

### Phase B2 prompt
```text
Before anything else, read the "Shared header" in docs/SALARY_EXTRAS_PHASE_PLAN.md (Build prompts section) and
follow it for this whole session.

Build Phase B2 (Claims: rules) of docs/SALARY_EXTRAS_PHASE_PLAN.md:
- src/lib/salary.ts: claimTotals (rules 16–18), TA / DA / expenses in PayInput and the remaining (rule 19),
  RULES_VERSION 3, the counted claims in FrozenMonth
- src/server/salary.ts: claims with their newest decision for the months needed. No new screens yet.
Tests: the Phase B2 list in the plan (start with worked example B, ₹12,136). Show me the list of cases before writing
them.
```

### Phase B3 prompt
```text
Before anything else, read the "Shared header" in docs/SALARY_EXTRAS_PHASE_PLAN.md (Build prompts section) and
follow it for this whole session.

Build Phase B3 (Worker: My claims) of docs/SALARY_EXTRAS_PHASE_PLAN.md, following mock-ups 2, 3 and 4:
- the My claims tab and /my/claims; POST /api/claims, POST /api/claims/photo (raw body, Complaint Box's checks and
  phone shrinking, the plan's storage limit), POST /api/claims/withdraw; every date, rate, one-per-date and photo rule
  of the plan
- attendance_salary.claim_new to owners after the answer, through the outbox
Tests: the Phase B3 list in the plan. Then on pnpm dev (plant 002, temporary users and data, removed afterwards) send
a field-duty claim and an expense with a real photo at 390 px in headless Chrome and show me the screens.
```

### Phase B4 prompt
```text
Before anything else, read the "Shared header" in docs/SALARY_EXTRAS_PHASE_PLAN.md (Build prompts section) and
follow it for this whole session.

Build Phase B4 (Owner: Claims tab and rates) of docs/SALARY_EXTRAS_PHASE_PLAN.md, following mock-ups 1 and 5:
- TA per km and DA per field-duty day in the Salary box and POST /api/salary/settings; the history line
- the Claims tab with its count, /claims with filters, POST /api/claims/decide (approve / not approve with reason /
  cancel with reason; 409 on a stale or withdrawn claim), the photo view, the person page's Claims section with owner
  entries (approved at once); audit + Recent changes
- attendance_salary.claim_decided to the worker only (also_user_ids + only_listed), through the outbox
Tests: the Phase B4 list in the plan. Then check the Claims tab and the Salary box in headless Chrome at 390 px and
1280 px on pnpm dev (temporary data, removed afterwards).
```

### Phase B5 prompt
```text
Before anything else, read the "Shared header" in docs/SALARY_EXTRAS_PHASE_PLAN.md (Build prompts section) and
follow it for this whole session.

Build Phase B5 (Salary tab, slip, standard pieces) of docs/SALARY_EXTRAS_PHASE_PLAN.md, following mock-ups 6 and 7:
- TA / DA / Expenses on the Salary tab (table, phone line, totals, waiting banner), the checking panel boxes, the CSV
  columns, the mark-paid warning, the slip lines from the frozen figures
- the review notification's "N claims waiting", the tile badge, support read-only with views logged
- POST /api/cron/backup with backupNewFiles and the backup.yml step (skipped until set); the storage notification
Tests: the Phase B5 list in the plan. Then check the Salary tab, panel and slip in headless Chrome at 390 px and 1280
px on pnpm dev (temporary data, removed afterwards).
```

### Phase B6 prompt
```text
Before anything else, read the "Shared header" in docs/SALARY_EXTRAS_PHASE_PLAN.md (Build prompts section) and
follow it for this whole session.

Phase B6 (Release v0.22.0) of docs/SALARY_EXTRAS_PHASE_PLAN.md:
1. Docs: NOTES.md (rules 16–19, tables, access rows), a dated CLAUDE.md status note, docs/HANDBOOK.md (claims),
   docs/deployments/shared.md. Run every app's tests, typecheck and all builds.
2. Ask me before committing; then commit "Release v0.22.0: field duty and expense claims", tag v0.22.0 and push main.
3. Ask me before touching the live copy. Then, one step at a time with my OK: the volume and variables on
   attendance-salary, migration 0004 on the shared copy, production branch, deploy attendance-salary and platform, and
   the live checks in the plan.
4. Give me the owner's checklist for plant 001 from the plan, and record what was verified in the deploy record.
```

### All phases prompts (one long session per part instead of the prompts above)
```text
Before anything else, read the "Shared header" in docs/SALARY_EXTRAS_PHASE_PLAN.md (Build prompts section) and
follow it for this whole session.

Build Part A of docs/SALARY_EXTRAS_PHASE_PLAN.md (Phase 0 if not done, then A1 to A3), in order, in this session.
For each phase: enter plan mode, show me the plan for that phase only, wait for my approval, build it with its tests,
run the tests of every touched app, typecheck and build, add the dated NOTES.md note, then stop and give me a short
plain-language summary and ask whether to start the next phase. Show every migration before running it. Never commit,
push or touch the live copy without asking me at that moment. If the context gets long, finish the current phase and
tell me to start a new session with the next phase's prompt from the plan.
```
For Part B, use the same prompt with "Part B … B1 to B6" in place of "Part A … A1 to A3".
