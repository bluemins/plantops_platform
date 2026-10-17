# Job Applications Module — Phase Plan and Build Prompts

**Status:** Design, mock-ups and phase plan approved by the owner on 2026-10-17. Built **now, before Phase 6
(Preventive Management)** (owner, 2026-10-17). Schema, permission and platform changes listed here are agreed in
principle; each migration is still shown to the owner before it runs (CLAUDE.md working rules).

## Purpose

Job seekers send their **name, phone, current location and resume** to a plant through a public web page, without
a login. The plant owner and the new **HR desk** role see the list in a new PlantOps app, call the people, and keep
track of who was called, shortlisted or hired. People who don't want to pick a job can **just send their resume**.

This is the **first PlantOps page that strangers on the internet can write to**. Spam, file safety and personal
data (consent, 12-month removal) are part of the design from the start.

**Mock-ups** (8 phone screens, approved 2026-10-17): https://claude.ai/artifact/UJDAodkRMwutqbDhpZnwcC (private to the
owner). Screens follow them.

**Source of the openings:** the owner's "Bluemins: All Positions" table (2026-10-17): Position, Job Description,
Minimum Qualification, Good to have. Entered by the owner through the Openings screen, never in code.

## Names used in this plan

| Thing | Value |
|---|---|
| Module id | `job_applications` (label "Job applications") |
| New role | `hr_desk` (label "HR desk") |
| App folder / local port | `apps/job-applications` on `:3007` |
| Database schema / login | `job_applications` / `jobs_app` |
| `.env` prefix for the setup scripts | `JOBS` |
| Live address | `jobs.bluemins.life` (free in DNS, checked 2026-10-17) |
| Default plant for the bare address | `JOBS_DEFAULT_PLANT=001` (environment setting; nothing hard-coded) |
| Other plants | `jobs.bluemins.life/<plant code>` |
| Application reference | `J-0001`, `J-0002`, … per plant |
| Plan limit | `limits.modules.job_applications.storage_mb` |
| Release | v0.25.0 |

## Agreed design (owner, 2026-10-17)

### Who uses it
| Person | Can do |
|---|---|
| **Anyone (public, no login)** | See the plant's open positions; send one application (resume, name, phone, place) |
| **Owner** (`tenant_admin`) | Everything below, plus: Openings and the page message, CSV export, **Remove now**, Recent changes |
| **HR desk** (new role) | See all applications, open resumes, call / WhatsApp, change status, add notes |
| **Plant staff** | **Nothing** (`PLANT_STAFF_MODULES` stays Attendance only; a new module never includes plant staff) |
| **PlantOps support** (super_admin) | Read-only view; every page **and resume** view logged on the owner's "Support access" page |
| Anyone else | Nothing. Checked on the server on every route and page, never by tile hiding only |

- `hr_desk` is tied to `job_applications` in `ROLE_MODULE`. An HR-desk-only user skips the launcher and lands straight
  in the app.
- HR desk users can be ticked for "Gets Job applications alerts" (not owner-only like Attendance).

### Which plant a public page belongs to
- `jobs.bluemins.life/` → the plant in `JOBS_DEFAULT_PLANT` (plant 001, Bluemins).
- `jobs.bluemins.life/<code>` → that plant (plant codes match `^[A-Z0-9_-]{3,32}$`; the page accepts lower case).
- A plant is shown only if it is **active and has Job applications switched on**. Otherwise: "This page is not
  available" (404), never a hint whether the plant exists.
- The module finds the plant through a **new platform endpoint** `GET /api/m/plants/by-code/:code` (module
  credentials). It returns only `{ tenant_id, name }`, or 404 when the plant is unknown, suspended or the module is
  off. Cached one minute in the module, like branding.
- No plant drop-down and no shared pool across plants: each plant's applicants are private to that plant (RLS).

### Openings (owner)
Each opening has:

| Field | Rule |
|---|---|
| Position | required, 2–80 |
| Group on the public page | one of: Production, Lab & quality, Office & sales, Delivery & security, Other |
| Short tag | optional, ≤ 40, shown on the job list (e.g. "10th · 3-wheeler licence") |
| Job description | required, ≤ 1,000 |
| Minimum qualification | required, ≤ 500 |
| Good to have | optional, ≤ 500 |
| Shown on the public page | on / off |
| Order | within its group |

- Switched off, never deleted. Applications keep a **copy of the position name** they applied for, so renaming an
  opening never changes old applications.
- **Page message** (owner): the text at the top of the public page (≤ 300), with a sensible default.
- Audited; listed in Recent changes.
- Plant 001's first list comes from the owner's table (13 rows, entered by the owner on screen). Suggested on the
  mock-ups: the two "Plant staff" rows merged into one; the two "Delivery Staff" rows named "Delivery staff (auto)"
  and "Delivery staff (scooty)". Check the Lab Assistant qualification text: the sheet was cut off at
  "Microbiology P…".

### Public page (mock-up screens 1–4)
1. **Open positions** (`/` or `/<code>`):
   - plant logo, name and brand colour (public logo route, see below)
   - "We are hiring · N jobs", the page message
   - two buttons: **Send your resume** (main) and **See the N open jobs**
   - three ticks: "2 minutes · No login · Photo of CV is fine"
   - "How it works" in 3 steps
   - jobs grouped by area (groups with no open job are hidden), each row = position + short tag
   - a closing "Didn't find your job?" band with Send your resume
   - when no opening is on, the page shows only the "Send your resume" part
2. **One position:** job description, minimum qualification, good to have; "Apply for this job".
3. **Apply form:**
   - Position: "Any job (just send my resume)" (stored as no opening) or one of the open positions. Opened from a
     position → that one chosen.
   - Full name 2–100; mobile (the shared Indian-mobile rule, `packages/module-kit/src/phone.ts`); "Where do you live
     now?" 2–200.
   - Resume: **one PDF (≤ 5 MB) or 1–3 photos** of a paper CV. Photos are shrunk on the phone to ≤ 1600 px JPEG
     (Complaint Box's photo code); HEIC from iPhones goes through the same shrink.
   - **Consent tick (required):** "I agree that <Plant> may keep my details for 12 months to contact me about jobs."
     The text version and the time are stored with the application.
4. **Sent:** "Application sent · Reference J-0042 · <Plant> will call you on <phone> if there is a match." Nothing
   else is shown to the applicant: no status lookup, no login.

### Sending an application (server)
- One `multipart/form-data` POST to `/api/apply/<code>` (the bare-address page posts with the default plant's code).
  No cookies, so no CSRF risk; `Origin` must be the module's own address.
- The server takes the plant from the code, never from the form. It checks every field again, then:
  - **file type by its first bytes** (`sniffType`: PDF / JPEG / PNG / WebP only; SVG, HEIC as-is and anything else
    refused), size, count;
  - the plan's storage limit: when full, the page says "Applications are closed right now" and the owners get the
    storage notification;
  - **spam rules:**
    - a hidden trap field (filled → answer "sent" but save nothing)
    - at most 20 sends per IP per hour (in memory, per server; the IP is never stored). Was 5; raised by the owner
      on 2026-10-17 so a hiring drive on one mobile network isn't blocked
    - **one application per phone per opening per 30 days** ("You already applied on 12 Oct. We have your details.")
      — "Any job" counts as one opening
    - **Cloudflare Turnstile** (free) when `TURNSTILE_SITE_KEY` / `TURNSTILE_SECRET` are set; without them the other
      rules still apply, and the HANDBOOK says how to switch it on
  - the reference `J-0001…` under a per-plant `pg_advisory_xact_lock` (as Complaint Box / Order Capture);
  - files written first under random keys, then the rows in one transaction; a failed save leaves no row (an orphan
    file is listed by the daily job and removed).
- A repeated send of the same form (double tap) with the same one-time key returns the same reference. Generate the
  key without `crypto.randomUUID()` (fails on plain-`http` phone testing).

### Owner / HR desk screens (mock-up screens 5–8)
5. **Applications** (`/applications`, the app's home after login):
   - status filters with counts: New · Called · Shortlisted · Hired · Not suitable · All
   - search (name, phone digits, place), position filter (incl. "Any job"), newest first
   - each row: name (bold while New), status chip, position, reference · place · when; a call button
   - tabs: Applications, Openings (owner), CSV (owner), Recent changes (owner + support)
6. **One application** (`/applications/<id>`):
   - Call (`tel:+91…`) and WhatsApp (`https://wa.me/91…`) buttons
   - position, mobile, place, "Applied before" (other applications with the same phone at this plant, linked),
     consent date and the removal date (12 months after sending)
   - resume: PDF opened in the phone's viewer, photos as pages that open full screen; served with
     `Content-Disposition: inline`, `nosniff`, private cache
   - status buttons New / Called / Shortlisted / Hired / Not suitable (any order, also back; reason optional)
   - notes (≤ 300, append-only), history ("Sent from the public page", "Opened by …", status changes, notes)
   - the first open by owner / HR desk records `seen_at` ("Opened by …"); support views never do
   - 409 "just changed by …" when two people change the status at once
   - owner only: **Remove this application now** (reason required, e.g. "applicant asked"), see Removal
7. **Openings** (owner): public link with Copy link and **Print QR poster** (A4, the server draws the QR as in
   Attendance), the page message, positions with on / off switches and their application counts, "+ Add".
8. **Edit a position** (owner): the fields of the Openings table above; "The N applications already received keep
   the name they applied for."

- **Owner CSV:** one row per application (reference, date, position, name, phone, place, status, last note, removal
  date), no files, formulas neutralised, audited.

### Removal after 12 months (and "Remove now")
Personal data is kept only as long as the applicant agreed (DPDP Act consent). **This is the first module data that is
ever deleted** (owner approved the 12 months on 2026-10-17). The app login still has no DELETE grant:
- `job_applications.purge_applications(p_now timestamptz)` (security definer, like
  `platform.purge_old_notifications()`): deletes applications sent more than 12 months ago, with their events and file
  rows; their storage keys go into `file_removals`; returns the count. The audit log gets an anonymous line ("3
  applications older than 12 months removed").
- `job_applications.remove_application(p_tenant uuid, p_id uuid, p_reason text)` (security definer): the owner's
  Remove now. It checks the row belongs to `p_tenant` and to the transaction's tenant setting, keeps only an audit
  line ("J-0042 removed by <owner>: <reason>"), and queues the files.
- **Files:** `FileStorage` in `packages/module-kit` gains `remove(key)` (local unlink / S3 DELETE). The daily job
  removes each queued file from storage, then its **backup copy** (`backupKeyFor`, the R2 bucket), then clears the
  `file_removals` row through a definer function. Only this module uses `remove()`; every other module keeps "files
  are never deleted".
- Nightly database dumps are kept 30 days, so a removed application is gone everywhere within 30 days of removal.
  The consent text says "12 months"; the privacy note on the form says details are seen only by the plant.

### Notifications (N5+, from day one)
| Kind | Who | Level | Text | Link | Dedupe key | Sent by |
|---|---|---|---|---|---|---|
| `job_applications.new` | owners + ticked HR desk | bell (bellOnly) | "New job application J-0042: Lab Assistant, Bargarh" (no phone number) | `/applications/<id>` | `new:<id>` | the public send |
| `job_applications.storage` | owners | phone + bell | "Job applications storage 80 % / 95 % full" / "full: the form is closed" | `/openings` | `storage:<limit MB>:<step>` | the public send |

- None urgent. Outbox (`notification_outbox` + `outbox_tenants()`) and `kit.retryOutbox()` in the daily job.
- No message to the applicant in v1 (no SMS / WhatsApp cost).

### Launcher tile
- Icon 📋, staff text "Applications", owner setup link "⚙ Openings" → `/openings`.
- Badges: "N new" (info; warn after 3 days unopened), "N this week"; owner: "Public page has no openings" (info) when
  none is on. Support view = owner view.

### Standard pieces (as in every PlantOps module)
- `createModule()` from `packages/module-kit`: callback, support entry / exit, logout, plant logo, proxy, header with
  🔔 and Account, plant colour.
- **Module kit change:** `createModule({ homePath })` (default `/`). The login callback lands on `homePath` when
  there is no `next`, so a logged-in owner never lands on the public page. Job applications sets `/applications`.
- **Proxy:** this app's matcher lists the **protected** paths (`/applications`, `/openings`, `/changes`,
  `/support-access`, `/api/app/…`), so `/`, `/<code>`, `/api/apply/…` and the public logo stay public.
- **Public logo:** `/api/public/logo/<code>` (the plant's logo through `fetchLogo`, only when the plant passes the
  lookup above; cache one hour).
- Support view read-only (proxy + server guards), page and file views logged; owner's `/support-access`;
  `job_applications` in `SUPPORT_READY`.
- Nightly encrypted file backup (`POST /api/cron/backup`, `backupNewFiles`), `backup.yml` step.
- Daily job `POST /api/cron/daily` (`CRON_SECRET`): outbox retry, purge, file removals, orphan files.

### Not in version 1
- "Hired" → create the PlantOps user or the Attendance person (a later button).
- Hindi / Odia public page (the page is built so labels can be translated later).
- Messages to applicants (SMS / WhatsApp), interview scheduling, ratings.
- A status lookup for applicants; applicant accounts.
- A shared pool of applicants across plants.

## Database (agreed in principle; each migration shown to the owner before it runs)

Platform migration `0016_job_applications.sql`: module row `job_applications` ("Job applications") and role
`hr_desk` ("HR desk", module `job_applications`). No other platform table changes; SSO token unchanged.

Module migration `apps/job-applications/db/migrations/0001_job_applications.sql`, schema `job_applications`, login
`jobs_app`. Every table has `tenant_id` + `FORCE ROW LEVEL SECURITY` + the usual tenant policy. `jobs_app` gets
**SELECT + INSERT** only, plus the column UPDATEs listed:

| Table | Holds | UPDATE allowed |
|---|---|---|
| `openings` | the fields above, `created_by` | title, grp, tag, description, min_qualification, good_to_have, status, sort_order, updated_at |
| `page_settings` | one row per plant: page message | message, updated_at |
| `applications` | ref_no (unique per plant), opening_id (null = any job), opening_title copy, name, phone (10 digits), place, consent_version, consent_at, request_key (unique per plant), status, status_changed_at, seen_at, seen_by, created_at | status, status_changed_at, seen_at, seen_by |
| `application_events` | kind (`status` / `note` / `seen`), from / to status, text, user id + name, at | none |
| `application_files` | application_id, page_no, storage_key (unique), content_type, size, sha256 | none |
| `file_removals` | tenant_id, storage_key, queued_at | none (cleared by a definer function) |
| `audit_log` | setup changes, CSV, removals | none |
| `support_views` | support page / file views | none |
| `notification_outbox` | as in other modules | retry columns |

- Checks in the database: lengths, phone `^[6-9][0-9]{9}$`, status values, file type / size, page_no 1–3,
  consent required, note text required for a `note` event.
- Definer functions (owner `plantops_owner`, `search_path` pinned, execute granted to `jobs_app` only):
  `outbox_tenants()`, `purge_tenants()` (plant ids only), `purge_applications(timestamptz)`,
  `remove_application(uuid, uuid, text)`, `clear_file_removal(uuid, text)`.
- No DELETE grant anywhere.

## Phases

Finish and test each phase before the next. Each phase ends with `pnpm test` for the touched apps, `typecheck`, and a
short dated note in `apps/job-applications/NOTES.md`.

| Phase | What | Result |
|---|---|---|
| **0** | Design and mock-ups | Done 2026-10-17: this plan and the 8 screens approved |
| **1** | Platform registration | Module + role + plant lookup endpoint + notification kinds + tile + plan limit |
| **2** | Module foundation | App on module-kit (`homePath`), own schema and login, protected-path proxy, access table |
| **3** | Openings and the public page | Owner's Openings / page message; public screens 1–2 with branding |
| **4** | Sending an application | Apply form, files, spam rules, reference, consent, Sent screen |
| **5** | Applications for owner / HR desk | List, application page, status, notes, CSV, Remove now |
| **6** | Notifications, tile, support, removal, backup | Two kinds + outbox, badges, support logging, 12-month purge, file and backup removal |
| **7** | Release and deploy | Docs, Dockerfile, Railway service, `jobs.bluemins.life`, live checks, owner tries it |

### Phase 0 — Design and mock-ups (done 2026-10-17)
- Decisions: name, owner + HR desk, bare address = plant 001, openings with the owner's four columns + group + short
  tag, "just send your resume", 12 months, build before Phase 6.
- Mock-ups approved (link above).

### Phase 1 — Platform registration
- Platform migration `0016_job_applications.sql` (show it first; dev + test databases).
- `packages/types`: `MODULE_IDS` (after `attendance_salary`, before `marketing_contacts`), `ROLE_IDS` (`hr_desk`),
  `ROLE_MODULE`, two `NOTIFICATION_KINDS` (`new` bellOnly; none urgent).
- Platform:
  - role label and role button text ("HR desk · Job applications: see and call applicants")
  - tile in `apps/platform/src/lib/modules.ts` (📋, "Applications", "⚙ Openings" → `/openings`)
  - plan limit field "Job applications storage (MB)" in `MODULE_LIMIT_FIELDS`
  - `GET /api/m/plants/by-code/:code` (`authenticateModule`; only the calling module = `job_applications`; 404
    unless the plant is active and the module is on; answers `{ tenant_id, name }` only)
  - Permissions screen shows HR desk; the "Gets alerts" tick box appears for HR desk users
- `apps/dev-module` does not serve `job_applications`.
- Tests: `roleWorksIn` (hr_desk yes, plant_staff no), tick box offered to hr_desk only, an HR-desk-only user lands in
  the module, the lookup endpoint (good code, lower case, unknown, suspended plant, module off, wrong module
  credentials, another module's credentials → all but the first two refused, same 404 text), settings page lists the
  new kinds.

### Phase 2 — Module foundation
- `./scripts/setup-module-db.sh job_applications jobs_app JOBS 3007` (dev + test).
- Module migration `0001_job_applications.sql` with every table, grant, policy, check and function above (show it
  first).
- `packages/module-kit`: `homePath` option in `createModule()` (default `/`, other modules unchanged).
- `apps/job-applications` (Next.js, `:3007`) on `createModule({ homePath: "/applications" })`: callback, support,
  logout, logo, header, plant colour; empty `/applications`; empty summary endpoint; `/health`; proxy matcher listing
  the protected paths only.
- One access table (`src/server/access.ts`): view, change status / notes, openings, export, remove, support read.
- Tests: tenant isolation, FORCE RLS guard over every table, append-only refusals for `jobs_app` (list each refused
  statement, incl. DELETE everywhere and UPDATE of application details / files / events), the definer functions refuse
  another plant's rows, access table per role (owner, hr_desk, plant_staff refused, store_keeper refused, support
  read-only), protected pages → platform login, protected APIs → 401, `/` and `/<code>` reachable without a session,
  module-kit `homePath` (callback without `next` → `/applications`; other modules still `/`).

### Phase 3 — Openings and the public page
- `/openings` (owner; support read-only): list by group with on / off, order, application counts, "+ Add", edit
  screen with every field; page message; public link with Copy link; **Print QR poster** (A4, server-drawn QR of the
  plant's public address). Audited; `/changes` Recent changes.
- Public `/` and `/<code>`: plant lookup (cached), branding (`kit.branding`), public logo route, screens 1–2 exactly as
  the mock-ups; groups with no open job hidden; only "Send your resume" when no opening is on; 404 page for unknown /
  off plants; `JOBS_DEFAULT_PLANT` for `/`.
- Tests: owner-only openings (hr_desk refused), field rules, switched-off positions never on the public page, another
  plant's openings never shown, the lookup's 404 cases give the same page, `/` uses `JOBS_DEFAULT_PLANT`, no session
  cookie is set on public pages. Check screens 1–2 and 7–8 at 390 px in headless Chrome.

### Phase 4 — Sending an application
- Screen 3 (apply form) and screen 4 (sent) as the mock-ups; photo shrinking from Complaint Box; one-time request key.
- `POST /api/apply/<code>` (multipart): plant from the code; field checks; file sniffing and limits; storage limit;
  trap field; IP rate limit; 30-day repeat rule; Turnstile when configured; reference under the advisory lock; files
  then rows in one transaction; consent version + time.
- Tests: every field rule; PDF / photos accepted; renamed `.exe`, SVG, HTML, oversized PDF, 4 photos refused; trap
  field saves nothing but answers "sent"; 21st send in an hour refused; repeat phone within 30 days refused, after 30
  days or for another position accepted; storage full → closed + no row; Turnstile success / failure / server down
  against a fake server; same request key twice → one application; two parallel sends → different references;
  tenant / opening ids from the form ignored (opening must be an open opening of that plant); a switched-off opening
  refused. Check the form at 390 px, and from a phone on `pnpm dev:lan` with real photos if possible.

### Phase 5 — Applications for owner / HR desk
- Screens 5–6 as the mock-ups: list with filters, search, position filter; application page with call / WhatsApp,
  resume viewer, status buttons (409 on stale), notes, history, "Applied before", removal date; `seen_at` on first open
  by owner / HR desk.
- Owner CSV (audited, neutralised). Owner **Remove now** through `remove_application` (reason required).
- File route `/api/app/files/<id>`: plant check, inline, `nosniff`, private cache.
- Tests: role matrix for every action, status changes recorded as events, 409, notes append-only, search by phone
  digits / name / place, filters and counts, "Applied before" only within the plant, file route refuses another
  plant's file and plant staff, CSV owner-only and neutralised, Remove now owner-only with reason and leaves only the
  audit line. Check the screens at 390 px.

### Phase 6 — Notifications, tile, support, removal and backup
- `src/server/notify.ts` (the two kinds), `src/server/outbox.ts` + `kit.retryOutbox()`.
- `POST /api/cron/daily`: outbox retry, `purge_applications(now)`, file removals (storage, then backup copy, then
  clear), orphan files. Job applications step in `.github/workflows/daily.yml`, skipped until the GitHub variable
  `JOBS_URL` exists (add it to the header comment).
- `packages/module-kit`: `FileStorage.remove()` (local + S3) and a backup-copy removal helper; tests for both.
- `POST /api/cron/backup` + `backup.yml` step (on with the GitHub variable `JOBS_BACKUP_FILES`, like Attendance).
- Summary badges; support view (read-only, page and file views logged, `/support-access`), `SUPPORT_READY`.
- Tests: one per notification (recipients, ticked HR desk, level, dedupe, no phone number in the text), outbox kept on
  5xx / dropped on 4xx, wrong cron secret 401, purge removes exactly the rows older than 12 months (boundary day) and
  nothing of another plant, files and backup copies removed then the queue cleared, a failed removal retried next day,
  badges for an empty and a mixed plant, every write refused for support, views logged. Verify on `pnpm dev` that
  Sujata (plant 002) gets the bell and the tile shows numbers.

### Phase 7 — Release and deploy
- `apps/job-applications/NOTES.md`, Dockerfile (with a volume for files, like Complaint Box), CLAUDE.md (repo layout,
  "Every module app must" list, public addresses, status note), HANDBOOK section "Job applications: public page,
  Turnstile, QR poster, removal", DEPLOY additions, `docs/deployments/shared.md` record, v0.25.0.
- `scripts/setup-railway-db.sh` / `.sql` include Job applications for new copies; `backup.yml` "every schema has data"
  list gets `job_applications` only after the live migration has run.
- Live:
  - platform migration `0016`
  - `./scripts/add-railway-module.sh shared job_applications jobs_app JOBS 3007 jobs.bluemins.life`
  - Railway service `job-applications` with a volume at `/data`, `CRON_SECRET`, `JOBS_DEFAULT_PLANT=001`, `BACKUP_*`,
    Turnstile keys when ready
  - DNS at WordPress.com: `jobs` CNAME + `_railway-verify` TXT
  - GitHub variables `JOBS_URL`, `JOBS_BACKUP_FILES`
- Checks: `/health`; `jobs.bluemins.life` shows plant 001's page once switched on (404 before); `/applications` without
  a session → PlantOps login; APIs 401; tile without the platform ticket refused; cron with a wrong secret 401.
- Owner's checklist at plant 001: switch it on, enter the openings from the table, print the QR poster, give someone HR
  desk, send a test application from an Android phone and an iPhone (photo CV), get the bell, call, change status,
  CSV, Remove now on the test application.

## Build prompts

Paste **one** phase prompt (as it is) into a new Claude Code session at `~/projects/plantops_platform`; its first
line makes the session read the shared header below. Each starts in plan mode and waits for approval. Run them in
order; each assumes the previous phase is finished and tested.

### Shared header (each phase prompt's first line points here; no need to paste it)
```text
We are building the Job applications module of PlantOps. The agreed design is docs/JOB_APPLICATIONS_PHASE_PLAN.md
(owner approved on 2026-10-17): read it fully, plus CLAUDE.md, before anything else. The screens follow the owner's
mock-ups (link at the top of the plan). Follow the module conventions of apps/complaint-box (public-facing files:
photo shrinking, file sniffing, storage limit, per-plant references, 409 on stale changes, notifications, support
view, backup) and apps/order-capture (owner setup screens, Recent changes, CSV), all through packages/module-kit.
Apps import shared code only from packages/*.

This is the first PlantOps page strangers can write to: treat every public input as hostile. The plant comes only
from the address (code), never from the form; check files by their bytes; apply the spam rules in the plan.

Rules: start in plan mode and wait for my approval; show every migration before running it; ask before any change
to schema, permissions, tenant isolation or the SSO token that is not already in the plan; never trust tenant or
user ids from the browser; enforce access on the server; no secrets in code, docs or tests. Write tests with the
feature (real Postgres test database). Explain each change in plain language; I am not a full-time developer. At
the end of the phase run the tests of every touched app, typecheck and build, and add a short dated note to
apps/job-applications/NOTES.md (create it in phase 2). Don't commit until I say so.

Keep it minimal: an application = name, phone, place, position (or any job), resume, consent. Don't add fields that
are not in the plan. This module must send notifications from day one (docs/notifications.md N5+); the events are
listed in the plan.
```

### Phase 1 prompt
```text
Before anything else, read the "Shared header" in docs/JOB_APPLICATIONS_PHASE_PLAN.md (Build prompts section) and
follow it for this whole session.

Build Phase 1 (Platform registration) of docs/JOB_APPLICATIONS_PHASE_PLAN.md:
- platform migration 0016_job_applications.sql adding module job_applications and role hr_desk (show it first; dev +
  test databases)
- packages/types: MODULE_IDS, ROLE_IDS, ROLE_MODULE (hr_desk → job_applications), the two job_applications kinds in
  NOTIFICATION_KINDS (new is bellOnly; none urgent); plant staff must NOT work in it
- platform: role label and role button text; tile, icon and "⚙ Openings" setup link in apps/platform/src/lib/modules.ts;
  "Job applications storage (MB)" plan limit field; the new module endpoint GET /api/m/plants/by-code/:code exactly as
  the plan says (only job_applications' credentials, { tenant_id, name } only, the same 404 for every refusal);
  confirm the Permissions screen and the "Gets Job applications alerts" tick box work for HR desk without extra code
- make sure apps/dev-module does not serve job_applications
Tests: as listed under Phase 1 in the plan. Then verify on pnpm dev with plant 002.
```

### Phase 2 prompt
```text
Before anything else, read the "Shared header" in docs/JOB_APPLICATIONS_PHASE_PLAN.md (Build prompts section) and
follow it for this whole session.

Build Phase 2 (Module foundation) of docs/JOB_APPLICATIONS_PHASE_PLAN.md:
- ./scripts/setup-module-db.sh job_applications jobs_app JOBS 3007 for dev and test
- apps/job-applications/db/migrations/0001_job_applications.sql with every table, grant, FORCE RLS policy, check
  constraint and security-definer function from the plan's Database section (show it first; explain in plain words
  that the purge and remove functions are the first deletes in any module and why)
- packages/module-kit: the homePath option in createModule() (default "/"; other modules unchanged)
- the Next.js app on :3007 using createModule({ homePath: "/applications" }): callback, support, logout, logo, header
  (🔔 + Account), plant colour, empty /applications, empty summary endpoint, /health, and a proxy matcher that lists
  only the protected paths so the public pages stay public
- one access table in src/server/access.ts used by every route and page
Tests: as listed under Phase 2 in the plan. Verify login through the platform on pnpm dev, and that / answers without
a session.
```

### Phase 3 prompt
```text
Before anything else, read the "Shared header" in docs/JOB_APPLICATIONS_PHASE_PLAN.md (Build prompts section) and
follow it for this whole session.

Build Phase 3 (Openings and the public page) of docs/JOB_APPLICATIONS_PHASE_PLAN.md:
- owner's /openings (list by group, on / off, order, counts, add / edit with every field, page message, Copy link,
  Print QR poster) and /changes; audited; support read-only
- public / and /<code>: plant lookup through the platform (cached a minute), branding, the public logo route, mock-up
  screens 1 and 2 exactly (hero with Send your resume + See the N open jobs, How it works, jobs grouped by area with
  short tags, Didn't find your job? band; one position page); only "Send your resume" when no opening is on; one 404
  page for unknown / suspended / switched-off plants; JOBS_DEFAULT_PLANT for /
Tests: as listed under Phase 3 in the plan. Check screens 1, 2, 7 and 8 at 390 px in headless Chrome against the
mock-ups and tell me what differs.
```

### Phase 4 prompt
```text
Before anything else, read the "Shared header" in docs/JOB_APPLICATIONS_PHASE_PLAN.md (Build prompts section) and
follow it for this whole session.

Build Phase 4 (Sending an application) of docs/JOB_APPLICATIONS_PHASE_PLAN.md:
- mock-up screens 3 (apply form: Any job or a position, name, mobile, place, PDF or 1-3 photos shrunk on the phone,
  consent tick) and 4 (sent, with the reference)
- POST /api/apply/<code> (multipart) with every server rule in "Sending an application": plant from the code, field
  checks, file sniffing and limits, storage limit, trap field, 20 per IP per hour, one per phone per opening per 30
  days, Turnstile when configured, reference under the per-plant advisory lock, files then rows, consent version and
  time, one-time request key (not crypto.randomUUID)
- TURNSTILE_SITE_KEY / TURNSTILE_SECRET in the env reader and .env.example (empty), never real keys
Tests: as listed under Phase 4 in the plan. Check the form at 390 px in headless Chrome, and from a phone on
pnpm dev:lan with real photos if possible.
```

### Phase 5 prompt
```text
Before anything else, read the "Shared header" in docs/JOB_APPLICATIONS_PHASE_PLAN.md (Build prompts section) and
follow it for this whole session.

Build Phase 5 (Applications for owner / HR desk) of docs/JOB_APPLICATIONS_PHASE_PLAN.md:
- mock-up screens 5 (list with status filters and counts, search, position filter, call button) and 6 (application
  page: call / WhatsApp, details, Applied before, removal date, resume viewer, status buttons with 409 on stale
  changes, notes, history, seen_at on first open by owner / HR desk)
- the file route for resume pages (plant check, inline, nosniff, private cache)
- owner CSV (audited, formulas neutralised) and owner Remove now through remove_application (reason required)
Tests: as listed under Phase 5 in the plan. Check screens 5 and 6 at 390 px against the mock-ups.
```

### Phase 6 prompt
```text
Before anything else, read the "Shared header" in docs/JOB_APPLICATIONS_PHASE_PLAN.md (Build prompts section) and
follow it for this whole session.

Build Phase 6 (Notifications, tile, support, removal and backup) of docs/JOB_APPLICATIONS_PHASE_PLAN.md:
- src/server/notify.ts with the two kinds in the plan's table, src/server/outbox.ts + kit.retryOutbox()
- POST /api/cron/daily: outbox retry, purge_applications, file removals (storage, then backup copy, then clear the
  queue), orphan files; the Job applications step in .github/workflows/daily.yml, skipped until JOBS_URL exists
- packages/module-kit: FileStorage.remove() for local disk and S3, and removing a file's backup copy; only this
  module calls them
- POST /api/cron/backup + backup.yml step (on with JOBS_BACKUP_FILES)
- summary badges; support view read-only with page and file views logged, /support-access, SUPPORT_READY on the
  platform
Tests: as listed under Phase 6 in the plan. Verify on pnpm dev that Sujata (plant 002) gets the bell for a public
application and that the tile shows numbers.
```

### Phase 7 prompt
```text
Before anything else, read the "Shared header" in docs/JOB_APPLICATIONS_PHASE_PLAN.md (Build prompts section) and
follow it for this whole session.

Phase 7 (Release and deploy) of docs/JOB_APPLICATIONS_PHASE_PLAN.md:
- NOTES.md, Dockerfile (files volume), CLAUDE.md updates and status note, HANDBOOK section, DEPLOY additions,
  setup-railway-db.sh / .sql, version v0.25.0; then ask me before committing, tagging or pushing to production
- walk me through the live steps one by one (platform migration 0016, add-railway-module.sh with
  jobs.bluemins.life, Railway service + volume + variables incl. JOBS_DEFAULT_PLANT=001, DNS at WordPress.com,
  GitHub variables JOBS_URL and JOBS_BACKUP_FILES, Turnstile keys), waiting for me after each
- run the live checks in the plan, write docs/deployments/shared.md, and give me the owner's checklist for plant 001
```
