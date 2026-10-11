# Complaint Box Module — Phase Plan and Build Prompts

**Status:** Design agreed with the owner on 2026-10-11 ("all as suggested"). **Not built.** No phase number yet: to be
scheduled after Phase 6 (Preventive Management), or earlier only if a paying plant asks for it. Schema, permission
and platform changes listed here are agreed in principle; each migration is still shown to the owner before it runs
(CLAUDE.md working rules).

**Progress:** owner decided on 2026-10-11 to build it now, before Phase 6. Phase 1 (platform registration) done
2026-10-11, not committed: platform migration `0013_complaint_box.sql` (applied to dev). Phase 2 (module
foundation) done 2026-10-11, not committed: `apps/complaint-box` on :3004, module migration `0001_complaint_box.sql`
(applied to dev). Phase 3 (item list) done 2026-10-11, not committed. Phase 4 (logging a complaint + files) done 2026-10-11, not committed. Phase 5 (inbox, follow-up and resolve) done 2026-10-11, not committed. Phase 6 (notifications and daily job) done 2026-10-11, not committed. Phase 7 (tile, support view, backups) done 2026-10-11, not committed. Phase 8 (release v0.12.0 and deploy) in progress 2026-10-11. Details in `apps/complaint-box/NOTES.md`. Plan re-checked against the code
the same day (Phase 0); corrections are marked "(Phase 0 check)".

## Purpose

Customers complain to the plant (leaking jar, bad taste, broken seal, late delivery). Today this is a phone call or a
WhatsApp message that gets lost. Complaint Box lets staff record each complaint on their phone, with photos or a
short video, and lets the owner follow it up and close it. The owner hears about every new complaint at once through
PlantOps notifications.

**Mock-ups** (8 phone screens, agreed 2026-10-11): https://claude.ai/artifact/D4hZaggQCqyao9WSUnWWrE (private to
the owner; screens follow them).

## Names used in this plan

| Thing | Value |
|---|---|
| Module id | `complaint_box` (label "Complaint Box") |
| New role | `complaint_desk` (label "Complaint desk") |
| App folder / local port | `apps/complaint-box` on `:3004` |
| Database schema / login | `complaint_box` / `complaint_app` |
| `.env` prefix for the setup scripts | `COMPLAINT` |
| Live address | `complaints.bluemins.life` |
| Plan limit | `limits.modules.complaint_box.storage_mb` |

## Agreed design (owner, 2026-10-11)

### Who uses it
| Person | Can do |
|---|---|
| **Owner** (`tenant_admin`) | Everything below, plus: manage the item list, resolve, reopen, CSV export, see Recent changes |
| **Complaint desk** (new role) and **Plant staff** (automatic, the normal `roleWorksIn` rule) | Log complaints, see all of the plant's complaints, add follow-up notes (with photos), set In progress |
| **PlantOps support** (super_admin) | Read-only view; every page and file view logged on the owner's "Support access" page |
| Anyone else | Nothing. Checked on the server on every route and page, never by tile hiding only |

- `complaint_desk` is tied to `complaint_box` in `ROLE_MODULE`. A user whose only working module is Complaint Box
  (e.g. a delivery driver) skips the launcher and lands straight in the app.
- Complaint Box is **not** added to `PLANT_STAFF_EXCLUDED`.

### Logging a complaint (staff, on a phone)
| Field | Rule |
|---|---|
| Customer name | Required, 2–100 characters |
| Customer phone | Required. Indian mobile: spaces / dashes removed, a leading `+91`, `91` (12 digits) or `0` dropped; the result must be 10 digits starting 6–9. The normalised number is stored for matching; the typed value is stored too |
| Place | Required, free text (area / address), 2–200 characters |
| Item | Required, an **active** item of the same plant (checked on the server) |
| Batch / date printed on the bottle | Optional free text, ≤ 60 characters. Stored as typed; no Lab Records lookup in v1, so a later version can link it to a batch |
| Issue description | Required, 10–2000 characters |
| Photos / video | Optional (a complaint may arrive by phone call) |

- The server records **who logged it, when, and for which plant** from the session. Tenant or reporter ids sent by
  the browser are never used.
- Each complaint gets a **reference per plant**: `C-0001`, `C-0002`, … (unique per plant, allocated inside the
  saving transaction so two saves at once can't get the same number).
- **Saving locks it.** Details are never edited; a mistake is fixed by adding a note.
- Save order on the phone: the complaint is saved first, then each file is uploaded to it. The success screen shows
  "Saved C-0042" and the state of every file. If a file fails, the screen says so plainly ("Saved C-0042, 1 photo
  did not upload: Try again") and never pretends everything worked.

### Item list (owner-managed)
- An item is the **product or equipment** complained about. *What* went wrong goes in the description.
- **Starter list** on first use: the plant's own PlantOps products (`/skus`, linked by `sku_id`) plus "Dispenser",
  "Delivery" and "Other". The owner can accept it, edit it or skip it. Nothing plant-specific in code.
- The owner adds, renames, reorders and switches items off and on. Items are **never deleted**. Old complaints keep
  showing the item's name as it was when logged (name copied into the complaint).
- Every item change is audited and shown in **Recent changes** (owner + support).
- Each item in the list shows **how many complaints** it has (all statuses, counted when the page opens, never
  stored), so the owner sees which product causes the most trouble. Switched-off items show their count too.

### Photos and video
- **Photos:** up to **5 per complaint** (and up to 5 per note). The phone shrinks each one before upload (longest
  side 1600 px, JPEG about 80% quality, so roughly 200–400 KB). The server accepts JPEG / PNG / WebP up to 10 MB, checked
  by the file's first bytes (as in Document Store), never SVG.
- **Video:** **one clip per complaint**, at most **30 MB** (about 20–30 seconds). MP4 or iPhone MOV, checked by
  content (`ftyp` box). Not shrunk on the phone.
- **Plan storage limit** "Complaint Box storage (MB, blank = unlimited)" on the super_admin plan screen
  (`MODULE_LIMIT_FIELDS`). An upload that would pass the limit is refused with a clear message.
- **Storage:** the same private local-disk / S3-compatible storage as Document Store. Files are never replaced or
  deleted. Every download / preview checks module access **and** that the file belongs to the user's plant.
  - (Phase 0 check) That code lives in `apps/document-store/src/server/storage.ts`. Apps may not import another app,
    so Phase 4 first moves it into `packages/module-kit/src/storage.ts`. That means `FileStorage`, the disk and S3
    drivers, `sniffType` and `fileSha256`. Document Store then uses it with its tests unchanged.
  - (Phase 0 check) Complaint Box has **its own Railway volume** (or its own bucket), never Document Store's. Both
    use keys `tenant/<id>/<uuid>`, so a shared bucket would make each module's backup copy the other's files.
- **Video playback must support byte ranges** (`Range` / `206 Partial Content`); iPhone Safari will not play a
  video without it. (Phase 0 check) Neither storage driver reads part of a file, so the download route reads the
  whole file (≤ 30 MB) and answers the requested range from it.
- Files are backed up nightly (encrypted, kept forever) like Document Store's.

### Follow-up and resolving
| Status | Set by | Rule |
|---|---|---|
| **Open** | — | Every new complaint |
| **In progress** | Any authorised user | From Open |
| **Resolved** | **Owner only** | From Open or In progress; **resolution note required** (≥ 3 characters), e.g. "Jar replaced", "Not valid: seal intact", "Entered by mistake" |
| Reopened → **Open** | **Owner only** | From Resolved; **reason required** |

- **Quick-pick buttons when resolving:** "Replaced", "Refund given", "Not valid", "Entered by mistake". Tapping
  one fills the resolution note, which the owner can still change or add to before saving. The same rules apply
  as for a typed note (required, ≥ 3 characters). The four phrases are fixed in v1 (no setting) and stored as
  ordinary note text.
- **Notes:** any authorised user can add a note (with up to 5 photos) to a complaint in any status.
- **History:** every status change and note is a row in an append-only history showing who, when and the text.
  Nothing is overwritten.
- **Two people at once:** a status change states the status it expects; if someone else changed it first, the
  answer is 409 "This complaint was just changed by …, please reload".
- **Kept for good.** The owner can **export to CSV** (every complaint with its history; spreadsheet formulas
  neutralised; the export is audited). Customer phone numbers appear in the list, the CSV and the support view
  because staff need them to call back.

### Complaint list (inbox)
- Owner and authorised staff see **all complaints of their plant**, newest first.
- Filter by status (Open / In progress / Resolved / All), item and date range. Search by reference, customer name,
  phone or place.
- Each row shows the reference, status, item, customer, place, who logged it, when, and how many days it has been
  open. Rows open longer than 3 days are marked amber.
- The complaint page has the details, photos / video, the history, and the buttons the user is allowed to use.
- **Tap to call:** the customer's phone number on the list and on the complaint page is a `tel:+91<number>` link
  (built from the normalised number), so staff can call back with one tap. In the support view it is plain text.

### Notifications (N5+, agreed)
All go through `kit.notify(tenantId, input)` **after** the answer (never blocking the save). Nobody is notified
about their own action (`exclude_user_id`). "Owner + ticked" = the plant's owners + the people ticked "Gets
Complaint Box alerts" (N2). None of the kinds is urgent; each person can mute or downgrade any of them on
`/notifications`.

| # | Kind (`NOTIFICATION_KINDS`) | Event | From | Who | Example title / body | Link | Dedupe key | Level |
|---|---|---|---|---|---|---|---|---|
| 1 | `complaint_box.new` | New complaint saved | Action | Owner + ticked | "New complaint C-0042: 20 L jar" / "Ramesh, Kalinga Nagar. Leaking from the cap… (by Atharv)" | `/c/<id>` | `new:<id>` | Phone + bell |
| 2 | `complaint_box.resolved` | Complaint resolved | Action | **The person who logged it only** (`also_user_ids` + `only_listed`) | "C-0042 resolved" / "Jar replaced" | `/c/<id>` | `resolved:<id>:<event id>` | Phone + bell |
| 3 | `complaint_box.reopened` | Complaint reopened | Action | Owner + ticked + the person who logged it (`also_user_ids`) | "C-0042 reopened" / "Customer called again" | `/c/<id>` | `reopened:<id>:<event id>` | Phone + bell |
| 4 | `complaint_box.still_open` | Not resolved **3 days** after it was opened (or reopened), then **every 7 days** | Daily job | Owner + ticked | "C-0042 open for 3 days" / "20 L jar, Ramesh. Last update: …" | `/c/<id>` | `open:<id>:<open event id>:d<days>` | Phone + bell |
| 5 | `complaint_box.updated` | Note added or set In progress | Action | Owner + ticked | "Atharv added a note on C-0042" | `/c/<id>` | `updated:<id>:<event id>` | **Bell only** (`bellOnly`) |
| 6 | `complaint_box.storage` | Plant storage passes **80%** / **95%** of the plan limit | Upload | Owner + ticked | "Complaint Box storage 80% used" | `/` | `storage:<pct>:<limit MB>` (a bigger plan re-arms it) | Phone + bell |

Reliability: a notification that can't reach the platform (unreachable / 5xx) waits in the module's
`notification_outbox` and is resent by the daily job (`kit.retryOutbox()`), exactly like the other modules.

### Standard pieces (as in every PlantOps module)
- **Launcher tile** (`/api/plantops/summary`): "N open" (info), "N open over 3 days" (warn), "N new today" (ok).
  Max 3 badges.
- **Support view** (`/sso/support`): read-only (proxy + server guards), every page **and file** view logged on the
  owner's `/support-access` page.
- **Daily job** `POST /api/cron/daily` (`CRON_SECRET`): retry the outbox, then "still open" reminders. Plant ids
  come from a `security definer` function (`open_tenants()`: plants with open complaints only), like
  `lab_tenants()`.
- **Backup** `POST /api/cron/backup` with `backupNewFiles("complaint_box", …)` and the five `BACKUP_*` variables.
- 🔔 link in the header (`NotificationsLink`), "Account" link to the launcher, plant colour and logo.
- English labels in v1; Hindi / Odia later (like Document Store's language selector if wanted).

### Not in version 1
- Customer lookup by phone (from a list or Google Sheet): later, once a source is chosen. The normalised phone
  number makes this easy to add.
- Customers filing a complaint themselves through a QR code or public link (Order Capture plans a public link; a
  later step).
- Messages back to the customer (WhatsApp / SMS).
- Assigning a complaint to a particular staff member; due dates.
- Linking the batch text to a Lab Records batch.

## Database (agreed in principle; each migration shown to the owner before it runs)

**Platform** (one migration, like `0007_document_store.sql`):
- add module `complaint_box` to `platform.modules` and role `complaint_desk` to `platform.roles`
- code:
  - `packages/types`: `MODULE_IDS` (after `floor_stock`; the order is the tile order), `ROLE_IDS`, `ROLE_MODULE`,
    the six kinds in `NOTIFICATION_KINDS`
  - `MODULE_LIMIT_FIELDS` (storage MB)
  - tile text, icon and the "⚙ Item list" setup link in `apps/platform/src/lib/modules.ts`
  - `ROLE_LABELS` in `apps/platform/src/lib/api.ts`: the user form lists roles from it
  - dev-module `LABELS` + `REAL_APPS`
- the SSO token is **unchanged**

**Module schema `complaint_box`** (login `complaint_app`; every table has `tenant_id` + FORCE RLS; nothing has a
DELETE grant):

| Table | Holds | `complaint_app` may |
|---|---|---|
| `items` | the plant's item list (`name`, optional `sku_id`, `sort`, `active`) | SELECT, INSERT, UPDATE (`name`, `sort`, `active`, `updated_at` only) |
| `complaints` | one row per complaint (`ref_no`, customer, phone typed + normalised, place, `item_id` + item name, batch text, description, reporter id + name, `created_at`, `status`, `status_changed_at`) | SELECT, INSERT, UPDATE (`status`, `status_changed_at` only) |
| `complaint_events` | history: `in_progress`, `resolved`, `reopened`, `note` with text, who, when | SELECT, INSERT |
| `files` | photo / video records (`complaint_id`, optional `event_id`, kind, type, size, sha256, storage key, uploader) | SELECT, INSERT |
| `audit_log` | audit of item-list changes and CSV exports (Recent changes); named like the other modules' audit tables | SELECT, INSERT |
| `support_views` | support page / file views | SELECT, INSERT |
| `notification_outbox` | notifications waiting to be resent | as in the other modules |

Plus functions `outbox_tenants()` and `open_tenants()` (plant ids only). Database checks: required text lengths,
normalised phone `^[6-9][0-9]{9}$`, `ref_no` unique per plant, a `resolved` / `reopened` event must have text,
status values limited to `open` / `in_progress` / `resolved`.

## Phases

Finish and test each phase before the next. Phase 0 happens once in plan mode; phases 1–8 are the build. Each phase
ends with `pnpm test` for the touched apps, `typecheck`, and a short note in `apps/complaint-box/NOTES.md`.

| Phase | What | Result |
|---|---|---|
| **0** | Placement and prerequisites | Owner confirms it's time; plan re-checked against the code |
| **1** | Platform registration | Module + role + plan limit + notification kinds exist; tile says "not set up" |
| **2** | Module foundation | App on module-kit, own schema and login, login / support / tile skeleton |
| **3** | Item list | Owner manages items; starter list; Recent changes |
| **4** | Logging a complaint + files | Phone form, photos shrunk, video, private storage, storage limit |
| **5** | Inbox, follow-up and resolve | List, search, complaint page, notes, statuses, history, CSV |
| **6** | Notifications and daily job | Six kinds, outbox, still-open reminders |
| **7** | Tile, support view, backups | Badges, support logging for pages + files, nightly backup |
| **8** | Release and deploy | Docs, Dockerfile, Railway service + volume, DNS, live checks |

### Phase 0 — Placement and prerequisites
- Owner confirms Complaint Box is next (after Phase 6, unless decided otherwise) and the open Floor Stock items in
  CLAUDE.md "Where things stand" are done or explicitly deferred.
- Re-read this plan against the current code (module-kit, Document Store uploads, notifications); report anything
  that changed since 2026-10-11.
- Exit: owner says "start".

### Phase 1 — Platform registration
- Platform migration: module `complaint_box`, role `complaint_desk` (label "Complaint desk"). Show it first.
- `packages/types`: `MODULE_IDS`, `ROLE_IDS`, `ROLE_MODULE`, six `NOTIFICATION_KINDS`.
- Platform: plan screen field "Complaint Box storage (MB)"; launcher tile (📢, staff: "Log a complaint", owner
  setup link "⚙ Item list" → `/items`). (Phase 0 check) The role needs an entry in `ROLE_LABELS`; the "Gets
  Complaint Box alerts" tick box is automatic (`alertChoices` uses `roleWorksIn`).
- `apps/dev-module`: a label in `LABELS` (every module must have one) and `complaint_box` in `REAL_APPS`, so the
  placeholder never serves it.
- Tests: role ↔ module (`roleWorksIn` incl. plant staff), plan limit field round trip, tile for a complaint_desk-only
  user lands straight in the module.

### Phase 2 — Module foundation
- `./scripts/setup-module-db.sh complaint_box complaint_app COMPLAINT 3004` (dev + test databases).
- Module migration `0001_complaint_box.sql`: all tables above, grants, FORCE RLS, checks, `outbox_tenants()`,
  `open_tenants()`. Show it first.
- `apps/complaint-box` (Next.js, `:3004`) on `createModule()`: callback, support, logout, logo, proxy, header with
  🔔 and Account, plant colour; empty home page; summary endpoint returning no badges yet; `/health`.
- Server access helpers: who may read, write, resolve / reopen, manage items, export (one table, used by every
  route).
- Tests: tenant isolation (plant B sees 0 of A's rows, can't write A's), FORCE RLS guard on every table, append-only
  refusals (UPDATE / DELETE on events, files, changes; UPDATE of complaint details; DELETE anywhere), the access
  table per role, no session → platform login / 401.

### Phase 3 — Item list
- `/items` screen (owner edits; staff don't see it in the menu, server refuses them).
- Starter list from `/skus` + Dispenser / Delivery / Other; accept / edit / skip.
- Add, rename, reorder, switch off / on; names unique per plant among active items; audited in `audit_log`; Recent
  changes page (owner + support).
- Complaint count per item (all statuses, worked out when the page opens). Until Phase 4 exists every count is 0.
- Tests: owner-only rules, starter list, switched-off item not offered, plant isolation of items. (Phase 5 adds:
  counts include only the plant's own complaints.)

### Phase 4 — Logging a complaint + files
- First: move Document Store's storage code into `packages/module-kit/src/storage.ts` (see Photos and video).
  Document Store's tests must still pass unchanged. Add the video check (`ftyp` box: MP4 / MOV) there.
  Local folder `COMPLAINT_STORAGE_DIR` (default `./.data/complaints`).
- `/new` mobile form: big fields, item picker, optional batch text, photo picker (camera or gallery, shrunk in the
  browser), one video.
- `POST /api/complaints` (JSON) → reference; then `POST /api/complaints/<id>/files` (raw body, `handleUpload`, like
  Document Store) per file; success screen with per-file state and "Try again".
- Phone normalisation, field checks, active item of the same plant, reporter and plant from the session, `ref_no`
  per plant safe under concurrency.
- Files: type by content, size (photo 10 MB, video 30 MB), count (5 photos + 1 video per complaint, 5 photos per
  note), plan storage limit, only the plant's users may attach to their plant's complaint; download route with
  access + plant check and Range support.
- Tests: required fields and lengths, phone rule (good and bad examples), wrong-plant / inactive item, fake reporter
  / tenant in the body ignored, two saves at once get different references, file type / size / count / storage
  limit, cross-plant download refused, Range request answers 206.

### Phase 5 — Inbox, follow-up and resolve
- Home `/`: list with filters (status, item, dates), search (reference, name, phone, place), days open, amber after
  3 days; cards on phones.
- `/c/<id>`: details, photos / video, history, buttons by role: Add note (with photos), In progress (staff +
  owner), Resolve with note (owner), Reopen with reason (owner).
- Resolve sheet with the four quick-pick buttons that fill the note (still editable, same server rules).
- Customer phone as a `tel:+91…` link on the list and the complaint page (plain text in the support view).
- Status changes carry the expected status → 409 if it changed; each change writes an event in the same
  transaction.
- Owner CSV export (complaints + history, formulas neutralised, audited).
- Tests: the status rules per role, resolve / reopen need text (a quick pick alone counts as text), 409 on stale
  status, notes in any status, history order, CSV owner-only and neutralised, list and search isolation, phone link
  built from the normalised number.

### Phase 6 — Notifications and daily job
- `src/server/notify.ts` with the six events and texts above; called after the answer.
- `src/server/outbox.ts` + `kit.retryOutbox()`; `POST /api/cron/daily` (outbox first, then still-open reminders for
  `open_tenants()`, skipped quietly when the module is off for the plant).
- Add the Complaint Box step to `.github/workflows/daily.yml` (skipped until GitHub variable `COMPLAINT_URL`
  exists).
- Tests: one per event (recipients, excluded actor, `only_listed` for resolved, level, dedupe key), still-open at
  day 2 / 3 / 9 / 10 and after a reopen, second run adds nothing, outbox kept on 5xx and dropped on 4xx, wrong cron
  secret 401.

### Phase 7 — Tile, support view and backups
- Summary badges: "N open", "N open over 3 days" (warn), "N new today".
- Support view: read-only in the proxy and server guards; page and file views logged; owner's `/support-access`.
  (Phase 0 check) Add `complaint_box` to `SUPPORT_READY` in `apps/platform/src/app/super/dashboard/page.tsx`. That
  list decides where super_admin gets the "Open … (read-only)" button.
- `POST /api/cron/backup` with `backupNewFiles("complaint_box", …)`; backup step in `.github/workflows/backup.yml`.
- Tests: badges (empty plant, mixed statuses), support refused on every write, page + file views logged, backup
  copies new files only (fake R2 as in module-kit tests).

### Phase 8 — Release and deploy
- `apps/complaint-box/NOTES.md`, Dockerfile, CLAUDE.md status note (+ "Every module app must" list mentions the
  new app), HANDBOOK / DEPLOY additions, `docs/deployments/shared.md` record.
- (Phase 0 check) Also:
  - `scripts/setup-railway-db.sh` / `.sql`: add Complaint Box, so a new copy (e.g. Dedicated) includes it
  - `.github/workflows/backup.yml`: add `complaint_box` to the "every schema has data" list, **only after** the live
    migration has run (otherwise the backup fails)
  - the `.paste` file from `add-railway-module.sh` doesn't have everything: add `COMPLAINT_STORAGE_DIR=/data/complaints`,
    `RAILWAY_RUN_UID=0` (volume), the five `BACKUP_*`. It asks for `BREVO_API_KEY` / `MAIL_FROM`, which this module
    doesn't need
- Live: `./scripts/add-railway-module.sh shared complaint_box complaint_app COMPLAINT 3004 complaints.bluemins.life`,
  platform migration, Railway service **with a volume** (files) or the S3 bucket, `CRON_SECRET`, `BACKUP_*`, DNS
  (`complaints` CNAME + `_railway-verify` TXT at WordPress.com), GitHub variable `COMPLAINT_URL`.
- Checks: `/health`, no session → PlantOps login, APIs 401, tile without the platform ticket refused, cron with a
  wrong secret 401; then the owner tries it on a phone: switch it on for a plant, set up items, log a complaint
  with photos + video from a phone (Android and iPhone), get the notification, resolve it.
- Release as the next minor version.

## Build prompts

Paste **one** phase prompt (as it is) into a new Claude Code session at `~/projects/plantops_platform`; its first
line makes the session read the shared header below. Each starts in plan mode
and waits for approval. Run them in order; each assumes the previous phase is finished and tested.

### Shared header (each phase prompt's first line points here; no need to paste it)
```text
We are building the Complaint Box module of PlantOps. The agreed design is docs/COMPLAINT_BOX_PHASE_PLAN.md
(owner approved "all as suggested" on 2026-10-11): read it fully, plus CLAUDE.md, before anything else. The
screens follow the owner's mock-ups (link at the top of the plan). Follow the
module conventions of apps/document-store (uploads, storage, support view) and apps/floor-stock (setup
lists, notifications, daily job), all through packages/module-kit. Apps import shared code only from packages/*.

Rules: start in plan mode and wait for my approval; show every migration before running it; ask before any
change to schema, permissions, tenant isolation or the SSO token that is not already in the plan; never trust
tenant or user ids from the browser; enforce access on the server; no secrets in code, docs or tests. Write tests
with the feature (real Postgres test database). Explain each change in plain language; I am not a full-time
developer. At the end of the phase run the tests of every touched app, typecheck and build, and add a short
dated note to apps/complaint-box/NOTES.md (create it in phase 2). Don't commit until I say so.

This module must send notifications from day one (docs/notifications.md N5+); the events are listed in the plan.
```

### Phase 0 prompt
```text
Before anything else, read the "Shared header" in docs/COMPLAINT_BOX_PHASE_PLAN.md (Build prompts section) and
follow it for this whole session.

Phase 0 only: check readiness, change nothing.
1. Summarise where the repo stands (CLAUDE.md status log, "Where things stand", apps/floor-stock/NOTES.md
   Pending) and whether Phase 6 (Preventive Management) is done.
2. Re-check docs/COMPLAINT_BOX_PHASE_PLAN.md against the current code: module-kit API, Document Store's upload and
   storage code, NOTIFICATION_KINDS, alert tick boxes, setup-module-db.sh, add-railway-module.sh, backup.ts,
   daily.yml / backup.yml. List anything in the plan that no longer matches and propose the edit.
3. Ask me whether to start Phase 1.
```

### Phase 1 prompt
```text
Before anything else, read the "Shared header" in docs/COMPLAINT_BOX_PHASE_PLAN.md (Build prompts section) and
follow it for this whole session.

Build Phase 1 (Platform registration) of docs/COMPLAINT_BOX_PHASE_PLAN.md:
- the next platform migration adding module complaint_box and role complaint_desk (show it first; dev + test
  databases)
- packages/types: MODULE_IDS, ROLE_IDS, ROLE_MODULE (complaint_desk → complaint_box), the six complaint_box kinds
  in NOTIFICATION_KINDS (complaint_box.updated is bellOnly; none urgent)
- platform: "Complaint Box storage (MB, blank = unlimited)" in MODULE_LIMIT_FIELDS; tile text in
  apps/platform/src/lib/modules.ts; confirm the user form offers the role and the "Gets Complaint Box alerts" tick
  box without extra code
- make sure apps/dev-module does not serve complaint_box
Tests: roleWorksIn for complaint_desk and plant_staff, plan limit round trip, a complaint_desk-only user lands
straight in the module, the notification settings page lists the new kinds. Then verify on pnpm dev with plant 002.
```

### Phase 2 prompt
```text
Before anything else, read the "Shared header" in docs/COMPLAINT_BOX_PHASE_PLAN.md (Build prompts section) and
follow it for this whole session.

Build Phase 2 (Module foundation) of docs/COMPLAINT_BOX_PHASE_PLAN.md:
- ./scripts/setup-module-db.sh complaint_box complaint_app COMPLAINT 3004 for dev and test
- apps/complaint-box/db/migrations/0001_complaint_box.sql with every table, grant, FORCE RLS policy, check
  constraint and function from the plan's Database section (show it first)
- the Next.js app on :3004 using createModule(): callback, support, logout, logo, proxy, header (🔔 + Account),
  plant colour, empty home page, empty summary endpoint, /health
- one access table in the server (read, write, set in progress, resolve / reopen, manage items, export) used by
  every route and page
Tests: tenant isolation, FORCE RLS guard over every table, append-only refusals for complaint_app (list each
refused statement), access table per role (owner, complaint_desk, plant_staff, store_keeper without access, support),
no session → platform login for pages and 401 for APIs. Verify login through the platform on pnpm dev.
```

### Phase 3 prompt
```text
Before anything else, read the "Shared header" in docs/COMPLAINT_BOX_PHASE_PLAN.md (Build prompts section) and
follow it for this whole session.

Build Phase 3 (Item list) of docs/COMPLAINT_BOX_PHASE_PLAN.md:
- /items screen, owner only (server refuses everyone else; support sees it read-only)
- starter list from the plant's PlantOps products (kit products cache, sku_id) + Dispenser, Delivery, Other;
  accept / edit / skip
- add, rename, reorder, switch off / on; never delete; active names unique per plant
- every change audited in `audit_log`; Recent changes page (owner + support)
- each item shows its complaint count (all statuses, worked out when the page opens, never stored)
Tests: owner-only rules, starter list contents, switched-off items not offered for new complaints, isolation.
Check the screen at phone width in headless Chrome.
```

### Phase 4 prompt
```text
Before anything else, read the "Shared header" in docs/COMPLAINT_BOX_PHASE_PLAN.md (Build prompts section) and
follow it for this whole session.

Build Phase 4 (Logging a complaint + files) of docs/COMPLAINT_BOX_PHASE_PLAN.md:
- /new mobile form with the agreed fields and rules (name, phone with the Indian-mobile normalisation, place,
  active item, optional batch text, description ≥ 10 characters)
- photos shrunk in the browser (longest side 1600 px, JPEG ~80%), up to 5; one video ≤ 30 MB (MP4 / MOV)
- POST /api/complaints (JSON) returns the per-plant reference C-0001…, allocated safely under concurrency; then
  one raw-body upload per file to /api/complaints/<id>/files (handleUpload, like Document Store)
- file checks by content, size, count, and the plan storage limit; private storage reused from Document Store's
  pattern (local disk or S3-compatible); downloads check access and plant and support Range (206) for iPhone video
- success screen with the reference and each file's state; a failed upload says so and offers Try again
Tests: every field rule (good and bad phones), wrong-plant and inactive items, browser-sent tenant / reporter
ignored, two parallel saves get different references, file type / size / count / storage limit, cross-plant
download refused, Range answer. Try it on pnpm dev:lan from a phone if possible.
```

### Phase 5 prompt
```text
Before anything else, read the "Shared header" in docs/COMPLAINT_BOX_PHASE_PLAN.md (Build prompts section) and
follow it for this whole session.

Build Phase 5 (Inbox, follow-up and resolve) of docs/COMPLAINT_BOX_PHASE_PLAN.md:
- home list: newest first, filters (status, item, date range), search (reference, name, phone, place), days open,
  amber after 3 days, cards on phones
- /c/<id>: details, photos / video, history, and only the buttons the user may use: Add note (+ up to 5 photos),
  In progress (staff + owner), Resolve with a note (owner), Reopen with a reason (owner)
- the Resolve sheet has quick-pick buttons "Replaced", "Refund given", "Not valid", "Entered by mistake" that fill
  the note (still editable; fixed phrases, no setting; same server rules as a typed note)
- the customer's phone is a tel:+91<normalised number> link on the list and the complaint page (plain text in the
  support view)
- status changes send the expected status; 409 with a plain message if it changed; event + status in one
  transaction
- owner CSV export (complaints + history, formulas neutralised, audited)
Tests: status rules per role, required texts (a quick pick alone is enough), 409 on a stale change, notes in any
status, history order, CSV owner-only and neutralised, list / search isolation, the tel: link, item counts only
from the plant's own complaints. Check the screens at phone width in headless Chrome.
```

### Phase 6 prompt
```text
Before anything else, read the "Shared header" in docs/COMPLAINT_BOX_PHASE_PLAN.md (Build prompts section) and
follow it for this whole session.

Build Phase 6 (Notifications and daily job) of docs/COMPLAINT_BOX_PHASE_PLAN.md, using the notification table
in the plan exactly (kinds, recipients, texts, links, dedupe keys, levels):
- src/server/notify.ts, called with kit.notify after the answer; exclude_user_id = whoever acted; resolved goes to
  the reporter only (also_user_ids + only_listed); reopened adds the reporter
- src/server/outbox.ts + kit.retryOutbox()
- POST /api/cron/daily (CRON_SECRET): outbox first, then still-open reminders (3 days after opening / reopening,
  then every 7 days) for open_tenants(), skipping plants where the module is off
- Complaint Box step in .github/workflows/daily.yml, skipped until the GitHub variable COMPLAINT_URL exists
Tests: one per event (recipients, excluded actor, level, dedupe), still-open at days 2 / 3 / 9 / 10 and after a
reopen, a second run adds nothing, outbox on 5xx kept and on 4xx dropped, wrong secret 401. Verify on pnpm dev
that Sujata (plant 002) gets a new-complaint notification.
```

### Phase 7 prompt
```text
Before anything else, read the "Shared header" in docs/COMPLAINT_BOX_PHASE_PLAN.md (Build prompts section) and
follow it for this whole session.

Build Phase 7 (Tile, support view, backups) of docs/COMPLAINT_BOX_PHASE_PLAN.md:
- summary badges: "N open" (info), "N open over 3 days" (warn), "N new today" (ok)
- support view: read-only in proxy and server guards; page and file views logged; owner's /support-access page
- POST /api/cron/backup with backupNewFiles("complaint_box", …) and the five BACKUP_* variables; the step in
  .github/workflows/backup.yml (skipped until COMPLAINT_URL)
Tests: badges for an empty and a mixed plant, every write refused for support, page + file views logged, backup
copies only new files (fake R2 as in packages/module-kit tests). Verify the tile and the support view through the
real platform on pnpm dev.
```

### Phase 8 prompt
```text
Before anything else, read the "Shared header" in docs/COMPLAINT_BOX_PHASE_PLAN.md (Build prompts section) and
follow it for this whole session.

Phase 8 (Release and deploy) of docs/COMPLAINT_BOX_PHASE_PLAN.md:
- apps/complaint-box/NOTES.md complete, Dockerfile, CLAUDE.md dated status note (and the module list / "Every
  module app must" mentions), HANDBOOK and DEPLOY additions, the next minor release version
- give me the live steps one at a time and wait for me at each: platform migration on the shared copy,
  ./scripts/add-railway-module.sh shared complaint_box complaint_app COMPLAINT 3004 complaints.bluemins.life,
  Railway service with a volume (or the S3 bucket), CRON_SECRET and BACKUP_* variables, DNS at WordPress.com,
  GitHub variable COMPLAINT_URL, deploy from the production branch
- live checks: /health, platform-login redirect, 401s, tile ticket refused without the platform, wrong cron secret
- then a checklist for me on a phone (Android and iPhone): switch it on for a plant, items, a complaint with
  photos + video, the notification, resolve, reopen, CSV
Record everything in docs/deployments/shared.md.
```
