# PlantOps – Stability plan

Started 2026-10-17 by the owner: the important modules are built (v0.25.0 live), so the next stretch is stability and
bug fixing, **then** new features. This file is the plan, the bug list, the live checklist and the feature order;
update it as items close.

**Rules while this plan runs:**
- Bugs first (section 4), in the order given; features only after the "Fix now" bugs are closed (section 10).
- Fixes ship as small patch releases (v0.25.1, v0.25.2 …), each tried on a phone before the next one starts.
- Ask before any schema, permission, tenant-isolation or SSO-token change (CLAUDE.md working rules).
- **Keep the Railway bill flat** (section 9, "Railway cost"): no new Railway service for a fix or a safety net; new
  code goes into the existing apps; timed calls come from cron-job.org (free), monitoring from free outside services.

---

## 0. Status and handover (updated 2026-10-18, 15:26 IST; read this first in a new session)

**Live since 2026-10-19 10:10 IST: v0.25.4** (`production` = `feb9439`; carries everything below + B-10, Order
Capture "Total to load", tests on GitHub). Live checks OK (deploy record). The list below is what that deploy brought:
- **v0.25.1** (`649033c`): B-02, no email; reminder / low-stock rows record "App notification only".
- **v0.25.2** (`1063d7d`): B-03, login record in the audit log, and the login button no longer allows a double login.
- **v0.25.3** (tag on `main`, 2026-10-18): **B-05** (Floor Stock count after midnight goes to last night) + **B-04**
  (Attendance waits for good GPS, refuses rougher than ±150 m; QR unchanged) + the dead-code clean-up.
- All code only: no migrations, SSO token unchanged. **Pushing `v0.25.3:production` deploys all three** (after 21:00
  IST, owner's OK first). Then the live checks and a row in `docs/deployments/shared.md`. After it, plant 001: Location
  & QR → "Use my current location" standing outside, circle **300 m**, Save (QR stays); check Floor Stock 16 / 17 Oct.

**Demo plant 999 "Sample RO Plant" exists on the live copy (B-06, 2026-10-18):** all modules on, max 15 users, green
`#00ff00`; owner `sowner` + 9 users, one per role (`sstore`, `sorder`, `scomplaint`, `sdoc`, `slab`, `sstaff`,
`soffice`, `ssuper`, `shr`); 3 products. **Logins are in `.env.demo`** (repo root, gitignored; owner password +
each user's PIN); the helper Claude used (`demo.mjs`: login, module handoff, JSON calls) was in the 18 Oct session's
scratchpad only. Set-up half done, stopped by the owner: see B-06 for what exists and what is left.

**Dead-code clean-up (2026-10-18, owner's OK; on `main`, ships with the next release, no behaviour change):** found
with knip (`pnpm dlx knip@5`, read-only; not added to the repo). Removed `nodemailer` + `@types/nodemailer` from Document
Store (email lives in `packages/module-kit`, kept unused on purpose, B-02), 3 leftover one-line re-export files
(document-store `lib/format.ts`, lab-records `server/html.ts` and `server/safe-next.ts`), 7 unused items
(`NOT_MARKED_HOURS`, `reminderStatusText`, `baseMeasure`, `countsSince`, `FORM_IDS`, `DailyEntryInput`, `MODULE_LABEL`)
and unused re-exports (Lab Records `session-cookie.ts`, `orHidden` / `orNotFound` in 6 modules' `pages.ts`). Kept:
`apps/platform/public/sw.js` (knip can't see it: phones load it by address), ~90 exports used only in their own file
(untidy, not dead), and **`apps/dev-module`** (owner, 2026-10-18: keep it, it is never deployed); README fixed about it.

**B-01 is running on cron-job.org since 2026-10-18** (11 jobs, India time, all with `x-cron-secret`; owner's
screenshots checked: daily 07:01, evening hourly 17:01–23:01, Attendance morning hourly 08:01–11:01). The owner's Test
run of Attendance morning at 10:12 sent the first ever "not marked" alert (owner + supervisor).

**`evening.yml` is manual-only since 2026-10-19** (schedule lines removed): the 18 Oct evening reminders went out at
20:01 IST from cron-job.org.

**Next, in order:**
1. ~~Owner: deploy v0.25.3; plant 001 steps; raise Railway's Compute Usage Limit~~ all done 2026-10-19 (v0.25.4 live;
   plant 001 steps marked done unchecked, circle still 2,000 m; limit $20, alert $7).
2. ~~Claude: commit `evening.yml`~~ done 2026-10-19.
3. B-05 and B-04 built (v0.25.3). After the deploy: phone trials on demo plant 999 (set 999's pin where you test);
   Claude reads plant 001's next marks read-only (accuracy, distance) and closes B-04; B-05 closes after the owner's
   16 / 17 Oct check and one late-night count.
4. B-06: finish the demo plant trials (list in B-06; Claude, when the owner says so). Owner: B-07 (Lab Records off
   for 001, the 5 open complaints).
5. Claude, 2 days after the deploy: read the B-03 login records (read-only) and name the cause.
6. Claude, 7 days after 18 Oct: B-01 start-time check, then close B-01.
7. **F1 (weekly off, holidays, leave) must be planned by about 22 Oct** to be live before the 31 Oct month end, even if
   B-03 / B-04 are still open (owner to confirm).
8. Open question for the owner: **B-17** hourly outbox resend (section 4).
8a. **2026-10-19:** B-08 (tests on GitHub) and B-10 (low-stock alert during an outage) built; v0.25.4 waits until
   v0.25.3 is deployed and tried. Error log (B-09 B): table design to the owner, then the migration. UptimeRobot:
   intervals to confirm, then the owner makes the account.
9. **Rotate the R2 keys and `CRON_SECRET`** (S0): **deferred by the owner (2026-10-18), not now.** Steps in HANDBOOK section 8 "Changing a secret" (corrected
   2026-10-18: R2 keys on 4 services, `CRON_SECRET` on 8 services + GitHub + 11 cron-job.org jobs). Owner, at night
   between 23:05 and 06:55 IST, after the v0.25.2 deploy; then Claude checks (backup in R2, wrong secret → 401 on all 8).
10. **Railway cost (section 9, "Cutting the cost"):** Serverless (sleep when idle) switched on for `job-applications` on
   2026-10-18 ~11:00 IST; a wake-up takes ~2 s (measured, section 9). Next: same for `lab-records`, then after a few days
   of watching the launcher tiles, `document-store` and `complaint-box`. Owner: Healthcheck Path `/health` was empty
   on `job-applications` (set it); send Railway's per-service memory (Metrics or Usage page).

---

## 1. Where things stand (checked 2026-10-17, evening; see section 0 for 18 Oct)

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
- [x] *Owner (2026-10-18):* the 11 jobs on cron-job.org, time zone Asia/Kolkata, header set; Attendance morning Test
  run sent the not-marked alert. (Plant 001 uses the default hours: count reminder 20:00, not-marked 10:00.)
- [x] *Claude (2026-10-19):* manual-only `evening.yml` committed. Evidence (live database, read-only): on 18 Oct plant
  001's `floor_stock.count_missing` (6 people) and `lab_records.no_tests_today` (3) were created at 20:01:07 IST, the
  cron-job.org minute.
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
- *Done (2026-10-18, Claude, v0.25.1):* the reminder / low-stock rows had to stay, because they are the "once per
  stage / once per item per day" record the notifications depend on. So without a mailer they are now recorded as
  "App notification only (email is off)", nothing is retried, and the document page and list say "sent in the app
  (bell + phone)". Tests: Document Store 107, Floor Stock 159. Live before the patch: 6 reminder rows (all Brevo 401 or
  no email), 35 low-stock rows (all "no email address").
- [ ] *Owner:* deploy v0.25.1 (with v0.25.2). Brevo account deleted (owner, 2026-10-19).
- [x] *Owner (2026-10-18):* `BREVO_API_KEY` / `MAIL_FROM` removed from `document-store` and `floor-stock` on Railway.
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

- *Done (2026-10-18, Claude, v0.25.2):* step (1): `user.login` in `platform.audit_log` with `device`, `browser`,
  `app` (installed / browser / unknown), `via` (module_link + `module` / login_page / other) and `previous`
  (none / still_valid / logged_out / expired + `ended_minutes_ago` / other_user / other_plant / unknown). Also fixed
  at once: the login button was active again while the next page loaded, so a second tap made a second login.
- *Reading it (Claude, read-only, 2 days after the deploy):* per person: logins per day, `previous` counts, device /
  browser / app mix. Expected patterns: mostly `expired` = the 12-hour session ends mid-shift (fix: sliding or
  longer sessions; a session-length change, ask the owner); mostly `none` with `app` = installed on iPhone = the Home
  Screen app keeps its own cookies (fix: one way of opening PlantOps per person); `none` on Android with
  `via: module_link` = module icons opening in another browser; `still_valid` = a login screen shown although logged in.
- [ ] *Owner:* step (2), ask Dillip and Gaja which phone and how they open PlantOps.

**B-04 · Attendance · S1 · The location check is effectively off.**
- *Evidence:* the circle was set to 2,000 m (designed 200 m); marks accepted 1,749 m away with 500 m accuracy. Phones
  are reporting rough network location instead of GPS.
- *Fix:* on the scan screen, ask for high accuracy and wait (up to ~20 s) for a better reading before sending; show
  "Location accuracy 450 m: turn on GPS / Precise location" instead of accepting it; HANDBOOK steps for Android
  "Google Location Accuracy" and iPhone "Precise Location". Then the owner sets the circle back to 200–300 m. Try on
  Dillip's and two other phones inside the plant before releasing.
- *Done (2026-10-18, Claude, v0.25.3; owner chose ±150 m and a 300 m circle, and no QR change):* `bestLocation()`
  (`apps/attendance-salary/src/lib/locate.ts`) watches up to 20 s and keeps the best reading, stopping early at ±30 m;
  used by the scan button ("Finding your location… ±450 m"), the office desk and the owner's "Use my current
  location" (warns above ±50 m). `MAX_ACCURACY_M` 500 → 150 on the server; a rougher reading isn't sent and the screen
  shows the Android / iPhone steps. Live data behind it (12 scans at 001): rough readings ±200–500 m were 1.0–1.7 km
  off, good ones ±4–17 m within 190 m. Saving the circle never touches the QR. Tests: Attendance 423 (+5).
- [x] *Owner, after the deploy:* plant 001 pin re-set standing outside, circle 300 m; Dillip + two others mark.
  **Marked done by the owner without checking (2026-10-19).** Live value read the same day: plant 001's circle is
  still **2,000 m** (last set 16 Oct), so the location check stays loose until it is set to 300 m.
- [ ] *Claude, the day after:* read the new marks (accuracy, distance, refusals) read-only; then close B-04.

**B-05 · Floor Stock · S1 · A count saved after midnight takes the next day.**
- *Evidence:* the 17 Oct count was first saved at 01:07 IST on 17 Oct (yesterday's closing entered late), so Bindu's
  real 17 Oct evening count had to be entered as a correction (version 4, "500ml ka stock check"). Sold / Used for
  16 and 17 Oct are therefore off.
- *Fix (ask the owner):* between 00:00 and 05:00 IST open the count on **yesterday**, with a clear "Counting for
  16 Oct" heading and a one-tap switch. Owner then checks 16 / 17 Oct and corrects if needed.
- *Done (2026-10-18, Claude, v0.25.3):* `countDay()` (`apps/floor-stock/src/lib/days.ts`, cut-off 5 am IST) drives the
  home page's main card ("Last night's count · 16 Oct"), `/count` with no date (the 8 pm reminder's link) and the
  launcher tile; after midnight the calendar day is a small switch card, and its count page has an amber "This count
  is for 17 Oct (today)" note. Saving rules unchanged. Tests: Floor Stock 172 (+13, `test/count-day.test.ts`).
- [x] *Owner, after the deploy:* check plant 001's 16 / 17 Oct day pages, correct if needed (old versions stay).
  Marked done by the owner without checking (2026-10-19), assumed fine.

**B-06 · All modules · S2 · Trials are done on the real plant, and append-only keeps the test rows forever.**
- *Evidence:* "Test", "ccxc", "jkjkjk" … in orders, counts and attendance; 10 undo-delivered (most while trying
  Twilio on 14 Oct).
- *Fix (process, no code):* create a **demo plant** (code `999`, "Sample RO Plant") on the live copy with every module
  on, fake users and products; all trials there. HANDBOOK note. The test rows at 001 stay (they are in the history
  with their reasons); no deletes.
- *Done (2026-10-18, Claude):* HANDBOOK section 4, "The demo plant (999)" (rules, public Job applications page, no
  Twilio).
- [x] *Owner (2026-10-18):* plant 999 "Sample RO Plant" created (all modules, max 15 users, green), owner `sowner`;
  password given to Claude, kept in `.env.demo` (gitignored). It was typed into the chat once: change it some day.
- *Set-up and trials (2026-10-18, Claude, through the apps' own APIs as plant-999 users; stopped by the owner at
  ~14:50 IST):*
  - Platform: 3 products (Sample 1L 12/case, Sample 500ml 24/case, Sample 20L Jar); 9 users with permanent PINs
    (in `.env.demo`).
  - **Floor Stock: PASS.** Starter list (4 sections, 28 items), limit 10 on Screw cap blue, `sstore` saved the 18 Oct
    count and the cap showed low; store keeper refused a limit (403); `sstaff` (Plant staff only) sent to
    `/sso/blocked` (also an S3 item). The count queued 1 low-stock email row ("not set up"): expected until v0.25.1.
  - Done but **results not recorded** (the agent was stopped before reporting): Order Capture 2 customers, 1 order
    delivered + 1 cancelled; Attendance location, 2 salaries, 1 advance, 1 mark; Document Store "Sample FSSAI
    licence" expiring 19 Oct (responsible `sdoc`); Lab Records 19 parameters, 2 batches; Complaint Box starter items.
  - No job opening exists (public page `jobs.bluemins.life/999` lists nothing).
- [ ] *Left (Claude, when the owner says so):* re-check the done parts read-only; Attendance Office staff / Supervisor
  refusals; Order Capture "Plant staff sees no amounts"; one complaint with a photo; Job applications opening (ends
  switched off) + one public application + HR desk refusals; launcher tiles for all 10 users. Then tick B-06.
- [x] *19 Oct morning (Claude, read-only):* the document-expiry notification reached `sdoc` and `sowner` ("Sample FSSAI
  licence: expires today", 07:01:08 IST, from the cron-job.org daily job).

**B-07 · Notifications · S2 · Too many alerts, most never read.**
- *Evidence:* 70–93 % unread; Lab Records "no tests today" daily for a module nobody uses; 25 still-open reminders
  for 5 complaints.
- *Fix:* (owner) switch Lab Records off for 001 until it is used, or set that kind to Off; resolve or progress the
  5 open complaints. (Claude) a weekly digest idea goes to section 10, not now.

### Fix soon (S2 / S3)

| ID | Module | Sev | Issue | Next step |
|---|---|---|---|---|
| B-08 | All | S2 | Tests not run automatically | **Closed 2026-10-19:** `ci.yml` + `scripts/setup-ci-db.sh`; GitHub runs #1 (`4c7cc23`) and #2 (`feb9439`) green, 3 m 53 s each (≈ 27 code pushes a week ≈ 450 of 2,000 free minutes a month) |
| B-09 | All | S2 | No uptime check, no error reporting | **Error log built 2026-10-19 (v0.25.5):** platform migration `0017_error_log.sql`, `POST /api/m/errors`, each app's `instrumentation.ts` + `handle()`, super_admin **Errors** screen, 30-day cleanup. UptimeRobot: owner chose **once a day for every address**; waiting for the owner's account |
| B-10 | Floor Stock | S2 | Platform down at the moment of a save → the alert said "Stock count saved" instead of "Low stock" | **Built 2026-10-19, no migration** (owner's OK): "newly low" from the rows + each save's audit `low` list, not the owner list. Ships in v0.25.4 |
| B-11 | Job applications | S3 | Hourly send limit is in memory and may count Railway's proxy address instead of the phone's | S3 check, then fix |
| B-12 | Platform | S3 | Login rate limit in memory: resets on each deploy | Accept for v1 |
| B-13 | Floor Stock | S3 | History pages stop at 120 counts / 60 days | Later |
| B-14 | Lab Records | S3 | Form 3 "Record of Test Report" prints empty | Ask a plant |
| B-15 | Order Capture | S3 | 2 thank-yous failed on 14 Oct (Twilio token wrong at the time, fixed); those 2 customers got nothing | None: closed |
| B-16 | Database | — | Feared running out of connections (8 apps × 10): `max_connections` is 500 | Closed |
| B-17 | Order Capture, Complaint Box, Attendance, Floor Stock | S2 | A notification that couldn't reach the platform (e.g. during a platform deploy) waits in the module's outbox until that module's next timed job: **next morning 07:01** for Order Capture and Complaint Box. Proposed (2026-10-18, owner not yet answered): a `/api/cron/outbox` route in each of these existing apps (resend only, no reminders) called hourly 08:01–22:01 by cron-job.org; no new service, no schema change, no Railway cost | Ask the owner, then a patch |

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
- [x] **Delete the four leftover password files** (owner, 2026-10-18):
      `.env.railway.shared.{attendance_salary,complaint_box,job_applications,order_capture}.paste`.
- [x] Remove `BREVO_API_KEY` / `MAIL_FROM` from `document-store` and `floor-stock` on Railway (B-02), 2026-10-18.
- [x] Close the Brevo account (owner, 2026-10-19).
- [ ] Renew or archive the document expired since 31 Mar 2026.
- [ ] Owner and every document's responsible person turn on phone notifications and send a test (B-02).
- [ ] 5 new users log in once and set their PIN (sushil, maheswar, joshobanti, Damayanti; bluemins_doc or disable it).
- [ ] Railway dashboard: every service on `1ea1c09`; volumes on Document Store, Complaint Box, Attendance, Job
      applications.
- [x] cron-job.org account and 11 jobs (B-01, 2026-10-18).
- [x] **Railway → Usage → Update limits:** raise the Compute Usage Limit from $10 to about $20 and set an email alert at
      $10 (at the hard limit Railway stops every service; section 9). **Done (owner, 2026-10-19):** compute hard limit
      $20, email alert $7; Agent hard limit $5.
- [ ] Rotate `CRON_SECRET` on the same day as the R2 keys (part of it was visible in a screenshot on 18 Oct; low risk:
      it only starts dedupe-safe jobs): every Railway service, the GitHub environment `shared`, all 11 cron-job.org jobs.

---

## 6. Phase S2 — Safety nets

1. **Tests on every push** — `.github/workflows/ci.yml`: Postgres service, database setup scripts, `pnpm typecheck`,
   `pnpm test` on each push to `main`. Red = no release. *Cost:* runs on GitHub, not Railway; a private repo has 2,000
   free Actions minutes a month, so cache pnpm, skip docs-only pushes (`paths-ignore: docs/**, **/*.md`) and measure
   the first run's minutes. **Built 2026-10-19** (owner's OK): Postgres 18 container, `scripts/setup-ci-db.sh`. Checked
   before: every app typechecks without the uncommitted `next-env.d.ts`; a platform test that failed 1 run in 16
   (`app-icon.test.ts`, damaged-signature check) fixed. About 27 code pushes a week × ~5 min ≈ 600 minutes a month.
2. **Uptime checks** — UptimeRobot (free) every 5 minutes on `app.bluemins.life/login`, `/.well-known/jwks.json` and
   the seven `/health` addresses, with a keyword check on the database answer. Alerts to the owner's email and phone.
   (cron-job.org already does the timed calls, B-01.) *Cost:* free, nothing on Railway.
   **Owner (2026-10-19): every address once a day** (24-hour interval; an outage may be noticed up to a day late, but
   the sleeping services stay asleep).
3. **Error reporting** — **owner chose B (2026-10-19); built as v0.25.5** (design approved the same day).
   Options were: **A. Sentry** (free plan; error details leave PlantOps, scrub names /
   phones / money) or **B. built-in error log** (`platform.error_log` + super_admin "Errors" screen; needs a
   migration). Either way wired once in `packages/module-kit` `handle()` and the platform's `http.ts`. *Cost:* neither
   adds a Railway service; B adds a few rows to the existing database.
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

**Railway cost (owner's usage screen, 2026-10-18; period 29 Sep – 29 Oct):** $3.44 used so far, estimated $6.43 for
the period (Hobby: $5 fee includes $5 usage). Memory is $3.18 of it (~13,760 GB-minutes); CPU $0.08, volumes $0.04,
egress $0.02. Attendance and Job applications joined mid-period, so a full month of 9 services is likely ~$8–9 usage.
**Compute Usage Limit is $10, and Railway stops the services at that limit:** raise it (e.g. $20) with an email alert
at $10. Memory per service (Railway → Metrics) is the first thing to measure here; cost grows with the number of
services, not with plant use.

**Railway cost rules** (owner, 2026-10-18: keep the cost in mind):
- Each always-on app is billed for its memory every minute, used or not; 9 services today (platform, 7 modules,
  Postgres). **A new service costs roughly $1/month or more**, so: no new services for fixes, safety nets or jobs
  (cron-job.org calls the existing apps; monitoring is UptimeRobot / GitHub); a new module (Phase 6+) is a cost decision.
- **Demo plant (B-06) = rows in the shared copy**, never a second copy or extra services.
- **Measure before trimming** (S5): memory per service from Railway → Metrics for a week; then try a Node memory cap
  per app (`NODE_OPTIONS=--max-old-space-size=…`) and check Next.js runs as a standalone server. Change one service at a
  time; keep the 2 s / 300 ms targets above.
- Egress, volumes and backups are cents; photos (Complaint Box, Attendance claims, Job applications) are already shrunk
  on the phone, keep it that way.
- **Monthly** (S6): note the Railway usage and estimate here, next to the period's numbers.

**Cutting the cost: findings (2026-10-18, Claude: local measurements + live database settings, read-only)**
- **One app uses ~100–135 MB** (Document Store production build: 103 MB at rest, 136 MB after 180 requests). 100 MB
  kept on all month ≈ **$1/month**. The current rate is ~0.85 GB for the 9 services ≈ **$8.50 for a full month**.
- **The Hobby bill never goes below $5** (the fee includes $5 of usage), so at most **~$3.50/month** can be saved today.
- Apps are already lean: Next.js `standalone` output on `node:22-slim`, one replica each.
- **Postgres:** database 16 MB, Railway defaults (`shared_buffers` 128 MB, `work_mem` 4 MB), idle app connections close
  by themselves (pg Pool default 10 s; only the backup login was connected): nothing to gain.
- **The apps can sleep:** no server-side timers, no idle database connections, session re-checks only on requests;
  the only `setInterval` is the launcher bell in the browser (platform, which stays on).

| Option | Saving / month | Risk / cost | Decision |
|---|---|---|---|
| **Serverless** (Railway sleeps a service after 10 min without traffic, wakes it on the next request, no memory billed while asleep) for little-used modules: Lab Records (6 opens / week, not in use), Job applications (1), Document Store (15), Complaint Box (36) | ~$1–1.30 each, **~$3–4.50 for all four** | First visit after a quiet spell waits for the wake-up (local start 0.5–1.2 s + Railway's wake, to measure); a launcher tile may show "Numbers unavailable" once (3 s summary timeout, CLAUDE.md contract); the timed jobs (cron-job.org waits 30 s) and the backup call (120 s) just wake it; files and notifications unaffected. One switch per service, reversible at once | **Started 2026-10-18 with Job applications** |
| Keep **always on**: platform (login), Order Capture, Attendance (scans at the gate must be instant), Floor Stock, Postgres | — | — | Decided |
| Leftover services / volumes on Railway (should be 9 services, 4 volumes) | whatever they cost | none | Owner to check |
| Railway's AI Agent | $0.11 this month | none | Don't use it |
| Node memory cap `NODE_OPTIONS=--max-old-space-size=…` | ~$0.15 per app (64 MB cap saved ~15 MB at light load), ~$1 total | Out-of-memory crash on big jobs (Document Store ZIP / CSV exports, photo uploads) if too tight | Later, only after a week of per-service memory graphs, generous ceiling, one service at a time |
| Postgres tuning | ~0 | — | No |
| Merge modules into one service | ~$6 | Breaks the independent-module design (CLAUDE.md), big rewrite | No |
| Move off Railway (own server) | a few $ | More running / maintenance work | No, not now |

- **Wake-up time on Railway (measured 2026-10-18 11:19 IST, `job-applications` after 16 idle minutes, curl `/health`
  from India):** first visit **2.1 s** (asleep → awake), then 0.21 s and 0.20 s (normal 0.2–0.25 s). So a wake costs
  ~2 s, under the launcher's 3 s tile wait but close (the tile's first call also fetches the platform's key), so a
  sleeping module's tile may now and then show "Numbers unavailable" on the first open. Next: Serverless on
  `lab-records`; watch the tiles for a few days before `document-store` / `complaint-box`.
- If wake-ups make the launcher tile miss its numbers too often: raise the summary timeout from 3 s to 5 s for
  sleeping modules (changes the CLAUDE.md launcher contract: ask the owner first).

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
| F6 | Phase 6 **Preventive Management** | New module | Next in the build order; a new Railway service (≈ $1+/month, section 9) |
| F7 | Phase 7 AMC, Phase 9 Marketing Contacts, Phase 10 website / provisioning | New modules | Later |

Parked, no date: Lab Records WhatsApp (waiting for Meta) and batch lookup API; Document Store real S3; Floor Stock purchases, party list, returnable holders, history paging, godown stock; India hosting.

---

## 11. Phase S6 — Routine

- **Every release:** CI green → deploy after 21:00 IST → uptime monitor green → row in `docs/deployments/shared.md`
  → owner tries it on the demo plant / a phone next day.
- **Weekly (15 min):** errors / logs; job start times; outbox rows stuck; uptime report; section 2's usage query
  again (Claude, read-only).
- **Monthly (30 min):** restore the latest backup into a scratch database and count rows (HANDBOOK section 11);
  `pnpm audit` and Next.js security releases; sizes; **Railway usage / estimate against the compute limit**
  (section 9); cron-job.org failures; review this file.

---

## 12. Build prompts

**Next session, start:** "Read docs/STABILITY_PLAN.md section 0 and continue with the next item there."

**Deploy v0.25.2:** "Deploy v0.25.2 (includes v0.25.1) to production following docs/DEPLOY.md 'Releasing an update':
no migrations; live checks (Brevo variables are already removed); deploy record row."

**B-01, close:** "Commit the manual-only evening.yml if the cron-job.org evening jobs answer 200; after 7 days read the
timed notification start times (read-only) and close B-01."

**B-03, read:** "Read the user.login records of the last 2 days (read-only), per person, and tell me the cause of B-03
with a proposed fix."

**Railway cost, next step:** "Railway cost: read docs/STABILITY_PLAN.md section 9 'Cutting the cost'. Time a wake-up of
every Serverless service after 15 idle minutes (curl /health, read-only), record the numbers there, and tell me whether
to switch on the next module. Then, with my per-service memory screenshots, replace the estimates with real numbers."

**Railway cost, launcher (only if wake-ups miss the tile numbers):** "Plan mode: let the launcher wait up to 5 s (not 3 s)
for the tile numbers of modules that may be asleep; this changes the CLAUDE.md launcher contract, so show me the change
first; tests; patch release."

**Railway cost, memory cap (after a week of Metrics):** "Propose a NODE_OPTIONS memory ceiling per service from the
Railway memory graphs, keeping headroom for exports and uploads; one service first; write the before / after memory in
section 9."

**B-17:** "Build B-17: /api/cron/outbox in Order Capture, Complaint Box, Attendance and Floor Stock (resend only), tests,
patch release, and the 4 cron-job.org jobs for HANDBOOK section 10."

**S1, B-01 (done 2026-10-18):** "Fix B-01 in docs/STABILITY_PLAN.md: list every /api/cron/* call, secret header and IST time from the
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
