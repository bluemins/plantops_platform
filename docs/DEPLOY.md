# Deploying PlantOps (Railway)

The exact setup steps. For the overview and day-to-day running (local vs production, new plants, own domains,
password resets, troubleshooting), see [HANDBOOK.md](HANDBOOK.md).

One recipe for every hosted copy of PlantOps:
- **`shared`**: the normal copy at bluemins.life that every plant uses.
- **Dedicated copies**: one per paying plant, set up only when needed (CLAUDE.md, "Multi-tenancy and deployment").

Every copy runs the **same code and the same release**. Only its settings differ. Each copy has a record in
[`deployments/`](deployments/) saying where it runs and which release it is on.

> A **new plant on the shared copy needs no deployment.** Create it in super_admin
> (`https://app.bluemins.life/super`). It is new rows in the same database, kept apart by row-level security.

## What a copy is made of

One Railway project in the **Singapore** region (lowest cost; data location is noted in CLAUDE.md), holding:

| Railway service | Built from | Health check path | Address (shared copy) | Notes |
|---|---|---|---|---|
| `Postgres` | Railway's PostgreSQL template | | private only | Keep the name `Postgres`: the settings refer to it |
| `platform` | `apps/platform/Dockerfile` | `/.well-known/jwks.json` | `app.bluemins.life` | login, launcher, super_admin, SSO |
| `lab-records` | `apps/lab-records/Dockerfile` | `/health` | `lab.bluemins.life` | |
| `document-store` | `apps/document-store/Dockerfile` | `/health` | `docs.bluemins.life` | + a volume at `/data` for uploaded files |
| `floor-stock` | `apps/floor-stock/Dockerfile` | `/health` | `stock.bluemins.life` | no volume (everything is in the database) |
| `complaint-box` | `apps/complaint-box/Dockerfile` | `/health` | `complaints.bluemins.life` | + its own volume at `/data` for complaint photos / videos (`COMPLAINT_STORAGE_DIR=/data/complaints`) |
| `order-capture` | `apps/order-capture/Dockerfile` | `/health` | `orders.bluemins.life` | no volume (no files; everything is in the database) |
| `attendance-salary` | `apps/attendance-salary/Dockerfile` | `/health` | `attendance.bluemins.life` | + its own volume at `/data` for bill photos (`ATTEND_STORAGE_DIR=/data/attendance`, since v0.22.0). Its `ATTEND_SESSION_SECRET` also makes the printed QR's key |

Service settings are set in the Railway dashboard, following this page. The Dockerfile is chosen by the
`RAILWAY_DOCKERFILE_PATH` variable, which is in each service's pasted block. Railway's old `railway.json`
("Config as Code") stops working on 2026-12-01, and new services can't use it. Its replacement,
"Infrastructure as Code" (`.railway/railway.ts`, applied with the Railway CLI), is worth adopting only if
Dedicated copies become frequent.

The daily reminder jobs run from GitHub (`.github/workflows/daily.yml`), so they add nothing to Railway's bill.
`apps/dev-module` is development-only and is never deployed.

Secrets for a copy live in **two places only**: Railway (service variables) and your password manager. The
file `.env.railway.<copy>` stays on your computer for migrations. It is ignored by git, so it is never
committed.

## Setting up a new copy

Pick a copy name: `shared`, or e.g. `acme` for a Dedicated plant. You need `psql`
(`sudo apt install postgresql-client`), Node and pnpm on this computer, plus the repo checked out on the release
tag you are deploying.

1. **Railway project.** Railway → New Project → *Deploy PostgreSQL*. In the Postgres service go to Settings →
   Region and choose **Singapore**.
2. **Database setup (this computer).** In Postgres → Variables, copy `DATABASE_PUBLIC_URL`, then run:
   ```bash
   ./scripts/setup-railway-db.sh <copy>
   ```
   Paste the address when asked (it is not shown on screen), then enter the four web addresses and the
   super_admin email. The script does the following:
   - creates the database logins (same rules as local: apps never connect as the table owner)
   - generates every secret
   - runs all migrations
   - creates the super_admin and registers the modules' addresses

   It writes:
   - `.env.railway.<copy>`: **keep it**, and save a copy in your password manager.
   - `.env.railway.<copy>.paste`: the settings for step 4. Delete it once pasted.
3. **App services.** Do this four times, for `platform`, `lab-records`, `document-store` and `floor-stock`:
   - Railway → *+ Create* → *GitHub Repo* → `bluemins/plantops_platform`. If the repo isn't listed, use
     *Configure GitHub App* and give Railway access to it. The build that starts by itself may fail; ignore it.
   - Rename the service if Railway lets you (the name is only a label).
   - In Settings:
     - Source → *Root Directory*: leave **empty**. The Dockerfiles build from the repo root.
     - Source → *Branch*: **`production`**. Railway deploys only that branch. `main` is everyday work and
       never goes live by itself.
     - Source → *Watch Paths* (optional; saves build minutes): `apps/<app>/**`, `packages/**`,
       `pnpm-lock.yaml`.
     - Config-as-code: leave it alone.
     - Deploy → *Healthcheck Path*: from the table above.
     - Scale → *Regions*: **Southeast Asia (Singapore)**, 1 replica.
   - Click *Deploy* in the "Apply changes" bar at the top of the canvas.
4. **Settings.** For each service, go to Variables → *Raw Editor* and paste that service's block from the
   `.paste` file. The block includes `RAILWAY_DOCKERFILE_PATH`. Then click *Deploy*. Afterwards, Settings →
   Build should show the Dockerfile builder.
   - **Phone notifications** (platform only): run `pnpm --filter @plantops/platform push:keys` and paste its three
     lines (`VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`) into `platform`'s Variables. **Every copy
     gets its own pair**; never reuse another copy's. Save the pair in the password manager. Without them the
     launcher bell works but phones get nothing.
5. **Files volume.** On `document-store`, add a volume (right-click the service → *Attach volume*) mounted at
   `/data`. 1 GB is plenty to start.
6. **Addresses.** For each app service: Settings → Networking → *Custom Domain*. Enter its address and port
   (`platform` 3000, `lab-records` 3001, `document-store` 3003, `floor-stock` 3002). Railway shows a CNAME target, and sometimes a
   TXT record.
7. **DNS** (WordPress.com → Domains → bluemins.life → DNS records → Add record), once per address:
   - Add a **CNAME** with name `app` (then `lab`, `docs`, `stock`) pointing to Railway's target.
   - Add any TXT record Railway asks for, exactly as shown.
   - Don't touch the GitHub Pages records for `bluemins.life` / `www`.

   Railway issues the HTTPS certificate itself, usually within an hour.
8. **Daily jobs.** GitHub → repo Settings → Environments → *New environment* named `<copy>`:
   - variables `LAB_URL`, `DOCS_URL` and `STOCK_URL`
   - secret `CRON_SECRET`

   Also the variable `APP_URL` (the platform address) for the platform's daily job, and put the same `CRON_SECRET`
   on the **platform** service's Variables.
   The values are at the bottom of the `.paste` file. For a new Dedicated copy, also add its name to `copy:`
   in `.github/workflows/daily.yml` **and** `.github/workflows/evening.yml` (8 pm "count not done" reminder).
9. **Check it** (see "Checks after a deploy" below), then write the copy's record in
   `docs/deployments/<copy>.md` and commit it.

## Adding a module to a running copy

For a copy set up before the module existed (the `shared` copy got Floor Stock, Complaint Box, Order Capture and
Attendance this way). Do it
together with the release that contains the module, **before** pushing that release to `production`: the module's
migration needs its database login to exist.

**Order matters when the release also adds the module to the platform** (Complaint Box: platform migration `0013`;
Order Capture: `0014`; Job applications: `0016`; Attendance needs none: its module row exists since `0001`).
Run the platform migration first:
`PLANTOPS_ENV_FILE=$PWD/.env.railway.<copy> pnpm --filter @plantops/platform db:migrate`. The script registers the
module by updating the row that migration creates. It now stops with a plain message if the row isn't there yet.
After the script, run `./scripts/railway-migrate.sh <copy>` once, so the backup login can also read the new schema.

1. **Database, secrets, registration (this computer).** Check out the release tag, then e.g.:
   ```bash
   ./scripts/add-railway-module.sh shared floor_stock stock_app STOCK 3002 stock.bluemins.life
   ```
   Paste `DATABASE_PUBLIC_URL` when asked (not shown on screen). The script:
   - creates the `stock_app` login
   - runs the module's migrations
   - registers only this module's address and secret with the platform

   It adds two lines to `.env.railway.<copy>` (update your password-manager copy) and writes
   `.env.railway.<copy>.<module>.paste` with only what that module needs. `CRON_SECRET` is always included. The Brevo
   lines appear only for modules that send email; modules that store files (Document Store, Complaint Box, Job
   applications) get their storage folder, `RAILWAY_RUN_UID=0` and the five `BACKUP_*`. Job applications also gets
   `JOBS_DEFAULT_PLANT=` (the plant at the bare address, `001` on the shared copy) and the two Turnstile lines (fill
   them in later, docs/HANDBOOK.md "Job applications"). A module without files (Floor Stock,
   Order Capture) needs no volume and no `BACKUP_*`.
2. **Service.** Create the `floor-stock` service exactly like step 3 of "Setting up a new copy" (branch
   `production`, Healthcheck `/health`, Singapore). Paste the `.paste` block into its Variables → Raw Editor.
   Fill in the empty lines with the same values the `document-store` service has. A module that stores files also
   needs a **volume at `/data`** (right-click the service → *Attach volume*). Then delete the `.paste` file.
3. **Address and DNS:** steps 6–7 above (`stock`, port 3002).
4. **Daily job:** add the module's variable to the GitHub environment (`STOCK_URL` = `https://stock.bluemins.life`,
   `COMPLAINT_URL` = `https://complaints.bluemins.life`, `ORDER_URL` = `https://orders.bluemins.life`,
   `ATTENDANCE_URL` = `https://attendance.bluemins.life`, `JOBS_URL` = `https://jobs.bluemins.life` plus
   `JOBS_BACKUP_FILES` = `on` once its `BACKUP_*` are set). Its daily
   (and, for Complaint Box, backup) step is skipped until it is set. Add the module's schema to the "every schema has
   data" list in `backup.yml` **after** its live migration, so each nightly dump is checked for it.
5. **Release** as below (no other migration needed for this module), then run the checks.
6. **Switch it on for a plant:** super_admin → the plant → plan → tick Floor Stock, and give the store keeper
   the `store_keeper` role.

## Releasing an update

> Postgres **15 or newer** is required from v0.9.0 (migration `0011` uses `unique nulls not distinct`). Check with
> `select version();` on the copy before migrating.

Branches: **`main`** is everyday work. Pushing it is only a backup on GitHub; nothing goes live. **`production`**
is what Railway runs, and pushing to it deploys.

1. Write the release in `CHANGELOG.md`: what changed in plain words, and **which migrations it adds**.
2. Commit, then tag the release: `git tag v0.5.0 && git push origin main --tags`.
3. For **each copy** in `docs/deployments/`:
   1. If the release adds migrations, run them **before** the new code goes live:
      `./scripts/railway-migrate.sh <copy>`. This is safe because migrations are always backward-compatible
      (CLAUDE.md), so the old code keeps working on the new database.
   2. Go live: `git push origin v0.5.0:production`. Railway rebuilds only the services whose files changed
      (if Watch Paths are set).
   3. Run the checks below, then update "Runs release" in that copy's record.

**Going back** to the previous release, if something is wrong:
- `git push --force origin v0.4.0:production`.
- Or in Railway → service → Deployments, pick the previous deployment → *Redeploy*.

Migrations stay; the older code works with them because they are backward-compatible.

**What is local and what is on Railway:**
- **Code** reaches Railway only by pushing to `production`.
- **Settings:** the local `.env` and Railway's Variables are separate.
- **Database commands** (`pnpm db:migrate`, `db:seed`, `super:set-password`) touch the **local** database,
  unless they go through `scripts/railway-migrate.sh <copy>` or `PLANTOPS_ENV_FILE=$PWD/.env.railway.<copy>`.

## Checks after a deploy

- Open `https://<app address>/.well-known/jwks.json`, then `/health` on the lab, docs, stock, complaints and orders addresses.
  All answer, the module ones with `"database":"ok"`.
- super_admin logs in at `/super/login`. On a new copy, change the generated password first.
- Modules screen: the Lab Records, Document Store and Floor Stock addresses are the `https://` ones.
- A test plant with both modules switched on:
  - The owner sees tiles with numbers.
  - Lab Records, Document Store and Floor Stock open through the launcher; the owner's Floor Stock tile has
    "⚙ Set up sections".
  - Opening the lab address directly on a phone goes through login and back into the module.
- Document Store: upload a file, redeploy `document-store`, and check the file still downloads (the volume
  works).
- GitHub → Actions → *Daily jobs* → *Run workflow*: every step succeeds. Same for *Evening jobs*.
- `https://<app address>/manifest.webmanifest` answers. As a test plant's owner on a phone: launcher → **Turn on**
  (iPhone: Add to Home Screen first) → a store keeper saves a count → the phone shows "Stock count saved" and
  the bell shows it.
- super_admin dashboard → open a module read-only (support view). The owner's "Support access" page lists it.
- Complaint Box: a complaint with a photo, redeploy `complaint-box`, and the photo still opens (the volume works).
- Order Capture: an Order desk user saves an order on a phone; the owner gets "New order O-0001" (bell + phone) and
  the tile shows "1 pending".
- Job applications: `https://<jobs address>/health` OK; the bare address says "This page is not available" until the
  default plant switches the module on, then shows its page. `/applications` without a session goes to the PlantOps
  login. A test application from a phone (photo CV) gives J-0001; the owner gets the bell and the tile says "1 new";
  Remove now on it, then *Daily jobs* → Run workflow, and the file is gone (redeploy first to check the volume keeps
  files).
- Attendance: the owner sets the plant location and prints the QR (the tile stops saying "Set location & QR"); a Plant
  staff worker scans it on a phone (https only) and marks IN; a mark from far away is refused and the owner gets
  the bell; the owner fixes a forgotten OUT and the worker gets "Your attendance on … was changed".

## Good to know

- **Ports.** Each service listens on its own port inside Railway (3000/3001/3003/3002/3004/3005/3006, set by `PORT`). From
  outside, everything is normal HTTPS on its own address.
- **Volume permissions.** Railway volumes can only be written by root, so `document-store` and `complaint-box` have
  `RAILWAY_RUN_UID=0`. If files move to S3-compatible storage later (`STORAGE_BUCKET`, see
  `.env.example`), remove the volume and that setting.
- **Backups.** Nightly, encrypted, to a Cloudflare R2 bucket: database and every app's stored files
  (`.github/workflows/backup.yml`). Set up and restore: HANDBOOK.md section 11. Needs the Postgres TCP Proxy on.
- **Email and WhatsApp** stay off until set up. Add `BREVO_API_KEY` + `MAIL_FROM` to `document-store` and `floor-stock` (Railway Hobby blocks
  SMTP; `SMTP_*` only on hosts that allow it) and the
  `WHATSAPP_*` settings to `lab-records` (see `.env.example`). Until then the apps show "not set up yet".
- **Order Capture WhatsApp thank-you (Twilio).** On `order-capture` only: `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`
  and `TWILIO_WHATSAPP_SENDERS` (JSON keyed by the plant's id: `select id, code, name from platform.tenants;`, see
  `.env.example`). Without them, or for a plant not listed, the "Delivered" panel has no tick box.
  Test: deliver an order whose customer phone is your own; the order's History says "WhatsApp thank-you sent".
- **Changing a secret.**
  - Module client secret: super_admin → Modules → new secret, then update `MODULE_SECRET_*` on that
    service and in `.env.railway.<copy>`.
  - Session secrets: change them in Railway. Everyone on that module logs in again.
  - The SSO key: `pnpm sso:keygen`, and keep the old public key in `SSO_PREVIOUS_PUBLIC_JWK_B64` for a
    day.
- **GitHub schedules.** GitHub pauses scheduled workflows in a public repo after 60 days without commits.
  A private repo is not affected.
- **Dedicated-copy features** (`MODE=dedicated`, brand settings, moving one plant's data out of the
  shared copy) are Phase 10. The steps above already work for a Dedicated copy's hosting.
