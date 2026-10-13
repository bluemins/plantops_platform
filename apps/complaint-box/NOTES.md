# Complaint Box — module notes

Customers' complaints (leaking jar, bad taste, late delivery) logged by plant staff on their phones, with photos or
a short video, followed up and resolved by the owner. Design and build phases: `docs/COMPLAINT_BOX_PHASE_PLAN.md`.

- App `apps/complaint-box` on **:3004**, on `packages/module-kit` (built like `apps/floor-stock`).
- Database schema `complaint_box`, login `complaint_app` (`./scripts/setup-module-db.sh complaint_box complaint_app
  COMPLAINT 3004`), `.env` prefix `COMPLAINT_`.
- Who may do what: **one table**, `src/server/access.ts`, used by every route and page. Owner = everything; complaint
  desk and plant staff = read, log, note, in progress; PlantOps support = read (and Recent changes), never writes.

## Running it
- **Local:** `./scripts/setup-module-db.sh complaint_box complaint_app COMPLAINT 3004` once, then `pnpm db:migrate &&
  pnpm db:seed`; `pnpm --filter @plantops/complaint-box dev` (or `dev:lan` for phones on the same Wi-Fi). Files go
  to `<repo>/.data/complaints`.
- **Tests:** `pnpm --filter @plantops/complaint-box test` (real Postgres test database; files in a temporary folder).
- **Hosted (Railway):**
  - service `complaint-box`, `apps/complaint-box/Dockerfile`, port 3004, health `/health`
  - **own volume at `/data`** with `COMPLAINT_STORAGE_DIR=/data/complaints` and `RAILWAY_RUN_UID=0`
  - also `CRON_SECRET` and the five `BACKUP_*`
  - added to a running copy with `docs/DEPLOY.md` "Adding a module": platform migration first, then
    `add-railway-module.sh`
- **Jobs:**
  - daily (GitHub `daily.yml`, 07:00 IST): `POST /api/cron/daily`, the outbox then still-open reminders; by hand:
    `pnpm --filter @plantops/complaint-box daily`
  - nightly (`backup.yml`, 02:00 IST): `POST /api/cron/backup`, the encrypted copy of new files
  - both are skipped until the GitHub variable `COMPLAINT_URL` exists
- **Switching it on for a plant:**
  1. super_admin → plan → tick Complaint Box (+ optional storage MB)
  2. owner → give staff "Complaint desk" (or Plant staff) and tick "Gets Complaint Box alerts" for whoever should hear
  3. owner → ⚙ Item list → starter list

## Phase log

### 2026-10-11 — Phase 1: platform registration (done, not committed)
Platform migration `0013_complaint_box.sql` (module + role "Complaint desk"), `MODULE_IDS` / `ROLE_IDS` /
`ROLE_MODULE`, six `NOTIFICATION_KINDS`, plan limit "Complaint Box storage (MB)", tile 📢 "Log a complaint" with the
owner's "⚙ Item list" link, `ROLE_LABELS`, dev-module never serves it. Platform tests 264, auth 41.

### 2026-10-11 — Phase 2: module foundation (done, not committed)
- **Database** (`db/migrations/0001_complaint_box.sql`, applied to dev): 7 tables:
  - `items`, `complaints`, `complaint_events`, `files`
  - `support_views`, `audit_log`, `notification_outbox`
  - all with `tenant_id` + FORCE RLS, and **no DELETE anywhere**
  - only these columns may be updated:
    - complaints: `status`, `status_changed_at`
    - items: `name`, `sort_order`, `status`, `updated_at`
    - outbox: the retry columns
  - database checks: Indian mobile, text lengths, resolve / reopen need text, file type and size, `ref_no` unique
    per plant
  - plant-id-only functions `outbox_tenants()`, `open_tenants()`
- **Differences from the plan's wording:** audit table `audit_log` (not `changes`), like the other modules;
  `status 'active' | 'off'` for items; the reference is stored as a number and shown as `C-0001`. In Phase 4 a
  per-plant `pg_advisory_xact_lock` will keep it unique under two saves at once.
- **App:**
  - kit routes (callback, support, logout, support-exit, plant logo), the proxy, `/health`
  - the empty tile answer `{ badges: [] }`
  - header with plant logo / colour, 🔔 and Account; role label Owner / Complaint desk / Plant staff / Read-only
  - empty home page
  - support page views are logged in `support_views`
- **Tests: 44.**
  - FORCE RLS guard over exactly the 7 tables; tenant isolation per table
  - 37 refused statements listed one by one, plus the allowed updates and the database checks
  - the access table for owner / complaint desk / plant staff / store keeper / support
  - login and support through the kit, tile ticket, health
  - all other suites unchanged and passing; `next build` passes
- **Checked on `pnpm dev` (plant 002, test data removed afterwards):**
  - a temporary complaint-desk user logged in on the platform with a temporary PIN, set their own PIN, and landed
    straight in Complaint Box
  - the one-time code gave a module session; the same code a second time → 403
  - the home page at phone width showed the plant logo, colour, 🔔 and the user's name
  - Sujata's tile was open, with live numbers (no badges)
  - without a session: the page goes to the PlantOps login, the API gives 401; health 200
- **Left on dev on purpose:** the module's registration (`MODULE_URL_COMPLAINT_BOX`, secret hash) and the empty schema.

### 2026-10-11 — Phase 3: item list (done, not committed)
- **Screens:**
  - `/items`: the owner adds, renames, moves (↑ ↓) and switches items off / on; each row shows its complaint
    count; "Show switched-off"; support sees the same list without buttons
  - `/changes`: Recent changes for the owner and support
  - home page links to both, for the owner and support
  - complaint desk / plant staff are sent home from both pages, and their API calls get 403
- **Server:** `src/server/items.ts`; API routes `/api/items` (POST), `/api/items/[id]` (PATCH), `/api/items/order`,
  `/api/items/starter`. New access row `view_items` (owner, support).
- **Rules:**
  - names are 1–60 characters, unique among active items, ignoring case and spaces (409 "There is already an
    item with this name"); a switched-off name can be reused, and switching it back on into a clash → 409
  - the product link is chosen once, when the item is added (the database has no UPDATE on `sku_id`)
  - re-order needs exactly the plant's items
  - every change is audited as `item.add` / `item.update` / `item.reorder` / `items.starter`
- **Starter list:**
  - the plant's **active** products (`productLabel`), then Dispenser, Delivery, Other, each with a tick box
  - only the ticked entries are created; nothing is stored for "Skip"
  - only while the plant has no items; a per-plant lock stops a double tap creating two lists
- **Ready for Phase 4:**
  - `pickableItems(user)`: active items only (complaint desk, plant staff, owner)
  - `itemForComplaint(tx, tenantId, id)`: refuses a switched-off item or another plant's item
- **Tests: 64** (20 new in `test/items.test.ts`, plus the `view_items` row). Covered: owner-only, names, product
  link, re-order, starter contents / ticks / once / double tap, pickable items, complaint counts (all statuses,
  own plant only), isolation, Recent changes, POST through `handle()` (401 / 403 / 201).
- **Checked on `pnpm dev` (plant 002, test data removed afterwards):**
  - a temporary second owner, added by super_admin, logged in through PlantOps and set a password
  - in headless Chrome at phone width: the starter offer showed SAMPLEAQUA's 2 products + 3 topics; unticking
    "Other" created 4 items
  - rename, move to top, switch off and a duplicate name (409) all behaved as above, through the module API with
    that owner's session
  - `/items` and `/changes` screenshots looked right
  - support (real handoff from the super_admin API): no buttons, POST refused, `/items` and `/changes` logged
  - a temporary complaint desk user was sent home from both pages; POST → 403
- **After the screenshots:** the starter tick boxes got `shrink-0` (a long product name made one box narrower).
  Not re-photographed.

### 2026-10-11 — Phase 4: logging a complaint + files (done, not committed)
- **Shared storage moved to module-kit** (`packages/module-kit/src/storage.ts`, export `./storage`):
  - local disk / S3 drivers, `sniffType`, `fileSha256`, `fileStorageFrom()`
  - new `sniffVideo()`: MP4 / MOV by the `ftyp` box; HEIC / AVIF photos are not videos
  - Document Store's `src/server/storage.ts` is now a thin wrapper; its 102 tests ran unchanged
- **Own storage:** `COMPLAINT_STORAGE_DIR` (default `<repo>/.data/complaints`, like Document Store's
  `.data/documents`) or `COMPLAINT_STORAGE_BUCKET`, never Document Store's folder or bucket.
- **`/new` (phone form):**
  - fields: customer name, mobile, place, item (active only), batch / date (optional), what went wrong
  - up to 5 photos, shrunk on the phone to ≤ 1600 px JPEG 80%; one video ≤ 30 MB, checked before saving
- **Saving:** `POST /api/complaints` → `{ id, ref: "C-0001" }`.
  - **Phone rule:** `src/lib/phone.ts` (+91 / 91 / 0 dropped; 10 digits starting 6–9); typed and normalised both kept.
  - **Reference:** per plant, under a per-plant lock, so five phones at once get C-0001…C-0005.
  - **From the session only:** plant, reporter and status; anything the browser adds is dropped.
- **Files:** each one is a separate `POST /api/complaints/<id>/files` (raw body).
  - **Checks:** type by content, photo ≤ 10 MB, video ≤ 30 MB, ≤ 5 photos + 1 video (under a per-complaint lock),
    plan storage limit (413 "Storage full for your plan…").
  - **Who (decided with the owner 2026-10-11):** whoever logged it, or the owner, within 24 hours; later pictures
    go with a note (Phase 5).
- **Success screen:** "Saved C-0042", each file's state, a plain "…but N files did not upload" with Try again
  (failed files only).
- **Download:** `GET /files/<id>`: own plant only; byte ranges (206 / 416) for iPhone video; nosniff; strict CSP
  on photos; support file views logged.
- **Bug found by the browser check and fixed:** the form used `crypto.randomUUID()`, which doesn't exist on plain
  `http://` pages (the Wi-Fi address phones use with `pnpm dev:lan`). Picking a photo crashed the form there.
  Local keys are now a counter.
- **Tests: 124 Complaint Box** (60 new: `complaints.test.ts`, `files.test.ts`); module-kit 33 (+14 `sniffVideo`).
  Document Store 102, platform 264, Floor Stock 146, Lab Records 126 and auth 41 all pass. Typecheck and build pass.
- **Checked on `pnpm dev` (plant 002, headless Chrome at phone width; test data and files removed afterwards):**
  - a temporary complaint desk user logged in through PlantOps
  - attached two 4032×3024 photos and a real 2-second MP4 (recorded in Chrome) → **Saved C-0001**, all uploaded
  - the photos were stored at **1600×1200, 131 KB**; the video came back byte-for-byte identical; `Range:
    bytes=0-1` → 206 `bytes 0-1/211186`
  - with the plan limit at 1 MB, C-0003's 3 files failed with "Storage full…" and the banner said so; after the
    limit was raised, Try again uploaded all 3
- **Not tried yet:** a real phone (Android Chrome, iPhone Safari): the camera, HEIC photos from an iPhone, and
  playing the video in Safari.

### 2026-10-11 — Phase 5: inbox, follow-up and resolve (done, not committed)
- **Home `/`:**
  - cards, newest first; status chips (default "Not resolved" = Open + In progress)
  - search by reference (C-0042, c42, 42), name, mobile digits anywhere, place; `%` / `_` taken literally
  - item and date filters (India dates)
  - each card: 📞 tap to call (`tel:+91…`), "Open N days" (amber border and badge after 3 days; counted from
    logging or the last reopening), "Resolved 3 Oct"
  - owner: Item list, Recent changes, Export CSV
- **`/c/<id>`:** details, photos (tap for full size), the video (`playsinline`), history oldest first with each
  note's photos, and only the buttons the person may use:
  - Add note (text required, up to 5 photos)
  - Set in progress (owner, staff)
  - Resolve with the quick picks Replaced / Refund given / Not valid / Entered by mistake (fill the note, still
    editable)
  - Reopen with a reason (owner)
- **Server:**
  - `src/server/inbox.ts`: list, page, CSV
  - `src/server/followup.ts`: notes, status
  - routes `/api/complaints/[id]/notes`, `/api/complaints/[id]/status`, `/api/export`; note photos through the
    files route with `?note=<id>`
- **Status changes:**
  - each states the status it expects; the complaint row is locked
  - someone else changed it first → **409** "This complaint was just changed by <name>. Please reload."
  - the history row and the status are saved in one transaction
  - other moves → 400 with a plain message
- **CSV (owner):** one row per complaint with the whole history in a "History" column; formulas neutralised
  (a typed "+91…" comes out as `'+91…`); audited; shown in Recent changes ("Exported the complaints (CSV, N
  complaints)").
- **Decided with the owner (2026-10-11):**
  - note text required
  - note photos: 5 per note, by its author within 24 h
  - days open since logging / last reopening; amber after 3
  - CSV: one row per complaint
- **Bug found by the tests and fixed:** the "last reopened" lookup compared against the wrong id, so a reopened
  complaint kept its old day count.
- **Tests: 165** (41 new: `list.test.ts`, `followup.test.ts`); all other suites pass; typecheck and build pass.
- **Checked on `pnpm dev`** (plant 002, headless Chrome at phone width, a temporary owner and complaint desk through
  the real platform login; all test data and files removed afterwards):
  - the desk user logged C-0001 (2 photos + video) and C-0002; the list showed both with call links
  - on C-0001 the desk user added a note with a photo and set it In progress
  - the owner resolved it with "Replaced", then reopened it with a reason
  - while the owner's page was open, the desk user set it In progress; the owner's next Resolve said "This complaint
    was just changed by CB Desk. Please reload."
  - the video played in the page
  - CSV download fine; staff export → 403
  - support view: list and page without buttons or call links; a support note → 403

### 2026-10-11 — Phase 6: notifications and daily job (done, not committed)
- **`src/server/notify.ts`:** the six texts. The platform picks the people; the module never sends the customer's
  phone number.

  | Notification | Who gets it | Level |
  |---|---|---|
  | **new** "New complaint C-0042: 20 L jar" | owners + ticked | push |
  | **resolved** | only whoever logged it (`only_listed`); nobody if the owner resolves their own | push |
  | **reopened** | owners + ticked + whoever logged it | push |
  | **updated** (note added / set in progress) | owners + ticked | bell only |
  | **storage** at 80% / 95% of the plan | owners + ticked | push |
  | **still open** (daily job) | owners + ticked | push |

- **Sending:** after the answer (`after()`) from the routes, never blocking the save; whoever acted is always left
  out (`exclude_user_id`).
- **Still-open reminders:**
  - steps at day 3, 10, 17…, counted from logging or the last reopening
  - the job sends the latest step reached, so a missed day catches up
  - key `open:<id>:<logged | reopening id>:d<step>`, so the platform keeps one per step and a reopen starts a new
    series
  - the title shows the real days ("open for 4 days")
  - plants with Complaint Box switched off are skipped
- **Daily job:** `POST /api/cron/daily` (`CRON_SECRET`): outbox first, then reminders. Also `pnpm --filter
  @plantops/complaint-box daily` by hand. GitHub `daily.yml` has a "Complaint Box" step, skipped until the variable
  `COMPLAINT_URL` exists (Phase 8).
- **Fixed after the dev check:** the reminder title showed the step ("open for 3 days") on day 4. It now shows the
  real days; the key still uses the step.
- **Tests: 180** (15 new in `notify.test.ts`):
  - each event's people / level / key / text
  - the routes send exactly one notification, and none when refused or for support
  - storage warns once at 80%
  - reminder steps, catch-up, a reopen restarting the series, a switched-off plant skipped
  - outbox: 503 kept and resent, 400 not kept
  - cron secret: 503 / 401 / 200
  - the tests run Next's `after()` straight away, because it only works inside a real request
- **Checked on `pnpm dev` (plant 002; test data removed afterwards):**
  - a temporary desk user logged C-0001 → **Sujata's real PlantOps inbox got "New complaint C-0001: 20 L jar"**
    (push), then "CB Desk added a note on C-0001" (bell)
  - with the complaint backdated, the daily job sent "C-0001 open for … days"; a second run added nothing; a
    wrong secret → 401

### 2026-10-11 — Phase 7: tile, support view, backups (done, not committed)
- **Tile** (`src/server/summary.ts`), the same for owner and staff:
  - "3 open" (info; "No open complaints" ok when none)
  - "1 open over 3 days" (warn; the same rule as the amber cards, counted from logging or the last reopening)
  - "2 new today" (ok; India date)
  - "Item list not set up yet" (warn) before any item exists
- **Support:** the owner's **`/support-access`** page (`src/server/support.ts`): "PlantOps support viewed complaint
  C-0001 / a photo or video / the item list / the complaint list, 11 Oct 21:12"; owner only; linked from home.
  The platform's super_admin dashboard now offers "Open Complaint Box (read-only)" (`SUPPORT_READY`).
- **Nightly file backup:**
  - `POST /api/cron/backup`, `backupNewFiles("complaint_box", fileStorage())`, into `files/complaint_box/...`,
    encrypted
  - `backup.yml` has a "Complaint Box files" step, skipped until `COMPLAINT_URL`
  - **Phase 8, after the live migration:** add `complaint_box` to the dump's "every schema has data" list in
    `backup.yml`
- **Tests: 190** (10 new: `summary.test.ts`, `support.test.ts`, `backup.test.ts`):
  - badges for an empty, item-only and mixed plant; a reopen resets the days
  - every write refused for support at the proxy (10 routes) and in the server (9 functions + CSV / support log)
  - page and file views logged and shown in words
  - backup copies only new files, which decrypt to the same bytes (in-memory bucket, real `age` keys); route secret
    / "not set up"
  - `age-encryption` added as a test-only dependency
- **Checked on `pnpm dev` (plant 002; test data removed afterwards):**
  - Sujata's launcher tile through the platform's real call: "Item list not set up yet", then
    "3 open · 1 open over 3 days · 2 new today"
  - super_admin dashboard: "Open Complaint Box (read-only)" next to the tile
  - real support handoff: list, complaint, photo and item list opened (200), a note refused (403)
  - the owner's Support access page listed all four views in words; a desk user is sent home from it
  - backup route: wrong secret 401; no `BACKUP_*` locally → "not set up". The real R2 copy is checked live in Phase 8.
- **Noticed, not changed (outside Complaint Box):** Floor Stock has a support view but is missing from the
  platform's `SUPPORT_READY`, so super_admin gets no "Open Floor Stock (read-only)" button. One-line fix if wanted.

### 2026-10-12 — Phase 8: release and deploy (live, v0.12.0)
- Released as v0.12.0 (`a375c8f`), live on the shared copy at `https://complaints.bluemins.life`
  (`docs/deployments/shared.md`). Phases 1–7 above were committed with the release.
- `complaint_box` added to the "every schema has data" check of the nightly dump after the live migration (`91f32c3`).
- 2026-10-13: `/health` 200 with the database OK; the owner has tried it on a phone.
- **To confirm:** volume at `/data`, `COMPLAINT_URL` in GitHub with green Daily jobs / Nightly backup runs, the first
  complaint files in R2; iPhone HEIC photos and Safari video. Delete `.env.railway.shared.complaint_box.paste` once
  saved.
