# Changelog

One entry per release. Every hosted copy (`docs/deployments/`) runs one of these releases. **Migrations**
lists the new database migrations: run `./scripts/railway-migrate.sh <copy>` for each copy **before**
deploying a release that has any (docs/DEPLOY.md, "Releasing an update").

## Unreleased (planned v0.6.0) — Floor Stock

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
