# Changelog

One entry per release. Every hosted copy (`docs/deployments/`) runs one of these releases. **Migrations**
lists the new database migrations: run `./scripts/railway-migrate.sh <copy>` for each copy **before**
deploying a release that has any (docs/DEPLOY.md, "Releasing an update").

## v0.11.0 — 2026-10-11 — Floor Stock "Can make"

**What's in it**
- **Floor Stock works out how many boxes today's stock is enough for**, on the home page and each day page, after
  every count and correction. Each product shows "up to N box (M bottles)" and which material runs out first.
- **Set up by the owner on Sections & items:** a **Contents** button on raw material and consumable items ("1 packet
  = 25,000 g", damage allowance %, labels' count = loose pieces) and a **Recipe** button on finished goods ("1 bottle
  = 18.5 g preform + 1 cap + 1 label"). Bottles per box come from the PlantOps product. Store keepers see it
  read-only; every change shows in Recent changes.
- **Products that share a material** (e.g. one preform for two 1 L brands) are shown together as "make one OR the
  other", with the shared material's total for both.
- Nothing changes in the daily count or in existing data: the setup lives in three new tables.

**Migrations:** Floor Stock `0004_recipes.sql`. Deploy the `floor-stock` service only.

## v0.10.0 — 2026-10-11 — Notification settings, reminder hour, outbox, cleanup

**What's in it**
- **Notification settings** on the notifications page: per kind Phone + bell / Bell only / Off (Bell / Off for
  events that never buzz). Urgent ones are always on: ON HOLD, Form 3/4 FAIL, document expiry, someone locked out.
- **Floor Stock evening reminder hour** chosen by the owner on Sections & items: 5 pm–11 pm or Off (default 8 pm).
  **Evening jobs** now run every hour from 5 pm to 11 pm India time; Lab Records still reminds at 8 pm.
- **Nothing lost when PlantOps is briefly down:** a notification that can't be delivered waits in the module's
  outbox and is resent by the next morning / evening job (up to 10 tries or 3 days).
- **Old notifications** (90 days) are removed by the platform's morning job through a locked-down database
  function; the app itself still can't delete notifications.

**Migrations:** platform `0012_notification_settings.sql`, Floor Stock `0003_reminder_and_outbox.sql`,
Lab Records `0004_notification_outbox.sql`, Document Store `0002_notification_outbox.sql`. Deploy all four
services.

## v0.9.0 — 2026-10-11 — Document Store and PlantOps notifications

**What's in it**
- **Document Store notifications:** expiry at 30 / 7 / 1 days before, on expiry, then weekly (one per document,
  also to the responsible person, once per stage like the email), "You are responsible for …" (only that person),
  new / renewed documents (bell only), storage 80% / 95% full.
- **PlantOps notifications to owners:** someone locked out after 5 wrong PINs / passwords (opens Manage users),
  PlantOps support viewed a module (bell), a module switched on (phone) / off and plan changes (bell), plan
  renewal 30 / 7 / 1 days before and on the day (new platform step in **Daily jobs**).

**Migrations:** platform `0011_platform_notifications.sql` (PlantOps events without a module; renewal list
function). Needs **Postgres 15+**. Before deploying: `CRON_SECRET` on the **platform** service and the GitHub
variable `APP_URL`. Deploy `platform` and `document-store`.

## v0.8.0 — 2026-10-11 — Chosen people get alerts; Lab Records notifications

**What's in it**
- **Gets alerts** tick boxes on Manage users → Edit (and when adding a user, and for super_admin): besides the
  owners, only the people the owner ticks get a module's notifications, e.g. a manager for Floor Stock. Only
  modules the person works in are offered; a role change drops ones that no longer fit; every change is audited.
- **Notifications page** `app.bluemins.life/notifications` for everyone, and a 🔔 with the unread count in every
  module's header (staff who skip the launcher reach their alerts and turn on phone notifications there). The
  launcher bell now shows for everyone.
- **Lab Records notifications:** ON HOLD, Form 3/4 FAIL, ready for approval, approved / rejected (also to the
  technicians who tested the batch), result corrected (bell only), the morning reminder, and "No lab tests
  entered today" at 20:00 (new Lab Records step in **Evening jobs**). WhatsApp alerts are unchanged.

**Migrations:** platform `0010_alert_recipients.sql` (who gets which module's alerts; RLS). Deploy `platform`,
`lab-records`, `floor-stock` and `document-store` (header bell).

## v0.7.0 — 2026-10-11 — App notifications (bell + phone), Floor Stock first

**What's in it**
- **Bell 🔔 on the owner's launcher** with the unread count and a list (tap = open the module page, mark all
  read). Free phone notifications through Web Push once the owner taps **Turn on** (iPhone: Add to Home Screen
  first; the card explains it). PlantOps is now installable (`manifest.webmanifest`, app icon, `sw.js`).
- **Floor Stock tells the owners:** count saved / corrected / low stock / check the count (one notification per
  save, the most serious wins the title), "Today's stock count is not done yet" at 8 pm India time (new
  **Evening jobs** workflow), and setup changes by a store keeper (bell only). Never for the owner's own actions.
- Modules send events with `kit.notify()`; the platform decides who receives them (`POST
  /api/m/tenants/:tid/notifications`). Logging out turns notifications off for that phone. Email alerts are
  unchanged. Design and later phases: `docs/notifications.md`.

**Migrations:** platform `0009_notifications.sql` (tables `notifications`, `push_subscriptions`, both with RLS);
Floor Stock `0002_counting_tenants.sql` (plant ids for the evening job). Before deploying `platform`, add its
three `VAPID_*` variables (`pnpm --filter @plantops/platform push:keys`; docs/DEPLOY.md step 4). Deploy
`platform` and `floor-stock`.

## v0.6.2 — 2026-10-11 — Nightly encrypted backups

**What's in it**
- **Backup** workflow (`.github/workflows/backup.yml`, 02:00 India time): a `pg_dump` of the whole database with a
  new read-only login, checked, encrypted with `age` and uploaded to a private Cloudflare R2 bucket; dumps are kept
  30 days.
- Document Store copies its new uploaded files, encrypted, to the same bucket (`POST /api/cron/backup`, shared code
  in `packages/module-kit/src/backup.ts`, so any future app with files does the same).
- `pnpm backup:keygen` (key pair) and `pnpm backup list | db | files | decrypt` (restore). Only the public key is
  on servers and in GitHub.
- `scripts/setup-backup-login.sh` creates the read-only login `plantops_backup` (SELECT only, read-only sessions,
  BYPASSRLS so the dump has every plant's rows); `railway-migrate.sh` keeps its read access up to date.
- Document Store's S3 signing moved into `packages/module-kit/src/s3.ts` (now also lists a bucket).

**Migrations:** none. One-time setup per copy: docs/HANDBOOK.md section 11, "Setting it up". Deploy
`document-store` (the other apps are unchanged).

## v0.6.1 — 2026-10-08 — Plant staff role

**What's in it**
- **New role "Plant staff"** on the owner's Add user / edit user screens. A general plant worker who can work
  in every module the plant has switched on, with that module's normal staff rights, **except Lab Records**
  (lab technicians and lab leads only; refused by Lab Records' own server).
  - Floor Stock: same as a store keeper (count, add / edit items; no limits or sections).
  - Document Store: same as a document keeper; can be a document's responsible person.
  - Launcher: a tile per module they may open; with only one, they go straight into it.
- The SSO token is unchanged.

**Migrations:** `apps/platform/db/migrations/0008_plant_staff.sql` (adds the role row). Run
`./scripts/railway-migrate.sh <copy>` before pushing to `production`. Deploy **all four apps**: a module still on
v0.6.0 refuses plant staff until it is rebuilt.

## v0.6.0 — 2026-10-08 — Floor Stock

**What's in it**
- **Floor Stock (Phase 5)**, a new module app at `stock.bluemins.life` (port 3002). It replaces the evening
  WhatsApp message:
  - each plant's own sections and items, with a starter list made from the plant's products
  - the daily count: today's production + closing stock, for today or yesterday, pre-filled, locked on submit,
    corrections with a reason; append-only in the database
  - day page with Sold / Used / received worked out against the day before, history by date and by item,
    Recent changes, owner CSV, "Copy as WhatsApp message"
  - low-stock email to the owners (once per item per day), tile badges, read-only support view
- **Platform:** the owner's Floor Stock tile has a "⚙ Set up sections" link; the staff tile says "Daily stock
  count". No database change.
- **Email sender** moved into `packages/module-kit` (shared by Document Store and Floor Stock); Document Store's
  behaviour is unchanged.
- `apps/dev-module` no longer serves Floor Stock or Document Store (development only).
- **Deployment:** new `apps/floor-stock/Dockerfile`; `scripts/add-railway-module.sh` adds a module to a copy that
  already runs; `setup-railway-db.sh` includes Floor Stock for new copies; the daily workflow gets a Floor Stock
  step (skipped until the GitHub variable `STOCK_URL` is set).

**Migrations:** `apps/floor-stock/db/migrations/0001_floor_stock.sql` (new schema `floor_stock`). It needs the
`stock_app` login first. On an existing copy, run `./scripts/add-railway-module.sh <copy> floor_stock stock_app
STOCK 3002 <address>` **before** pushing to `production` (docs/DEPLOY.md, "Adding a module to a running copy").

## v0.5.1 — 2026-10-04 — Document Store email through Brevo's API

**What's in it**
- **Document Store:**
  - reminder emails can go through Brevo's HTTPS API (`BREVO_API_KEY` + `MAIL_FROM`). Railway's Hobby plan blocks
    outgoing SMTP, so SMTP sends timed out. SMTP still works where the host allows it.
  - a failed reminder email is tried again by each daily run for 7 days, then left as failed
- Daily jobs workflow: fixed invalid YAML; it had never run before.

**Migrations:** none.

## v0.5.0 — 2026-10-04 — Document Store follow-ups

**What's in it**
- **Document Store:**
  - owner-only ZIP download (`/api/export/files`): the CSV list plus the original file of every version; audited
  - English / Hindi / Odia screens, chosen from the header (a browser preference; emails stay English)
  - email reminders wait as "pending" until SMTP is set up and are then sent; old "Email is not set up yet"
    rows are retried once SMTP works
  - incomplete SMTP or storage settings now stop with a clear error instead of failing quietly
- Deployment: Railway's `railway.json` is deprecated, and new services can't use it. The `apps/*/railway.json`
  files are removed. Settings are now made in the dashboard, following `docs/DEPLOY.md`, and the Dockerfile is
  set by `RAILWAY_DOCKERFILE_PATH`, which `setup-railway-db.sh` now writes.
- New package: `archiver` (Document Store, for the ZIP).

**Migrations:** none.

## v0.4.0 — 2026-10-04 — first deployable release (Phases 1–4)

**What's in it**
- **Platform (Phase 1):**
  - plant login with plant code + username + PIN/password, and forced change of temporary secrets
  - super_admin: plants, plans, owners, users
  - owner: user management, business details (logo, brand colour), products
  - SSO with one-time handoff codes and EdDSA tokens
- **Launcher (Phase 2):**
  - module tiles per role and plan, with live numbers
  - single-module staff go straight into their module
  - direct module links for phones (`/sso/start`)
  - super_admin Modules screen and plant dashboard
  - plant brand colour on every screen
- **Lab Records (Phase 3):**
  - batches with hold / approve / reject
  - daily tests with automatic pass/fail
  - FSSAI Forms 1–4
  - append-only results, enforced by the database
  - failed-test flow
  - WhatsApp alerts (off until Meta approves)
  - daily reminders, print-ready registers, CSV export
  - support view (read-only, logged)
- **Document Store (Phase 4):**
  - documents with renewal history and files
  - expiry email reminders (off until SMTP is set up)
  - plan storage limit, CSV export, support view
- **Shared module kit** (`packages/module-kit`).
- **Deployment:**
  - Railway config per app (`apps/*/railway.json`)
  - `scripts/setup-railway-db.sh` and `scripts/railway-migrate.sh`
  - GitHub daily-job workflow
  - `docs/DEPLOY.md` and `docs/deployments/`

**Migrations** (all, first setup):
- platform `0001`–`0007`
- lab_records `0001`–`0003`
- document_store `0001`
