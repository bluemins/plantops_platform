# PlantOps – Stability plan

Started 2026-10-17 by the owner: the important modules are built (v0.25.0 live), so the next stretch is stability and
bug fixing, **then** new features. This file is the plan, the bug list, the live checklist and the feature order;
update it as items close.

**Rules while this plan runs:**
- Bugs first (section 4), in the order given; features only after the "Fix now" bugs are closed (section 10).
- Fixes ship as small patch releases (v0.25.1, v0.25.2 …), each tried on a phone before the next one starts.
- Ask before any schema, permission, tenant-isolation or SSO-token change (CLAUDE.md working rules).

---

## 1. Where things stand (checked 2026-10-17, evening)

- **Live:** platform + 7 modules, v0.25.0; `production` = `1ea1c09`, deploy record written (`a19a74d`). All 8 addresses
  answer 200 in about 0.3 s from India. Postgres 18.6, database 16 MB, `max_connections` 500.
- **One plant only:** 001 Bluemins, all modules switched on (Marketing Contacts too, which has no app yet).
- **Tests:** about 1,900, all passing, but run only by hand. Nothing watches the live copy (no uptime check, no error
  reporting).
- **GitHub jobs:** green since 14 Oct, but **started very late or skipped** (bug B-01).

---

## 2. Plant 001 usage (read-only check of the live database, 2026-10-17)

How it was measured: `plantops_backup` login, read-only transactions, counts only (no customer data copied out).

**People:** 17 users (1 owner); 14 hold Plant staff; 7 Order desk, 6 Store keeper, 6 Complaint desk, 3 Lab lead,
1 Office staff, 1 Supervisor. 5 users created on 17 Oct have **never logged in** (sushil, maheswar, joshobanti,
Damayanti, plus bluemins_doc from 4 Oct). 3 people have phone notifications on (4 phones).

**Activity, last 7 days (module opens from the launcher / home-screen icon):**

| Module | Opens | People | What the data shows |
|---|---|---|---|
| Order Capture | 200 | 7 | 33 orders since 13 Oct (23 delivered, 8 pending, 2 cancelled), 347 customers uploaded, 18 changes, 4 later notes; 19 WhatsApp thank-yous sent, 2 failed on 14 Oct (Twilio token, fixed since); 4 orders pending > 2 days |
| Attendance & Salary | 123 | 8 | Only 12 marks so far (4 people on 17 Oct, of 14 Plant staff); 20 salary settings, 5 advances, 2 claims; no month paid yet (first month end 31 Oct). **Circle widened to 2,000 m**; marks accepted at 1,008 m and 1,749 m with 200–500 m accuracy |
| Floor Stock | 100 | 7 | Counts on 7 of 10 days since 8 Oct (none on 15 Oct); 15 versions for 7 counts; 17 Oct needed 5 versions; Can make set up (16 recipes) |
| Complaint Box | 36 | 6 | 8 complaints, 5 still open after 5 days, 2 resolved; 4 photos |
| Document Store | 15 | 6 | 12 documents; **1 expired since 31 Mar 2026**; every reminder email failed (Brevo, bug B-02; email since dropped) |
| Lab Records | 6 | 3 | 1 batch, 1 entry (5 Oct): **not in use**, yet "no tests today" alerts go out daily |
| Job applications | 1 | 1 | 5 openings, no applications yet (live since 17 Oct) |

**Logins:** 132 platform sessions in 7 days, only 32 ended by logout. Dillip logged in 17 times in 2 days, Gaja 11,
Anmol 9 within 2 hours (bug B-03).

**Notifications (7 days):** 296 rows; 70–93 % still unread in every module. Biggest: new order 105, low stock 32,
complaint new 26 + still open 25, Lab "no tests today" 16 for an unused module (bug B-07).

**Test entries in real data:** undo-delivered reasons "ccxc", "fddf", "sdasdas", "Test"; count corrections "wewewe",
"jkjkjk"; attendance cancels "Test" ×3. Because these tables are append-only they stay forever (bug B-06).

---

## 3. Phases

| Phase | What | Who | When |
|---|---|---|---|
| S0 | Housekeeping (no code) | Owner + Claude | now |
| S1 | **Fix now** bugs B-01 … B-07 | Claude + owner checks | this week |
| S2 | Safety nets: tests on every push, uptime checks, error reporting | Claude (owner approves) | this week, after B-01 |
| S3 | Live check of every "Not yet verified" item | Owner on phones + Claude read-only | next 2 weeks |
| S4 | Analyse each module (code, access, data, logs, phone) | Claude, one module per session | next 2 weeks |
| S5 | Performance and uptime: measure, then fix | Claude | after S2 |
| S6 | Routine from then on | Owner + Claude | weekly / monthly |
| F | New features, in the order of section 10 | — | after S1 (Attendance leave before 31 Oct) |

---

## 4. Bugs, in priority order

Severity: **S1** wrong data, data leak, money wrong or an alert never arrives — fix at once; **S2** a feature broken
or unreliable — this week; **S3** confusing, slow or cosmetic — a later patch.

### Fix now (S1)

**B-01 · All modules · S1 · Scheduled jobs start hours late or not at all.**
- *Evidence:* Daily jobs, due 07:00 IST, started at 11:30–14:05 IST every day (5–7 h late). Evening jobs are
  scheduled 7 times a day (17:00–23:00 IST) but GitHub ran only 2 a day. The Attendance morning slots (08:00–11:00
  IST) **never ran**: 0 "not marked" alerts since v0.23.0.
- *Effect:* "no exit" and document-expiry alerts come at noon; the not-marked alert never comes; the 8 pm count
  reminder and Lab 8 pm reminder arrive whenever one of the two evening runs happens (the code catches up: each job
  checks "hour has passed", so nothing is lost, only late).
- *Fix:* move the timing off GitHub's scheduler. Options: (a) **cron-job.org** (free) calling each `/api/cron/*`
  with the `CRON_SECRET` header at the exact minute; (b) a small Railway cron service. Keep GitHub only for the
  nightly backup (its lateness doesn't matter). Recommend (a): no code, just the job list. Check one week of start
  times afterwards.
- *Also found (2026-10-18):* several "evening" runs started after midnight (01:07, 01:28, 01:47 IST), when it is
  already the next India day, so they did nothing at all. Each job call takes 0–2 s (cron-job.org waits 30 s).
- *Done (2026-10-18, Claude):* cron-job.org chosen. Job list (11 jobs, minute :01 so a call never lands just before
  the hour) in HANDBOOK section 10; DEPLOY.md and the deploy record updated. `daily.yml` keeps its schedule as a
  safety net (every job is dedupe-safe, so a second call adds nothing); `evening.yml` becomes Run-workflow only,
  committed once the cron-job.org jobs are confirmed (so the evening reminders never have a gap).
- [ ] *Owner:* create the 11 jobs on cron-job.org, Test run each (200).
- [ ] *Claude:* commit the manual-only `evening.yml` after the first good cron-job.org evening.
- [ ] *Claude, after 7 days (read-only):* start times of the timed notifications (`platform.notifications.created_at`
  for `attendance_salary.no_exit` / `not_marked`, `floor_stock.count_missing`, `lab_records.no_tests_today`,
  `document_store.expiry`, `complaint_box.still_open`) within 5 minutes of their hour; then close B-01.

**B-02 · Document Store · S1 · Reminder emails have never been delivered → email dropped.**
- *Evidence:* every reminder row `failed`: "Brevo 401 … unrecognised IP address". Brevo blocks API calls from IP
  addresses it hasn't seen, and Railway's addresses change.
- **Decided by the owner (2026-10-17): no Brevo, no email anywhere in PlantOps.** Expiry reminders, like every other
  alert, go by **app notifications only** (bell + phone push through the installed PWA), which already work: the
  `document_store.expiry` notification is sent at 30 / 7 / 1 days, on expiry and weekly after, to the owners + the
  responsible person, and is urgent (always on). This extends the Floor Stock decision of 2026-10-11 to the whole
  platform.
- *Owner (config):* remove `BREVO_API_KEY` and `MAIL_FROM` from the `document-store` and `floor-stock` services on
  Railway; close the Brevo account.
- *Claude (small patch, no schema change):* without a mailer the email rows now wait as "Email is not set up yet" and
  are retried every day, and the document page's reminder log shows only emails. Change it so that:
  - no email rows are queued when no mailer is set up (the existing rows stay as history);
  - the document page shows the reminder **notifications** sent (who, when, stage) instead of emails;
  - Floor Stock's low-stock email rows likewise stop being queued;
  - the mail code stays in `packages/module-kit` unused (easy to bring back), and HANDBOOK / DEPLOY stop listing
    Brevo as a setup step.
- *Required for this to be safe:* everyone who must hear about expiries turns on phone notifications (owner + each
  responsible person: `/notifications` → "Send a test to this phone"). Today only 3 people have a phone on.
- *Also (owner):* one document has been **expired since 31 Mar 2026**: renew or archive it.

**B-03 · Platform · S1 · People have to log in many times a day.**
- *Evidence:* sessions are 12 h and mostly not logged out, yet new logins keep coming (Dillip 17 in 2 days, pairs
  1 second apart at 11:04:50 / 11:04:51 and 16:33 / 16:34). So the phone stops sending the login cookie, or people
  use several browsers / the installed app and the browser side by side, or the login button is pressed twice.
- *Fix:* first find out. (1) Record each plant login in the platform audit log with the browser type (installed app /
  Chrome / Safari, Android / iPhone) in `details`: no schema change. (2) Ask Dillip and Gaja which phone and how they
  open PlantOps. (3) Then fix the cause (e.g. the iPhone Home Screen app keeps its own cookies; module icons that open
  in a different browser; a double-tapped login button).

**B-04 · Attendance · S1 · The location check is effectively off.**
- *Evidence:* the circle was set to 2,000 m (designed 200 m); marks accepted 1,749 m away with 500 m accuracy. Phones
  are reporting rough network location instead of GPS.
- *Fix:* on the scan screen, ask for high accuracy and wait (up to ~20 s) for a better reading before sending; show
  "Location accuracy 450 m: turn on GPS / Precise location" instead of accepting it; HANDBOOK steps for Android
  "Google Location Accuracy" and iPhone "Precise Location". Then the owner sets the circle back to 200–300 m. Try on
  Dillip's and two other phones inside the plant before releasing.

**B-05 · Floor Stock · S1 · A count saved after midnight takes the next day.**
- *Evidence:* the 17 Oct count was first saved at 01:07 IST on 17 Oct (yesterday's closing entered late), so Bindu's
  real 17 Oct evening count had to be entered as a correction (version 4, "500ml ka stock check"). Sold / Used for
  16 and 17 Oct are therefore off.
- *Fix (ask the owner):* between 00:00 and 05:00 IST open the count on **yesterday**, with a clear "Counting for
  16 Oct" heading and a one-tap switch. Owner then checks 16 / 17 Oct and corrects if needed.

**B-06 · All modules · S2 · Trials are done on the real plant, and append-only keeps the test rows forever.**
- *Evidence:* "Test", "ccxc", "jkjkjk" … in orders, counts and attendance; 10 undo-delivered (most while trying
  Twilio on 14 Oct).
- *Fix (process, no code):* create a **demo plant** (code `999`, "PlantOps Demo") on the live copy with every module
  on, fake users and products; all trials there. HANDBOOK note. The test rows at 001 stay (they are in the history
  with their reasons); no deletes.

**B-07 · Notifications · S2 · Too many alerts, most never read.**
- *Evidence:* 70–93 % unread; Lab Records "no tests today" daily for a module nobody uses; 25 still-open reminders
  for 5 complaints.
- *Fix:* (owner) switch Lab Records off for 001 until it is used, or set that kind to Off; resolve or progress the
  5 open complaints. (Claude) a weekly digest idea goes to section 10, not now.

### Fix soon (S2 / S3)

| ID | Module | Sev | Issue | Next step |
|---|---|---|---|---|
| B-08 | All | S2 | Tests not run automatically | Phase S2 (`ci.yml`) |
| B-09 | All | S2 | No uptime check, no error reporting | Phase S2 |
| B-10 | Floor Stock | S2 | Platform down at the moment of a save → no low-stock alert queued for it (needs a migration: ask) | S4 Floor Stock |
| B-11 | Job applications | S3 | Hourly send limit is in memory and may count Railway's proxy address instead of the phone's | S3 check, then fix |
| B-12 | Platform | S3 | Login rate limit in memory: resets on each deploy | Accept for v1 |
| B-13 | Floor Stock | S3 | History pages stop at 120 counts / 60 days | Later |
| B-14 | Lab Records | S3 | Form 3 "Record of Test Report" prints empty | Ask a plant |
| B-15 | Order Capture | S3 | 2 thank-yous failed on 14 Oct (Twilio token wrong at the time, fixed); those 2 customers got nothing | None: closed |
| B-16 | Database | — | Feared running out of connections (8 apps × 10): `max_connections` is 500 | Closed |

### Found during S3–S5

| ID | Module | Sev | Issue | Found by | Status |
|---|---|---|---|---|---|
| | | | | | |

---

## 5. Phase S0 — Housekeeping

- [x] `backup.yml` checks Job applications data; Backup run green (17 Oct 18:34 UTC).
- [x] Deploy record for v0.25.0 (`a19a74d`).
- [ ] **Rotate the R2 keys** (pasted into a chat on 17 Oct): new key in Cloudflare, update `BACKUP_*` on every
      file-storing service and in GitHub, delete the old key.
- [ ] **Delete the four leftover password files** (once saved in Railway + the password manager):
      `.env.railway.shared.{attendance_salary,complaint_box,job_applications,order_capture}.paste`.
- [ ] Remove `BREVO_API_KEY` / `MAIL_FROM` from `document-store` and `floor-stock` on Railway (B-02); close Brevo.
- [ ] Renew or archive the document expired since 31 Mar 2026.
- [ ] Owner and every document's responsible person turn on phone notifications and send a test (B-02).
- [ ] 5 new users log in once and set their PIN (sushil, maheswar, joshobanti, Damayanti; bluemins_doc or disable it).
- [ ] Railway dashboard: every service on `1ea1c09`; volumes on Document Store, Complaint Box, Attendance, Job
      applications.

---

## 6. Phase S2 — Safety nets

1. **Tests on every push** — `.github/workflows/ci.yml`: Postgres service, database setup scripts, `pnpm typecheck`,
   `pnpm test` on each push to `main`. Red = no release.
2. **Uptime checks** — UptimeRobot (free) every 5 minutes on `app.bluemins.life/login`, `/.well-known/jwks.json` and
   the seven `/health` addresses, with a keyword check on the database answer. Alerts to the owner's email and phone.
   The same service can do B-01's timed calls if cron-job.org isn't used.
3. **Error reporting** — owner to choose: **A. Sentry** (free plan; error details leave PlantOps, scrub names /
   phones / money) or **B. built-in error log** (`platform.error_log` + super_admin "Errors" screen; needs a
   migration). Either way wired once in `packages/module-kit` `handle()` and the platform's `http.ts`.
4. GitHub emails on failed workflows reach the owner (GitHub → Settings → Notifications → Actions).

---

## 7. Phase S3 — Live check of everything "Not yet verified"

Tick, or turn into a bug in section 4. "Owner" = on a real phone at plant 001 (trials on the demo plant, B-06);
"Claude" = read-only checks.

- **Platform:** iPhone notifications and whether a tapped notification asks for login again; a Plant-staff-only
  login refused by Floor Stock; plan-renewal notification and 90-day cleanup ran (Claude).
- **Lab Records:** approve / hold / release on the live copy; WhatsApp: Meta approval status. (Low priority while
  unused.)
- **Document Store:** an expiry phone notification reaches the responsible person (test document expiring in 1 day,
  on the demo plant); add and renew with a phone photo.
- **Floor Stock:** day page and "Copy as WhatsApp message"; "Made from" on the five Empty Bottle items; the five
  "Decisions to confirm" in `apps/floor-stock/NOTES.md`.
- **Complaint Box:** iPhone HEIC photos and Safari video; files in the R2 backup (Claude).
- **Order Capture:** the owner's checklist (done in practice: 33 real orders); "Copy as WhatsApp message" with rates.
- **Attendance & Salary:** marking on Android / iPhone after B-04; **October month end on 31 Oct** (Salary tab,
  checking panel, mark paid, a slip); per-day person; Field staff ticks for Dillip and Kedar; Office staff and
  Supervisor checklist; the morning alert after B-01; Attendance files in the backup (Claude).
- **Job applications:** an application from Android and iPhone; Turnstile keys; the proxy address header (Claude);
  Remove now deleting the backup copy (Claude).

---

## 8. Phase S4 — How to analyse a module

Eight steps per module, one module per Claude session. Order (by real use and risk): **Order Capture, Attendance &
Salary, Floor Stock, platform, Complaint Box, Job applications, Document Store, Lab Records.**

1. **Read** `NOTES.md`, the phase plan and the test list; note what tests don't cover.
2. **Run** typecheck and tests for the module; note flaky ones.
3. **Code review** (`/code-review high` on the module folder): sums, missing checks, India date vs UTC (B-05 is this
   kind), 409 handling, half-saved data on errors.
4. **Access check:** every route × every role against the module's access table; support view refuses every write;
   another plant's ids give 404 (use the demo plant).
5. **Live data check** (read-only SQL): rows that "can't happen" — e.g. orders whose latest version has no lines;
   paid months without frozen numbers; two counts on one day; outbox rows stuck; plus the usage numbers of section 2
   again, to see trends.
6. **Logs:** Railway logs of the service for 7 days (or the S2 error list), errors grouped and counted.
7. **Phone walkthrough** of the module's HANDBOOK section at 390 px as each role; confusing screens count as S3 bugs.
8. **Write down** findings in section 4 and one dated line in the module's `NOTES.md`.

| Module | Look hardest at |
|---|---|
| Order Capture | paise totals; rate pre-fill; amounts never in Plant staff JSON; why owners undo "delivered" (10 of 33) |
| Attendance & Salary | rules 1–19 against hand-worked October months before 31 Oct; capacities; claims and photos; scan accuracy |
| Floor Stock | the date rule (B-05); "Can make" on plant 001's setup; low-stock once-per-day |
| Platform | logins and cookies (B-03); notification recipients; launcher with a slow module |
| Complaint Box | iPhone uploads; still-open reminder frequency |
| Job applications | public page spam rules, file checks, one-404 rule, purge and backup removal |
| Document Store | reminder stages around midnight IST; every expiry stage reaches the phone after B-02 |
| Lab Records | hold / release / approve order; append-only grants after 4 migrations |

---

## 9. Phase S5 — Performance and uptime

**Targets:** any screen usable within 2 s on 4G in Odisha (server in Singapore); API answers mostly under 300 ms,
none over 2 s; 99.5 % uptime per app per month; scheduled jobs start within 5 minutes of their time (B-01).

**Today:** every address answers in 0.24–0.36 s from India; database 16 MB (no size concern for years at this rate).

**Measure:**
1. Page times on a real phone (Lighthouse / Chrome remote debugging) for the most used screens: Order Capture order
   list and new order, Attendance scan, Floor Stock count, launcher.
2. Slow queries: `pg_stat_statements` (database setting: ask first) → the 20 slowest; indexes start with `tenant_id`.
3. Railway CPU / memory per service for a week; restarts.
4. Deploy gap on services with a volume (one copy only): measure with the uptime monitor; deploy after 21:00 IST.
5. Monthly growth: tables, volumes, R2 bucket, against plan storage limits.
6. Job start times for a week after B-01.
7. Platform-down drill: stop `platform` for 2 minutes at night; write down what users see (modules have 15 min
   grace; alerts wait in the outbox).

---

## 10. New features, after the "Fix now" bugs

Order chosen from section 2's usage (most used modules first) and dates that can't move.

| # | Feature | Module | Why now |
|---|---|---|---|
| F1 | **Weekly off, holidays, leave requests** | Attendance & Salary | First salary month end is 31 Oct; without weekly offs every Sunday counts as absent unless covered by paid leave |
| F2 | **Demo plant set-up script** (fake users, products, sample data) | Platform | Makes B-06 easy and gives a plant demo for selling |
| F3 | **Hindi / Odia screens**, staff modules first (Floor Stock count, Attendance scan, Order Capture) | All | Staff already type Hindi ("500ml ka stock check"); listed in CLAUDE.md UX |
| F4 | **Fewer, better alerts:** daily summary option instead of every new order / still-open | Platform | 70–93 % unread (B-07) |
| F5 | Floor Stock **dispatch entries** with the Lab Records batch check (token change: ask first) | Floor Stock + Lab | Next step of the core RO workflow |
| F6 | Phase 6 **Preventive Management** | New module | Next in the build order |
| F7 | Phase 7 AMC, Phase 9 Marketing Contacts, Phase 10 website / provisioning | New modules | Later |

Parked, no date: Lab Records WhatsApp (waiting for Meta) and batch lookup API; Document Store real S3; Floor Stock purchases, party list, returnable holders, history paging, godown stock; India hosting.

---

## 11. Phase S6 — Routine

- **Every release:** CI green → deploy after 21:00 IST → uptime monitor green → row in `docs/deployments/shared.md`
  → owner tries it on the demo plant / a phone next day.
- **Weekly (15 min):** errors / logs; job start times; outbox rows stuck; uptime report; section 2's usage query
  again (Claude, read-only).
- **Monthly (30 min):** restore the latest backup into a scratch database and count rows (HANDBOOK section 11);
  `pnpm audit` and Next.js security releases; sizes; review this file.

---

## 12. Build prompts

**S1, B-01:** "Fix B-01 in docs/STABILITY_PLAN.md: list every /api/cron/* call, secret header and IST time from the
three workflows, write the cron-job.org job list for me, and change daily.yml / evening.yml so GitHub keeps only
manual runs and the backup. Then check a week of start times."

**S1, B-02:** "Do the B-02 patch in docs/STABILITY_PLAN.md: no email rows queued without a mailer (Document Store
and Floor Stock), the document page shows the expiry notifications sent, HANDBOOK / DEPLOY without Brevo. No schema
change; tests first; patch release."

**S1, B-03:** "Investigate B-03: add the browser / device type of each plant login to the platform audit log (no
schema change), release as a patch, and after two days read the live audit log (read-only) and tell me the cause."

**S1, B-04 / B-05:** "Fix B-<n> in docs/STABILITY_PLAN.md. Plan mode first with a mock-up; tests first that show the
bug; ask before any schema change; patch release."

**S2:** "Do Phase S2: ci.yml, the uptime-monitor list, error reporting option <A/B> (ask before any migration)."

**S3:** "Help me with Phase S3: do the Claude items read-only; give me the owner items as a phone checklist per
module; turn failures into bugs in section 4."

**S4 (per module):** "Analyse <module> following section 8, all eight steps, live checks read-only. Findings into
section 4 with severity, then propose fixes."

**S5:** "Do Phase S5: measure first (ask before pg_stat_statements), write the numbers into section 9, propose fixes."

**F1:** "Plan F1 (weekly off, holidays, leave) for Attendance & Salary in plan mode, with mock-ups, before 31 Oct."
