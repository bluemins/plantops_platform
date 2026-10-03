# Lab Records – module notes

Phase 3 module (`apps/lab-records`, port 3001). Project-wide rules live in the root `CLAUDE.md`; this file
covers what is specific to Lab Records. The approved plan was written on 2026-10-03; the brief is BuildPrompt.md
Phase 3.

## What it does
- **Batches** (Lab Records owns the batch record): batch no. (unique per plant, ignoring case), production date,
  product (`sku_id` + name copied in; products come from the platform). Status: `pending` (awaiting approval) →
  `on_hold` → `approved` / `rejected`.
- **Daily in-house tests**: the plant's own checks (default TDS, pH, turbidity; the plant can add or switch off
  checks). Pass/fail is computed against the plant's limits.
- **FSSAI Forms 1–4** (`refeDocs/sheets/FSSAI STI Forms.xlsx`):
  - Form 1: monthly testing, 16 fixed parameters, per batch, "tested at" in-house or at an outside lab
  - Form 2: NABL lab dispatch, per batch
  - Form 3: source water
  - Form 4: plastic containers
  
  The fields live in one place, `src/lib/forms.ts`, which drives the entry screens, server validation, record
  pages and print layouts.
- **Approval**: owner or **lab lead** approves, releases holds, verifies records ("Verified By") and sets limits.
- **Printing**: `/print/<form>?from&to` shows each register in the sheet's layout (A4 landscape) and
  `/print/batch/<id>` gives a batch report. The browser prints it or saves it as PDF; there is no server PDF
  engine.
- **Search** (`/search`), the **plan history window**, and the **owner's full CSV export** (`/api/export/records`,
  `/api/export/batches`).
- **Support view**: super_admin opens a plant read-only through the support token. Every page view is logged and
  the owner sees it at `/support-access`.

## Rules that are easy to get wrong
- **Append-only, enforced by the database.** `lab_app` has SELECT + INSERT only on entries, entry_versions,
  entry_results, verifications, corrective_actions, batch_events, support_views and audit_log. It has column
  UPDATE only on:
  - `batches(status, held_since, updated_at)`
  - `parameters(name, unit, limit_min, limit_max, active, sort, updated_at, updated_by)`
  - `alerts(status, error, sent_at)`
  
  There is no DELETE anywhere. Saving an entry creates version 1, locked, with no drafts. A **correction** is a
  new version of the same entry with a required reason (also a database check). A **retest** is a new entry.
- **Limits are copied into each result** (`entry_results.limit_min/max`) when it is tested. A later limit change
  never alters a past verdict; corrections reuse the original limits.
- **Hold:** any failing result on a batch, in the same transaction that saves it, puts the batch on hold
  (`held_by "System (failed test)"`). This includes an approved batch: a late failure blocks dispatch again. A
  second failure while already on hold adds no new event or alert.
- **"Still failing" is judged per parameter by the most recent result on the batch**
  (`stillFailing()` in `src/server/approval.ts`). A passing retest clears TDS; the failed entry stays failed on
  record. A correction never releases a hold by itself.
- **Release** needs a corrective note written since the hold AND nothing still failing. **Approve** needs status
  pending, ≥ 1 test (daily or Form 1) and nothing failing. **Reject** (from pending or on hold) is final and needs
  a reason.
- **Owner** views, approves, verifies, sets limits and exports, but does not enter test data. **Lab lead** does
  everything except export. **Technician** enters data and corrective notes.
- **Form 3/4 "Fail"** alerts the owner and lab leads but holds nothing (not batch-linked).
- **Dates:**
  - Forms are dated by their main date (stored as noon India time).
  - Daily tests can go back 30 days; forms up to 730 days (outside lab reports arrive late, and paper records are
    copied in).
  - "Today" is always India time.

## Sessions
- **User session:** `plantops_lab_records` cookie (12 h, refreshed in `src/proxy.ts` with the 5-minute platform
  re-check). Pages and APIs check it again in `src/server/session.ts`, so a missed proxy match can't open
  anything.
- **Support session:** `plantops_lab_records_support` cookie (15 min, its own audience, read-only).
  - The proxy refuses every non-GET with it.
  - Server guards refuse the support user too.
  - `requirePageUser` logs one `support_views` row per page.
- The login callback redirects with a **relative** Location. `req.url` is the server's own listening address
  (`0.0.0.0` in phone mode), which phones can't open.

## Alerts (WhatsApp)
- Every alert is written to the `alerts` outbox first, one row per owner / lab lead from the platform's
  `alert-contacts`, then delivered.
- Without `WHATSAPP_TOKEN` + `WHATSAPP_PHONE_ID` + `WHATSAPP_TEMPLATE`, rows are marked
  `skipped – WhatsApp is not set up yet`. A missing mobile number gives `skipped`; a platform outage gives
  `failed`.
- **Meta setup:** create an approved *utility* template (e.g. `plantops_lab_alert`) whose body has exactly one
  variable `{{1}}`, for example `{{1}}`. The app sends the whole alert text in that variable
  ("PlantOps · SAMPLEAQUA: Batch B-1004 ON HOLD – TDS 620 mg/L (max 500). …"). Set `WHATSAPP_TEMPLATE_LANG` if
  the template is not `en`.
- Numbers are normalised to `91XXXXXXXXXX` (`whatsappNumber()`).

## Daily job
- Endpoint: `POST /api/cron/daily` with header `x-cron-secret: $CRON_SECRET`. It is off (503) without the
  secret.
- In production: a host cron line every morning (e.g. 07:30 IST) calling that URL. In development:
  `pnpm --filter @plantops/lab-records daily`.
- It sends one reminder per plant per day: batches on hold for more than 24 h, and from the 25th "Form 1 not
  recorded this month". It also retries waiting alerts.
- It finds plants through `lab_records.lab_tenants()`, a security-definer function that returns plant ids only.
  Each plant is then processed inside its own `withTenant`.

## Settings (environment)
| Setting | Purpose | Required? |
|---|---|---|
| `PLATFORM_URL` | the platform | yes |
| `MODULE_SECRET_LAB_RECORDS` | this module's client secret | yes |
| `LAB_SESSION_SECRET` | ≥ 32 characters | yes |
| `LAB_DATABASE_URL_APP` | `lab_app` login | yes |
| `MODULE_URL_LAB_RECORDS` | https → secure cookies | no |
| `CRON_SECRET` | turns on the daily job | no |
| `WHATSAPP_*` | real WhatsApp sending | no |

Migrations run with `DATABASE_URL_OWNER`. Local setup: `scripts/setup-lab-db.sh` (creates `lab_app`, writes the
LAB_* lines).

## Platform endpoints used
- `/api/sso/exchange` and `/api/sso/support-exchange`
- `/.well-known/jwks.json`
- `/api/m/tenants/:tid/users/:uid/status`, which includes `display_name` for Sign / Verified By
- `/api/m/tenants/:tid/branding` and `logo`
- `/api/m/tenants/:tid/skus`
- `/api/m/tenants/:tid/alert-contacts`
- `/api/tenants/:id/plan` (`limits.modules.lab_records.history_months`)

## Tests
`pnpm --filter @plantops/lab-records test` runs against the real Postgres test database and a fake platform
(`test/fake-platform.ts`).

| File | Covers |
|---|---|
| `session.test.ts` | login and session |
| `records.test.ts` | parameters, batches, daily tests, versions, append-only refusals, isolation |
| `approval.test.ts` | hold / release / approve / reject, WhatsApp, daily job |
| `forms.test.ts` | Forms 1–4, verification, search, history window, export, print |
| `support.test.ts` | support view |

## Open / later
- **Batch lookup API for other modules:** the read logic exists (`getBatch`, status). The endpoint, and how Floor
  Stock proves who it is, are designed in Phase 4.
- **"Record of Test Report"** on Form 3 prints as an empty column. The sheet has it, but it isn't clear what goes
  there; ask a plant.
- **The sheet's Form 4 heading row** has "Remark" over the second Results sub-column. The print uses the
  evident intent: Results = Overall migration + Remaining parameters, then Remark, Sign, Verified By.
- Hindi / Odia labels (CLAUDE.md UX) are not done yet.
