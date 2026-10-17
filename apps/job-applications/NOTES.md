# Job applications — module notes

Design, phases and build prompts: `docs/JOB_APPLICATIONS_PHASE_PLAN.md` (owner approved 2026-10-17). One dated note per
phase below.

## Phase 1 — Platform registration (2026-10-17)
- Platform migration `0016_job_applications.sql`: module `job_applications` ("Job applications") and role `hr_desk`
  ("HR desk"). No other platform table changed; SSO token unchanged.
- `packages/types`: module and role ids, `ROLE_MODULE.hr_desk`, kinds `job_applications.new` (bell only) and
  `job_applications.storage`. Plant staff do not work in it (`PLANT_STAFF_MODULES` unchanged).
- Platform: role label and button text, tile 📋 "Applications" + "⚙ Openings", plan limit "Job applications storage
  (MB)", and `GET /api/m/plants/by-code/:code` (`src/server/plant-lookup.ts`): only Job applications' credentials,
  answers `{ tenant_id, name }` for an active plant with the module on, and the **same 404 "This page is not
  available"** for every refusal (bad / other module's credentials too), so plant codes can't be probed.
- `apps/dev-module` never serves this module.
- Tests: platform 331 (+11 in `test/job-applications.test.ts`; module / role counts updated).
- Verified on `pnpm dev` (plant 002, temporary owner + HR desk user and module secret, all removed afterwards): HR
  desk lands in the module, owner tile open, tick box saved, settings list both kinds, lookup good / unknown / bad code
  / wrong secret / no credentials / module off.
- **For Phase 6:** the plan says the storage alert goes to owners only, but the platform sends module events to owners
  + ticked people; decide then (`only_listed` with the owners, or let ticked HR desk see it).

## Phase 2 — Module foundation (2026-10-17)
- Schema `job_applications`, login `jobs_app` (`./scripts/setup-module-db.sh job_applications jobs_app JOBS 3007`).
- Migration `0001_job_applications.sql`: 9 tables, all with `tenant_id` + FORCE RLS; `jobs_app` SELECT + INSERT plus
  the listed column UPDATEs, **no DELETE anywhere**. The first deletes in any module are two security-definer
  functions: `purge_applications(p_now)` (12 months, all plants; `least(p_now, now())` so a future date can't remove
  recent rows) and `remove_application(tenant, id, reason)` (owner's Remove now; current plant only, reason 3-300).
  Both queue the files in `file_removals` (SELECT-only for the app; filled and cleared only by the functions;
  `clear_file_removal`). `purge_tenants()` = plants with queued file removals.
- `packages/module-kit`: `createModule({ homePath })`, default `/`. The login callback (no / unsafe `next`) and the
  support entry land on it. `safeNext(v, fallback)`. Other modules unchanged.
- App on `:3007`: `homePath: "/applications"`; route groups `(app)` (plant colour, header with 🔔 and Account) and
  `(public)` (`/` and `/[code]`, placeholder until Phase 3, never reads a session); the proxy matcher lists **only the
  protected paths** (`/applications`, `/openings`, `/changes`, `/support-access`, `/api/app/…`).
- One access table `src/server/access.ts`: owner everything; HR desk `read` + `update`; support `read`,
  `view_openings`, `view_changes`; plant staff / other roles nothing.
- Made while building: a person without rights who reaches `/applications` sees a plain "no access" card (the login
  itself already refuses them). The matcher checks (Next's `unstable_doesMiddlewareMatch`) live in their own test
  file: loading that helper next to the login tests broke Next's request storage.
- Tests: Job applications 34 (row-level security, append-only refusals + database checks, the delete functions incl.
  the 12-month boundary and another plant, access table, login / support / proxy, protected vs public paths, tile,
  health); module-kit 62 (+ `safeNext` fallback); Complaint Box, Order Capture and Lab Records login tests unchanged.
  Typecheck and build pass.
- Verified on `pnpm dev` (plant 002 with the module on temporarily, a temporary HR desk user, all removed afterwards):
  `/` and `/002` answer 200 with no cookie; `/applications` without a session → PlantOps login; `/api/app/…` 401;
  `/health` OK; platform login → one-time code → lands on `/applications` with the plant colour, "HR desk", 🔔 and
  Account.

## Phase 3 — Openings and the public page (2026-10-17)
- **Owner screens** (mock-ups 7 and 8): `/openings` (public link + Copy link, Print QR poster, page message, positions
  by group with application counts, on / off switch, ↑ ↓ within the group), `/openings/new` and `/openings/<id>` (every
  field with its limit and counters; "The N applications already received keep the name …"), `/openings/poster` (A4,
  QR drawn on the server with `qrcode`), `/changes` (Recent changes in plain words). Tabs Applications · Openings ·
  Recent changes for owner and support; HR desk has no tabs. Support sees everything read-only.
- **Public pages** (mock-ups 1 and 2): `/` (= `JOBS_DEFAULT_PLANT`), `/<code>`, `/p/<id>`, `/<code>/p/<id>`; hero in the
  plant's colour, How it works, jobs grouped by area (empty groups hidden), "Didn't find your job?" band; only "Send
  your resume" when nothing is open. Figtree font (`next/font`, served by the app itself). One "This page is not
  available" (404) for unknown / suspended / switched-off / malformed codes and unknown or switched-off positions;
  PlantOps unreachable → "Please try again in a few minutes". Public pages never read or set a login cookie. Public
  logo `/api/public/logo/<code>` (public cache 1 h, nosniff).
- **Plant lookup:** `fetchPlantByCode` (`packages/auth`) and `kit.plantByCode` (`packages/module-kit`, cached a minute
  per code, "not found" too; the last answer is used during a platform outage).
- **Made while building:**
  - The module didn't know its own plant code (needed for the public link and poster): the platform's branding answer
    now includes `code` (`TenantBranding.code`, optional). Server-to-server only; no database, permission or SSO token
    change.
  - Root layout no longer pads the page (the public hero is full width); the padding moved to `(app)/layout.tsx`.
  - Recent changes lists changed fields in the form's order (the database keeps the details as JSON, which doesn't
    keep key order).
  - "Send your resume" / "Apply for this job" point to `/apply` and `/<code>/apply` (Phase 4); a plant with the code
    `APPLY` could never be reached at `/apply`, so don't give a plant that code.
  - The "try again later" page answers 200 (a Next page can't set 503); it never says "not available".
- **Differences from the mock-ups** (checked at 390 px in headless Chrome):
  - owner screens use the standard PlantOps header (🔔 + Account) instead of the mock-up's colour bar
  - a "Save message" button (the mock-up has none)
  - group headings and ↑ ↓ buttons on Openings (the mock-up shows a flat list)
  - no "Packaged drinking water · [TOWN]" line under the plant name (modules get name, colour and logo only)
  - on a light plant colour (plant 002's green) the hero text is dark, chosen automatically for contrast
- Tests: Job applications 66 (+32: openings rules / access / order / audit, public plant lookup, page data, logo),
  auth 57 (+4), module-kit 64 (+2), platform branding test (+ `code`). Typecheck (all) and build pass.
- Verified on `pnpm dev` (plant 002 switched on temporarily, temporary owner, openings added through the API, all
  removed afterwards): screens 1, 2, 7, 8, poster and Recent changes at 390 px; public pages 200 with no cookie;
  unknown plant / position 404.

## Phases 4, 5 and 6 — built together (2026-10-17, owner's request)
No database change (Phase 2's tables and functions cover all three). SSO token unchanged.

**Shared code (packages/module-kit):**
- `photo.ts`: the phone-side photo shrinking (≤ 1600 px JPEG), moved out of Complaint Box (its 190 tests unchanged).
- `http.ts`: `rateLimit` / `clientIp` (Railway's X-Real-IP, else the last X-Forwarded-For entry), `readBody` exported.
- File deletes, used only here: `S3Client.delete`, `FileStorage.remove` (local + S3), `removeBackupCopy` (backup
  bucket). Every other module still never deletes.
- Tests: module-kit 69 (+5).

**Phase 4, sending an application** (mock-ups 3 and 4):
- `/apply`, `/<code>/apply` (`?o=<id>` preselects); the sent screen is on the same page (no phone in any link).
- `POST /api/apply/<code>` (`src/server/apply.ts`): same-site Origin, multipart only, 12 MB cap; plant from the code only.
  Order of the checks:
  1. trap field
  2. 20 sends per connection per hour (5 in the first build; raised by the owner the same day, Phase 7)
  3. Turnstile (when both keys are set; Cloudflare down → refused)
  4. fields
  5. files by their bytes (one PDF or 1-3 photos, 5 MB each)
  6. a switched-on opening of this plant
  7. under the plant's lock: double tap = same reference, 30-day repeat rule, plan storage limit, files then rows,
     consent `v1` + time
- A half-way failure removes its files.
- "New application" (bell) and storage 80 / 95 % / full (owners only via `only_listed`) after the answer.

**Phase 5, owner / HR desk** (mock-ups 5 and 6):
- `/applications`: status chips with counts, search by name / place / phone digits / reference, position filter,
  call button.
- `/applications/<id>`:
  - Call / WhatsApp; Applied before (this plant only); removal date
  - resume photos / "Open PDF" via `/api/app/files/<id>` (inline, nosniff, private no-store, photos locked down)
  - status buttons with 409 "Just changed by …"; notes; history; first open by owner / HR desk recorded once (never
    by support)
  - owner "Remove now" with a reason
- Owner CSV `/api/app/export` (audited, formulas neutralised); CSV tab.

**Phase 6:**
- Outbox + `kit.retryOutbox`.
- `POST /api/cron/daily` (`src/server/daily.ts`): outbox, `purge_applications`, queued files removed from storage then
  the backup copy then the queue (a failure stays queued), stray files removed.
- `POST /api/cron/backup`; workflow steps in `daily.yml` (`JOBS_URL`) and `backup.yml` (`JOBS_BACKUP_FILES == 'on'`).
- Tile: "N new" (warn when unopened over 3 days), "N this week", owner "Public page has no openings".
- `/support-access` (owner; link at the foot of Openings); platform `SUPPORT_READY` gains Job applications.

**Made while building:**
- The send logic writes the files inside the transaction (before the rows) rather than before it starts; same result:
  a failure leaves no row and its files are removed.
- `removeApplication` checks the reason itself (400 in plain words) before the database function does.
- Resume photos get the locked-down content-security header, PDFs don't (it would break the phone's PDF viewer; as
  in Document Store).
- A landline that loses its leading 0 can look like a mobile (`0674 2345678` → `6742345678`): the shared phone rule
  of Complaint Box / Order Capture, unchanged.
- The stray-file sweep can't tell a file being saved at that very second from a stray one; it runs at 07:00 IST, so
  the chance is tiny (the send also cleans up after itself).

**Settings** (in `.env.example`, empty): `JOBS_STORAGE_DIR`, `JOBS_STORAGE_BUCKET`, `TURNSTILE_SITE_KEY`,
`TURNSTILE_SECRET`; `CRON_SECRET` and the `BACKUP_*` variables as in the other modules.

**Tests:**
- Job applications 122 (+56: send rules incl. the half-way failure, list / one application / status / notes / files /
  CSV / Remove now, daily job with a fake backup bucket, outbox, tile, support access)
- platform 331, Complaint Box 190, auth 57, module-kit 69
- typecheck for all 14 packages / apps; both builds pass

**Verified on `pnpm dev`** (plant 002 switched on temporarily, temporary owner + HR desk, `JOBS_DEFAULT_PLANT=002` for
the check; all rows, files, bells and users removed afterwards):
- screens 3 and 4 in headless Chrome with a real photo (J-0001)
- a PDF send (J-0002); another site's send refused (403)
- Sujata's bell for both; HR desk not ticked, so no bell
- the tile "2 new · 2 this week"
- HR desk opened, marked Called, a stale change 409, a note; HR desk refused the CSV
- screens 5 and 6; the owner's CSV
- Remove now on J-0002, then the daily job deleted its file

**Not yet verified:**
- a real phone (camera photos, iPhone HEIC); Turnstile with real keys; S3 / backup-bucket deletes against the real
  R2 bucket
- the 5-per-hour limit behind Railway's proxy (which address header it sends)

## Phase 7 — Release and deploy (2026-10-17, v0.25.0)
- **Owner's decisions today:** 20 sends per connection per hour (was 5: a hiring drive on one mobile network shares
  one address); Turnstile unreachable = the send is refused ("try again in a minute").
- Release pieces:
  - `Dockerfile` (port 3007; volume at `/data`, `JOBS_STORAGE_DIR=/data/jobs`, `RAILWAY_RUN_UID=0`)
  - `add-railway-module.sh` (files lines, `JOBS_DEFAULT_PLANT=`, Turnstile lines for this module)
  - `setup-railway-db.sh` / `.sql` (new copies)
  - CHANGELOG v0.25.0, CLAUDE.md, HANDBOOK "Job applications", DEPLOY
- Live steps and checks: `docs/deployments/shared.md`.
