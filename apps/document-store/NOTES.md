# Document Store – module notes

Phase 4 module (`apps/document-store`, port 3003), inserted by the owner on 2026-10-04. It holds the plant's
licences and certificates (FSSAI, BIS, pollution board, fire NOC, NABL…): their details, the file, every renewal,
and email reminders before and after expiry. Project rules live in the root `CLAUDE.md`. Built on the shared
module kit (`packages/module-kit`), like Lab Records.

## What it does
- **A document** has a name, certificate / licence no., issued on, expires on (blank = never), authority,
  contact for renewal / support, remark, a **responsible person**, and **a file** (PDF / JPG / PNG / WebP,
  ≤ 10 MB).
- **The responsible person** is one of the plant's owners or document keepers, taken from the platform's
  `alert-contacts` (with email).
- **Renew** adds a new version with the new file and expiry. **Correct details** adds a new version with a
  required reason; the file is kept unless replaced. **Archive / restore** hides a document and stops its
  reminders; nothing is deleted.
- **Documents table** (home): Name | Certificate no. | Authority | Expires | Status | Responsible | Last
  reminder | File. It shows as cards on phones.
  - Filters: all / expiring ≤ 30 days / expired / no expiry / archived
  - Search: name, certificate no., authority
  - Sorted by the soonest expiry
- **Who:**
  - Owner and **Document keeper** manage documents.
  - Only the owner exports (`/api/export`, CSV of every version) and sees `/support-access`.
  - super_admin's support view is read-only, and every page **and file** opened is logged.
- **Tile:** "N expired" (red), "N expiring soon" (amber), "N documents".

## Rules that are easy to get wrong
- **Append-only, enforced by the database.** `doc_app` has SELECT + INSERT everywhere. Column UPDATE only on:
  - `documents(status, responsible_user_id, responsible_name, updated_at)`
  - `reminders(status, error, sent_at)`
  
  There is **no DELETE**. Files are never replaced: storage writes use "create only" (`wx`), and keys are random
  (`tenant/<tenant_id>/<uuid>`).
- `document_versions`:
  - `version = 1` ⇔ `kind = 'initial'`
  - v > 1 needs a reason (database check)
  - issued_on ≤ expires_on
- **Uploads** (`POST /api/files`):
  - The raw file is the body, with its own Content-Type and the name in `X-File-Name` (URL-encoded).
  - The kit's `handleUpload` refuses form / plain-text types (CSRF), and checks size by header and while
    reading.
  - The type is decided by the first bytes (`sniffType`), never by the name.
  - The plan limit `limits.modules.document_store.storage_mb` covers the plant's total stored bytes.
- **Downloads** (`/files/:id`): the session plus RLS (another plant's file id → 404), `nosniff`, `no-store`, a CSP
  on images, `?download=1` to save.
- **Reminder stages** (`reminderStage()` in `src/lib/expiry.ts`, India dates):
  - `d30` (8–30 days left), `d7` (2–7), `d1` (1)
  - `d0` (expiry day **or up to 6 days after**: a late-added document or a missed run still gets the expiry
    mail)
  - `expired_wN` weekly after that
  
  Only the current stage is queued. The unique key `(version, stage, person)` sends it once, and a renewal (new
  version) starts afresh.
- **Recipients:** all owners + the responsible person.
  - No email → the row is `skipped – No email saved for this person`.
  - The responsible person no longer an owner/keeper → `skipped`.
  - **One email per person per run**, listing all their due documents.

## Settings (environment)
| Setting | Purpose | Required? |
|---|---|---|
| `PLATFORM_URL` | the platform | yes |
| `MODULE_SECRET_DOCUMENT_STORE` | this module's client secret | yes |
| `DOC_SESSION_SECRET` | ≥ 32 characters | yes |
| `DOC_DATABASE_URL_APP` | `doc_app` login | yes |
| `MODULE_URL_DOCUMENT_STORE` | https → secure cookies; also the link in emails | no |
| `DOC_STORAGE_DIR` | local files (default `./.data/documents`, gitignored) | no |
| `STORAGE_BUCKET` + `STORAGE_ENDPOINT` / `STORAGE_REGION` / `STORAGE_ACCESS_KEY_ID` / `STORAGE_SECRET_ACCESS_KEY` | S3-compatible storage (path-style, AWS SigV4, no SDK); used when the bucket is set | no |
| `SMTP_HOST` / `SMTP_PORT` / `SMTP_USER` / `SMTP_PASS` / `MAIL_FROM` | email reminders. Amazon SES (Mumbai) SMTP works. Until set, reminders read "Email is not set up yet" | no |
| `CRON_SECRET` | turns on the daily job: `POST /api/cron/daily` with `x-cron-secret`; dev: `pnpm --filter @plantops/document-store daily` | no |

Local setup: `./scripts/setup-module-db.sh document_store doc_app DOC 3003`, then
`pnpm db:migrate && pnpm db:seed`.

## Tests
`pnpm --filter @plantops/document-store test` runs against the real Postgres test database, a fake platform
(owners / keepers with emails, plan storage limit), a temporary file folder and a fake mailer.

| File | Covers |
|---|---|
| `documents.test.ts` | files, versions, append-only refusals, isolation, table, export |
| `reminders.test.ts` | stages, recipients, once-only, grouping, failures |
| `session.test.ts` | login, support view, upload route, tile |
| `storage.test.ts` | local and S3 drivers, file types |

## Open / later
- **The S3 driver** is tested against a fake S3 server (`test/storage.test.ts`: signing and round trip). Verify
  against the real bucket at deployment.
- **Real email sending:** needs an SMTP account. Nobody in plant 002 has an email address saved yet, so add them
  in Users.
- **The export lists details, not the files.** A zip of all files for a leaving plant is a later step if asked.
- Hindi / Odia labels: not done.
