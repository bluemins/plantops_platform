# Changelog

One entry per release. Every hosted copy (`docs/deployments/`) runs one of these releases. **Migrations**
lists the new database migrations: run `./scripts/railway-migrate.sh <copy>` for each copy **before**
deploying a release that has any (docs/DEPLOY.md, "Releasing an update").

## Unreleased

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
