# PlantOps Owner's Handbook

How to run, change and look after PlantOps: locally for development, and on Railway for real plants.
Written for Rocky (owner and super_admin). Plain steps; the exact click-by-click setup of a hosted copy is in
[DEPLOY.md](DEPLOY.md), and day-to-day app use (users, PINs, modules) is in the [README](../README.md).

**Contents**
1. [The big picture](#1-the-big-picture)
2. [Keeping local and Railway apart](#2-keeping-local-and-railway-apart)
3. [Everyday development and releasing](#3-everyday-development-and-releasing)
4. [A new plant subscribes](#4-a-new-plant-subscribes)
5. [A plant wants its own domain](#5-a-plant-wants-its-own-domain)
6. [A completely separate deployment (Dedicated copy)](#6-a-completely-separate-deployment-dedicated-copy)
7. [Passwords and resets](#7-passwords-and-resets)
8. [Secrets: where they live](#8-secrets-where-they-live)
9. [Domains and DNS](#9-domains-and-dns)
10. [Daily jobs, email and WhatsApp](#10-daily-jobs-email-and-whatsapp)
11. [Files, backups and data location](#11-files-backups-and-data-location)
12. [When something goes wrong](#12-when-something-goes-wrong)
13. [Costs](#13-costs)
14. [Adding a new module later](#14-adding-a-new-module-later)
15. [Decisions made, and why](#15-decisions-made-and-why)
16. [Still to do](#16-still-to-do)

---

## 1. The big picture

```
bluemins.life, www ──► GitHub Pages (the website; untouched by PlantOps)

Railway project "plantops-shared" (Singapore), environment "production"
  app.bluemins.life  ──► platform        login, launcher, super_admin, SSO     (port 3000)
  lab.bluemins.life  ──► lab-records     Lab Records module                    (port 3001)
  docs.bluemins.life ──► document-store  Document Store module (+ volume /data) (port 3003)
  stock.bluemins.life ─► floor-stock     Floor Stock module (port 3002)
  complaints.bluemins.life ─► complaint-box  Complaint Box module (+ volume /data) (port 3004)
  orders.bluemins.life ─► order-capture  Order Capture module (port 3005)
  attendance.bluemins.life ─► attendance-salary  Attendance (QR + location) (port 3006)
                         Postgres        one database, private (each app its own schema + login)

GitHub repo bluemins/plantops_platform
  main        everyday work (pushing it does NOT deploy)
  production  what Railway runs (pushing it DEPLOYS)
  Actions     nightly backup; "Daily jobs" safety net + hand runs

cron-job.org  starts the daily (07:01), evening (17:01-23:01) and morning (08:01-11:01) jobs on time
```

- **One copy, many plants.** Every plant uses the same three addresses. The plant code at login decides which
  plant you're in, and row-level security in the database keeps plants apart.
- **Each plant still looks like its own.** Each plant's screens use its brand colour and logo (set under
  Business details).
- **Ports are internal only.** Inside Railway each app listens on its own port. From outside, everything is
  normal HTTPS on its own subdomain. "Same address, different port" isn't possible on Railway. It also isn't
  safe, because browsers share cookies across ports, which would mix the apps' sessions.

The record of this copy (what runs where, which release) is [deployments/shared.md](deployments/shared.md).

## 2. Keeping local and Railway apart

They share **only the code**, and code reaches Railway in exactly one way: a push to the `production` branch.

| | Local (development) | Railway (production) |
|---|---|---|
| Addresses | `http://localhost:3000` / `:3001` / `:3003` / `:3002` / `:3004` / `:3005` / `:3006` | `https://app` / `lab` / `docs` / `stock` / `complaints` / `orders` / `attendance.bluemins.life` |
| Settings and secrets | `.env` in the project folder | each service → **Variables** |
| Database | Postgres on this computer (`plantops`; tests use `plantops_test`) | Railway's Postgres |
| super_admin | `admin@plantops.local` | `contact@bluemins.life` |
| Plants, users, lab records, documents | test data only | real data |
| Uploaded files | `.data/` in the project folder (`documents/`, `complaints/`) | `document-store-volume`, `complaint-box-volume` |
| Code changes go live | instantly with `pnpm dev` | only after a push to `production` |

**Which database does a command touch?**

| Command | Touches |
|---|---|
| `pnpm dev`, `pnpm test`, `pnpm db:migrate`, `pnpm db:seed`, `pnpm super:set-password` | **local** |
| `./scripts/railway-migrate.sh shared` | **Railway** |
| `PLANTOPS_ENV_FILE=$PWD/.env.railway.shared pnpm <command>` | **Railway** |

> **Rule of thumb:** if a command doesn't mention `railway` or `.env.railway.shared`, it is local. Commands
> that touch Railway read `.env.railway.shared` *instead of* `.env`, so no local value (like a `localhost`
> address) can leak into production.

**Never:**
- copy `.env` values into Railway, or Railway values into `.env`
- point `pnpm dev` at the Railway database
- commit any `.env*` file (git already ignores them)

## 3. Everyday development and releasing

### Working on something
1. Start the apps locally with `pnpm dev`, try your change at `localhost:3000`, and run `pnpm test`.
2. Commit, then push to `main` (`git push`). This is only a backup on GitHub; **nothing goes live.**

### Releasing to plants
Do this when `main` is tested and ready:
1. **CHANGELOG.md:** write what changed in plain words, and **list any new migrations**. A new migration is a
   new file in `apps/*/db/migrations/`.
2. **Tag it:** `git tag v0.5.0 && git push origin main --tags` (use the next version number).
3. **Migrations first,** if the release has any: `./scripts/railway-migrate.sh shared`.
   - Doing this before the code goes live is safe. Migrations are always backward-compatible, so the old
     code keeps working on the updated database.
   - **If you skip this, the new code may break** when it can't find a new table or column.
4. **Go live:** `git push origin v0.5.0:production`. Railway rebuilds and switches over when the health
   check passes. A broken build never replaces the running version.
5. **Check:** open the three `/health` addresses (section 12), log in, and click through what changed.
6. **Record it:** set "Runs release" in [deployments/shared.md](deployments/shared.md) and commit.

### Going back to the previous release
- In git: `git push --force origin v0.4.0:production`.
- Or in Railway: service → **Deployments** → previous one → **Redeploy**.

Migrations stay in place either way. That's fine, because the older code works with them.

### What is live right now?
- Railway → service → **Deployments** shows the commit each deployment was built from.
- `git log origin/production -1` shows the same thing from the terminal.

## 4. A new plant subscribes

**No deployment, no Railway work, no DNS.** The plant is added as new rows in the same database.
1. Go to `https://app.bluemins.life/super` → **New plant**.
2. Fill in the plant code, name, plan (modules + limits) and the first owner. Business details (logo,
   colour) are optional.
3. Give the owner their **plant code + username + temporary password**. They choose their own password at
   first login.
4. The owner adds their own staff and roles (Manage users).

Plans and limits can be changed later on the plant's page. Billing happens outside the app (manual invoices)
in v1.

### The demo plant (999): try things here, never at a real plant
Most tables are append-only, so a trial at a real plant ("Test", "ccxc" …) stays in its history forever. Every trial,
demo for a buyer, and phone check after a release is done in **plant `999`, "Sample RO Plant"** on the live copy
(STABILITY_PLAN B-06). It is just rows in the shared database: no extra Railway service, no cost.
- Every module is switched on, including Lab Records; max users 15. It has a bright green brand colour (`#00ff00`) so
  it never looks like a real plant, and fake products and users. A user is a separate login per plant, so you log in
  with plant code `999`.
- Users: the owner `sowner` (you) plus one person per role, each named after the role (`sstore`, `sorder` …). Use no
  real staff names, and use only your own mobile number.
- The timed jobs treat it like any plant, so its alerts reach the demo users only. A phone can get alerts for 001 and
  999 at the same time.
- **Job applications:** `jobs.bluemins.life/999` is public. Keep the demo openings switched off except while trying
  them, and give them titles starting with "DEMO –".
- Order Capture's WhatsApp thank-you works only for plants listed in `TWILIO_WHATSAPP_SENDERS`. Plant 999 is not
  listed, so it has no tick box.
- Claude's usage and live-data checks leave plant 999 out.

## 5. A plant wants its own domain

There are three levels. Offer them in this order:

| Option | What the plant gets | Work and cost |
|---|---|---|
| **A. Shared, own look** (default) | Same addresses (`app.bluemins.life`), but their logo and brand colour on every screen | none: Business details |
| **B. Dedicated copy on a subdomain of ours** | Their own full copy at e.g. `acme.bluemins.life`, `acme-lab.bluemins.life`, `acme-docs.bluemins.life` | a new Railway project (section 6), ~$5–15/month more |
| **C. Dedicated copy on their own domain** | Their own copy at e.g. `plantops.acmewater.in` | same as B. **Their** IT adds the CNAME/TXT records at **their** registrar |

**What doesn't exist yet:** a custom domain for one plant *inside the shared copy* (e.g.
`acme.bluemins.life` opening the shared app already set to Acme). The shared copy has one platform address,
and logins and module links are tied to it. Building this would be a code change: the platform and every
module would need to work out the plant from the address. It's worth planning only if several plants ask.
Until then, a plant that insists on its own address gets a Dedicated copy (B or C).

**Before offering Dedicated:** most worries about Shared are answered by three facts:
- other plants can't see their data (row-level security)
- they can export their data if they leave
- where the data is stored: Singapore (Railway) for now, India later if needed

Offer Dedicated only if that isn't enough. It's a paid upgrade.

## 6. A completely separate deployment (Dedicated copy)

A Dedicated copy is **the same code and release** in its own Railway project, with its own database, its own
three apps and its own secrets. Only settings differ. Never fork the code for one plant.

**Setting one up.** Follow [DEPLOY.md](DEPLOY.md) "Setting up a new copy" with a copy name, e.g. `acme`. In
short:
1. In Railway, create a new project (e.g. `plantops-acme`). Add Postgres, set the region to Singapore, and
   switch on the TCP Proxy (Settings → Networking).
2. Run `./scripts/setup-railway-db.sh acme`. It asks for that project's `DATABASE_PUBLIC_URL`, its three
   addresses and its super_admin email, then writes `.env.railway.acme` and `.env.railway.acme.paste`.
3. Add 3 services from the **same repo** and **branch `production`**:
   - Root Directory empty, Region Singapore, health check paths from DEPLOY.md
   - paste each block from the `.paste` file
   - attach a volume at `/data` to document-store
4. Add the custom domains in Railway, then the CNAME + TXT records at the DNS provider (section 9).
5. Create a GitHub environment `acme` with `LAB_URL`, `DOCS_URL` and `CRON_SECRET`. Add `acme` to
   `copy: [shared, acme]` in `.github/workflows/daily.yml`.
6. Log in as that copy's super_admin, change the password, and create **the one plant** it holds.
7. Write `docs/deployments/acme.md` (copy `shared.md` as the template) and commit.

**Releasing with several copies.** Every copy deploys from `production`, so one push updates all of them.
That's why migrations come first:
- **For each copy:** run `./scripts/railway-migrate.sh <copy>`.
- **Then once:** `git push origin v0.5.0:production`.
- **Afterwards:** check each copy and update each record.

**Not built yet** (Phase 10 in CLAUDE.md):
- `MODE=dedicated` and brand settings for the whole copy (e.g. login screen in the plant's brand instead of
  PlantOps blue)
- the tool that moves an existing plant's data from Shared into its Dedicated copy

A *new* plant can start on Dedicated today. *Moving* an existing plant needs that tool.

**If Dedicated copies become frequent:**
- Railway can save a project as a private *template*, for one-click copies.
- Railway's "Infrastructure as Code" (`.railway/railway.ts`) can describe services in a file.

Neither is worth it for one or two copies.

## 7. Passwords and resets

### super_admin (you)
| Situation | What to do |
|---|---|
| Change it (you know the current one) | `https://app.bluemins.life/super/change-password` |
| **Forgotten**, on Railway | In the project folder: `PLANTOPS_ENV_FILE=$PWD/.env.railway.shared pnpm super:set-password` → type the new password (nothing shows). It defaults to `SUPER_ADMIN_EMAIL` from that file. For another email: `... pnpm super:set-password -- other@email`. All super_admin sessions are logged out. |
| Forgotten, on a Dedicated copy | Same command with `.env.railway.<copy>` |
| Forgotten, local | `pnpm super:set-password` (local database) |

After any change, update the password manager. Don't keep a live password in `.env.railway.*`: the setup
only needed `SUPER_ADMIN_PASSWORD` to create the account the first time.

The terminal reset needs the Railway database reachable from your computer: Postgres → Settings →
Networking → **TCP Proxy** on.

### Plant users
| Who forgot | Who resets it | Where |
|---|---|---|
| Staff PIN | their owner (or you) | Manage users → **Reset PIN** |
| Owner password | you | `/super` → plant → Users → **Reset password** |
| Locked out (5 wrong tries) | owner, for staff | Manage users → **Unlock** (or wait 15 min) |

A reset is always temporary: the person picks their own at the next login. More details are in the README,
"Resetting passwords and PINs".

## 8. Secrets: where they live

| Secret | Railway (live) | Your computer | Password manager |
|---|---|---|---|
| Database passwords (5 logins) | in the services' `DATABASE_URL_*` | `.env.railway.shared` (owner login) | ✔ |
| SSO signing key `SSO_PRIVATE_JWK_B64` | platform | (pasted, then file deleted) | ✔ |
| Module secrets `MODULE_SECRET_*` | lab-records, document-store | `.env.railway.shared` | ✔ |
| Session secrets `LAB_/DOC_SESSION_SECRET` | lab-records, document-store | (pasted, then file deleted) | ✔ |
| `CRON_SECRET` | platform, lab-records, document-store, floor-stock, complaint-box, order-capture, attendance-salary, job-applications, GitHub environment `shared` **and** the 11 cron-job.org jobs (header `x-cron-secret`) | (pasted, then file deleted) | ✔ |
| `ATTEND_SESSION_SECRET` | attendance-salary. **Also makes the QR key:** changing it stops every printed Attendance QR (print new ones) | (pasted, then file deleted) | ✔ |
| super_admin password | (stored as a hash in the database) | not stored | ✔ |
| Phone notification keys `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` | platform | not stored (local dev has its own pair in `.env`) | ✔ |
| Backup login `DATABASE_URL_BACKUP` (read-only) | GitHub environment `shared` only | `.env.railway.shared` | ✔ |
| R2 keys `BACKUP_ACCESS_KEY_ID` / `BACKUP_SECRET_ACCESS_KEY` | document-store, complaint-box, attendance-salary, job-applications **and** GitHub environment `shared` | `.env.railway.shared` | ✔ |
| **Private backup key** (`AGE-SECRET-KEY-...`) | **never** | **never** (typed in when restoring) | ✔ **two copies** |

- **`.env.railway.shared`**: keep it. It's needed for migrations and password recovery. Git ignores it.
- **`.env.railway.shared.paste`**: delete it once everything is pasted. The values live in Railway and the
  password manager.
- **Lost `.env.railway.shared`?** Restore it from the password manager. The one value that really matters
  is `DATABASE_URL_OWNER`.

**Changing a secret** (e.g. after a laptop is lost, or someone leaves):

| Secret | How |
|---|---|
| Module secret | super_admin → **Modules** → new secret (the old one stops at once). Paste it into that service's `MODULE_SECRET_*` and into `.env.railway.shared`. |
| Session secret | Change it in Railway. Everyone using that module logs in again. |
| `CRON_SECRET` | `openssl rand -hex 32`; change it on every service that has it (table above), in the GitHub environment **and** in the header of all 11 cron-job.org jobs. Do it between 23:05 and 06:55 IST (no timed job then except the 02:00 backup). |
| SSO key | Run `pnpm sso:keygen`. Put the new key in platform's `SSO_PRIVATE_JWK_B64`, and the old *public* key in `SSO_PREVIOUS_PUBLIC_JWK_B64` for a day. |
| Backup login password | Run `./scripts/setup-backup-login.sh shared` again, then update GitHub's `DATABASE_URL_BACKUP`. |
| R2 keys | Cloudflare → R2 → Manage API tokens: make a new token (*Object Read & Write*, bucket `plantops-backup` only), put it in the four file-storing services (table above), GitHub and `.env.railway.shared`, run **Nightly backup** by hand, then delete the old token. |
| Private backup key | Lost or leaked: `pnpm backup:keygen`, put the new public key in GitHub and document-store (`BACKUP_RECIPIENT`). Old backups still need the **old** private key, so keep it until they are gone (30 days for dumps; files stay, so keep it). |
| Phone notification keys | `pnpm --filter @plantops/platform push:keys`, put all three lines in platform's Variables. Every phone stops getting notifications until its owner taps **Turn on** again, so change them only if the private key leaked. |
| Database password | Run `ALTER ROLE ... PASSWORD` as the `postgres` user, then update the matching `DATABASE_URL_*` (and `.env.railway.shared` for the owner). |

## 9. Domains and DNS

- **bluemins.life is registered at WordPress.com**, which also runs its DNS (WordPress.com name servers). The
  DNS records are under Domains → bluemins.life → **DNS records**.
- **Leave these alone:**
  - the GitHub Pages records for `bluemins.life` and `www` (the website)
  - Name servers
  - Domain forwarding
  - WordPress.com's "SSL Pending" note: it doesn't affect GitHub Pages or Railway
- **The PlantOps records:**

| Type | Name | Points to |
|---|---|---|
| CNAME | `app` | platform's Railway target (`…up.railway.app`) |
| CNAME | `lab` | lab-records' Railway target |
| CNAME | `docs` | document-store's Railway target |
| TXT | `_railway-verify.app` / `.lab` / `.docs` | the `railway-verify=…` values Railway gave |

- **Adding an address** (new module, Dedicated copy): add the domain in Railway (service → Settings →
  Networking → Custom Domain) → add the CNAME + TXT records Railway shows → wait. The HTTPS certificate
  appeared about 15 minutes after DNS went live this time.
- **Check DNS from anywhere:** `https://dns.google/resolve?name=app.bluemins.life&type=CNAME`.

**Sleeping services (Railway Serverless, since 2026-10-18; STABILITY_PLAN section 9).** To cut the Railway bill, little-used
modules sleep after 10 minutes without visitors and wake on the next visit (a short wait on the first open; a launcher
tile may show "Numbers unavailable" once). Switched on: `job-applications`. Candidates: `lab-records`, then
`document-store`, `complaint-box`. Always on: `platform`, `order-capture`, `attendance-salary`, `floor-stock`, Postgres.
Service → Settings → **Serverless** → Enable → Apply / Deploy (one restart). Railway's own cron schedules don't work on
sleeping services; PlantOps doesn't use them (cron-job.org calls the app and wakes it). Undo: switch it off.

## 10. Daily jobs, email and WhatsApp

**Who starts the jobs: cron-job.org** (free; since 2026-10-18, STABILITY_PLAN B-01). GitHub's own scheduler
started the daily jobs 4-7 hours late, ran the hourly evening jobs about twice a day (often after midnight, when they
do nothing) and never ran the morning ones. cron-job.org calls each address at the exact minute. Every job sends
each reminder once (dedupe), so an extra or repeated call never sends twice.

Set-up (once per copy): cron-job.org → sign up → **Settings** → time zone **Asia/Kolkata**. Then **Create cronjob**
for each row below:
- *Common*: title as in the table, URL, Execution schedule → *Custom* with the hours and minute shown, time zone
  Asia/Kolkata (if the job form asks), **Notify me** when execution fails (and after it is disabled because of
  failures).
- *Advanced*: request method **POST**; **Headers** → key `x-cron-secret`, value = `CRON_SECRET` (from
  `.env.railway.<copy>` / the password manager; it is the same on every service); timeout 30 s (each job takes
  0-2 s); "Treat redirects as success" off.

| # | Title | URL (shared copy) | Days | Hours (India time) | Minute |
|---|---|---|---|---|---|
| 1 | Platform daily | `https://app.bluemins.life/api/cron/daily` | every day | 7 | 1 |
| 2 | Lab Records daily | `https://lab.bluemins.life/api/cron/daily` | every day | 7 | 1 |
| 3 | Document Store daily | `https://docs.bluemins.life/api/cron/daily` | every day | 7 | 1 |
| 4 | Floor Stock daily | `https://stock.bluemins.life/api/cron/daily` | every day | 7 | 1 |
| 5 | Complaint Box daily | `https://complaints.bluemins.life/api/cron/daily` | every day | 7 | 1 |
| 6 | Order Capture daily | `https://orders.bluemins.life/api/cron/daily` | every day | 7 | 1 |
| 7 | Attendance daily | `https://attendance.bluemins.life/api/cron/daily` | every day | 7 | 1 |
| 8 | Job applications daily | `https://jobs.bluemins.life/api/cron/daily` | every day | 7 | 1 |
| 9 | Lab Records evening | `https://lab.bluemins.life/api/cron/evening` | every day | 17, 18, 19, 20, 21, 22, 23 | 1 |
| 10 | Floor Stock evening | `https://stock.bluemins.life/api/cron/evening` | every day | 17, 18, 19, 20, 21, 22, 23 | 1 |
| 11 | Attendance morning | `https://attendance.bluemins.life/api/cron/morning` | every day | 8, 9, 10, 11 | 1 |

Minute 1, not 0, so a call can never land a second before the hour (the jobs check "has the plant's hour come" in
India time). After saving, open each job → **Test run**: the answer must be **200** with a JSON summary. **401** = wrong
secret; **503** = `CRON_SECRET` missing on that Railway service. **Execution history** on each job shows the exact
start time and answer of every run.

`CRON_SECRET` only starts jobs that are safe to repeat; it opens no data. Still, if it is ever changed, change it
on every Railway service, in GitHub (environment secret) **and** in all 11 cron-job.org jobs the same day.

A **new module with a daily job** adds a row here and a job on cron-job.org (and its step in `daily.yml`).

**GitHub still has the jobs, for hand runs and as a safety net:**
- **Daily jobs** (`.github/workflows/daily.yml`) keeps a schedule (due 07:00, GitHub starts it around noon). If
  cron-job.org missed a day, this catches up; otherwise it adds nothing. *Run workflow* runs it by hand.
- **Evening jobs** (`.github/workflows/evening.yml`) has no schedule any more: *Run workflow* only (runs the evening
  steps and the Attendance morning step).
- **Nightly backup** (`backup.yml`) stays on GitHub's schedule (02:00 India time); lateness there doesn't matter.

**What the daily jobs do** (07:01 India time), for each copy:
- Platform: plan renewal reminders to owners (30 / 7 / 1 days before and on the renewal date); skipped until
  `APP_URL` is set (and needs `CRON_SECRET` on the **platform** service too)
- Lab Records: reminders about holds older than 24 h, and Form 1 due from the 25th
- Document Store: expiry app notifications (30 / 7 / 1 days before, on expiry, then weekly), to the owners and the
  responsible person; each reminder is listed on the document's page
- Floor Stock: notifications that waited in its outbox (low-stock alerts go out right after the count is saved)
- Complaint Box: "C-0042 open for N days" reminders (day 3, 10, 17… after logging / reopening) and notifications
  that waited in its outbox; skipped until `COMPLAINT_URL` is set
- Order Capture: notifications that waited in its outbox (no reminders in v1); skipped until `ORDER_URL` is set
- Attendance: notifications that waited in its outbox, then "N people didn't mark OUT yesterday" to each plant's
  owners; skipped until `ATTENDANCE_URL` is set

- Job applications: notifications that waited in its outbox, then the 12-month removal of applications and their
  files (incl. backup copies); skipped until `JOBS_URL` is set

To check: cron-job.org → each job's **Execution history** (on time, answer 200). To run by hand: cron-job.org →
**Test run**, or GitHub → **Actions** → *Daily jobs* → **Run workflow**. A failed GitHub run sends GitHub's failure
email; a failed cron-job.org call sends cron-job.org's.
If runs appear on every push, named `.github/workflows/daily.yml` instead of *Daily jobs*, GitHub can't read the
file (a YAML mistake) and nothing runs. Until 2026-10-04 that was the case: a `run:` line containing `: ` must be
written as `run: |` with the command on the next line.

Its settings live in GitHub → Settings → **Environments** → `shared`: variables `APP_URL`, `LAB_URL`, `DOCS_URL`, `STOCK_URL`, `COMPLAINT_URL`, `ORDER_URL` and `ATTENDANCE_URL`,
and the secret `CRON_SECRET`. If the repo is ever made public, GitHub pauses schedules after 60 days without
commits.

**No email (owner, 2026-10-17; STABILITY_PLAN B-02).** PlantOps sends no email: every alert, including Document
Store expiry reminders and Floor Stock low stock, is an app notification (bell + phone push, below). Brevo was
dropped: it refused Railway's changing addresses ("unrecognised IP address") and never delivered a reminder.
- Leave `BREVO_API_KEY`, `MAIL_FROM` and `SMTP_*` unset on every service. Without them each reminder / low-stock
  row is recorded as "App notification only (email is off)", shown as **sent in the app (bell + phone)** on the
  document's page; nothing waits to be emailed.
- **Expiry reminders only help if people see them:** the owner and every document's responsible person must turn
  on phone notifications (`/notifications` → **Send a test to this phone**).
- The mail code stays in `packages/module-kit/src/mail.ts`. Setting the variables again would turn email back on
  for new rows (rows recorded as app-only are never emailed afterwards).

**Evening and morning jobs.** cron-job.org calls the evening jobs **every hour from 17:01 to 23:01 India time** and
Attendance's morning job **every hour from 08:01 to 11:01** (rows 9-11 above):
- Attendance sends "N people not marked by 10:00" to each plant's owners and supervisors at the hour chosen in
  **Attendance → Settings** (08:00-11:00, or Off; default 10:00). Once a day.
- Floor Stock sends "Today's stock count is not done yet" to each plant without a count, at the hour its owner
  chose on **Sections & items → Evening reminder** (5 pm–11 pm, or Off; default 8 pm). Once a day. A count entered
  **before 5 am** opens on the night before (B-05, v0.25.3); the new calendar day is a switch on the screen.
- Lab Records sends "No lab tests entered today" from 20:00. Once a day.
- Every run (and every morning run) also resends notifications that waited in a module's outbox because PlantOps
  was briefly unreachable.

GitHub → *Evening jobs* → *Run workflow* runs all three by hand; extra runs never send twice.

**App notifications (free; no email, SMS or WhatsApp).** Owners see a bell 🔔 on the launcher, and get phone
notifications once they tap **Turn on** there. Design and phases: `docs/notifications.md`.
- Needs the three `VAPID_*` variables on **platform** (section 8). Without them the bell still works.
- **Android:** Chrome → app.bluemins.life → log in → **Turn on** (optionally Install for a home-screen icon).
- **iPhone (iOS 16.4+):** Safari → app.bluemins.life → Share → **Add to Home Screen** → open PlantOps from the
  new icon → log in → **Turn on**. In Safari itself the card explains this.
- **"Blocked on this phone"**: the person once refused. Only the phone's settings can undo it (iPhone: Settings
  → Notifications → PlantOps; Android: Chrome → site settings → app.bluemins.life → Notifications).
- **Logging out** turns notifications off for that phone, so a shared phone doesn't get the owner's alerts.
- **Each person chooses** on their notifications page (`app.bluemins.life/notifications` → Notification settings):
  Phone + bell, Bell only or Off per kind. Urgent ones (ON HOLD, Form 3/4 FAIL, document expiry, someone locked
  out) are always on. Notifications older than 90 days are removed automatically by the morning job.
- **Other people (e.g. a manager)** get a module's alerts only when the owner ticks them: Manage users → Edit →
  **Gets alerts (bell and phone) for** → tick the module → Save. Only modules the person works in are offered;
  untick any time (audited). Owners always get every alert. A ticked person opens their list and turns on phone
  alerts from the 🔔 in any module's header (or `app.bluemins.life/notifications`).
- **Document Store** notifies (owners + ticked): expiry at 30 / 7 / 1 days before, on expiry, then weekly (also
  to the responsible person; once per stage, like the email), "you are now responsible for …" (only that person),
  new / renewed documents (bell only), storage 80% / 95% full.
- **PlantOps itself** notifies the **owners only**: someone locked out after 5 wrong PINs (with Manage users to
  unlock), PlantOps support viewed a module (bell), a module switched on (phone) or off / plan changed (bell),
  plan renewal coming up (daily job).
- **Lab Records** also notifies (owners + ticked): ON HOLD, Form 3/4 FAIL, ready for approval, approved /
  rejected (also to the technicians who tested that batch), result corrected (bell only), the morning reminder
  and "No lab tests entered today" at 20:00 (Evening jobs). WhatsApp alerts are unchanged.
- **If a plant asks where the alerts go:** through Google's (Android) or Apple's (iPhone) push service,
  encrypted end to end; they can't read or keep the content. The data itself stays in Singapore.
- Floor Stock sends: count saved / corrected / low stock / check the count (one per save), count not done
  (8 pm), and setup changed by staff (bell only, no phone buzz).

**WhatsApp (Lab Records alerts): waiting for Meta approval.** Alerts are kept as "WhatsApp not set up yet".
When approved, add `WHATSAPP_TOKEN`, `WHATSAPP_PHONE_ID`, `WHATSAPP_TEMPLATE` and `WHATSAPP_TEMPLATE_LANG` to
**lab-records** → Variables.

### Attendance: QR and location
- **Setting up a plant (the owner, once):** Attendance → ⚙ Location & QR. Stand **outside in the open** at the plant
  and tap "Use my current location" (it waits up to 20 s for GPS and warns if the reading is rougher than ±50 m), or
  paste `lat, lng` from Google Maps; circle 200–300 m (plant 001: 300 m), Save. Then **Make the QR →
  Print QR** and stick it where staff come in. Copies in several places all work.
- **Reprinting** gives the same QR. **Make a new QR** stops every old print at once (use it if a photo of the QR has
  gone outside the plant); the new one must be put up again.
- **The QR key is never stored:** the app works it out from `ATTEND_SESSION_SECRET`, the plant and the QR's date.
  Changing that secret therefore stops every printed QR too: print new ones for every plant using Attendance.
- **Who is tracked:** everyone with the **Plant staff** role. An owner marks only if they also hold Plant staff.
- **Location needs https.** Phones share their location only with the secure address, so marking can't be tried on
  the LAN address (`http://192.168.1.2`); use the live copy.
- **Precise location (v0.25.3, B-04):** the phone waits up to 20 s for a good GPS reading; rougher than **±150 m** is
  not saved, and the screen shows the fix: Android Settings → Location → Location services → **Google Location
  Accuracy ON**; iPhone Settings → Privacy & Security → Location Services → Safari Websites → **Precise Location ON**.
  Changing the circle or this rule never changes the printed QR.
- **Honest limits:** indoor GPS can be 20–50 m off, so the circle is 200–300 m: it stops marking from home or the
  market, not from the road outside the gate. A fake-GPS app on Android can fool any browser check; the owner's
  Today board and the "tried to mark from far away" bell are the safety net.
- **Mistakes:** only the owner fixes (Staff → person → day → add a time / cancel a mark, always with a reason).
  Nothing is overwritten; the worker gets a notification.

### Attendance: salary at month end
Salary lives in the Attendance module (v0.20.0). Only the owner sees money; workers see days and hours.
- **Set a salary (once per person):** Attendance → Staff → the person → **Salary** box under the calendar: monthly
  salary, shift hours (8 = full day ≥ 8 h, half day ≥ 4 h), paid leave per month (2), **Gets overtime** + rate if they
  are paid overtime, **from month** (this month). Joined on / Last day only for someone who joined or left during a
  month. A change "from November" never alters October; a change for a past month asks for a reason.
- **Per-day people** (v0.21.0): in the Salary box choose **Pay → Per day** and type the **day rate**. A present day
  pays the rate, a half day half of it, an absent day nothing; there is no paid leave. Overtime and advances work the
  same. Switching between Monthly and Per day is "from a month" like any change. The Salary tab marks them "per day".
- **Advances:** same page, **+ Advance** (amount, date, note). A wrong entry is never deleted: tap **Correct** on it
  and take the extra off with a reason.
- **During the month:** the **Salary** tab shows everyone "so far". Tap a name for the **checking panel**: type your
  own figures (e.g. from the notebook) and it says "Yours is ₹120 more than auto" or "Matches". Nothing there is saved.
- **On the last day of the month, 07:00:** the bell says "October salary review today" with what is left to fix.
  **Fix no-exit days first** (Staff → person → day → add the OUT), and set a salary for anyone listed under "No
  salary set". Then read **Remaining to pay** per person. A minus (advances above the pay) carries to the next month.
- **Mark paid** (from the last day): the dialog shows what is being paid and freezes the month. If attendance is fixed
  afterwards, the row says "Changed after payment: ₹X → November" and November gets that amount once as an
  adjustment. **Undo** (with a reason) only if it was marked by mistake.
- **Can see own salary** (person page, off by default): with the tick, the worker sees their own slip for paid months
  and gets "Your salary is paid"; without it, they see attendance only. Turning it off hides the slips at once.
- **CSV:** Salary tab → Download CSV (one row per person, rupees with 2 decimals for a spreadsheet).
- **Not done by the app:** weekly offs, holidays, leave requests, PF / ESI / TDS, printed payslips.

### Attendance: field duty and expenses (v0.22.0)
Workers send **claims** from the phone; the owner approves them; only approved ones are paid with that month's salary.
- **Only Field staff send claims (v0.22.1):** Staff → the person → Salary box → tick **Field staff: can send field duty
  and expense claims** for the people who do field work (at plant 001: Dillip and Kedar), saved from a month like the
  rest. Everyone else has no My claims tab. You can still enter an expense for anyone (below); they then see it on
  their My claims, read-only.
- **Set the rates (once per person):** with Field staff ticked, **TA ₹ per km** and **DA ₹ per day** (both optional;
  blank = no TA / DA, expenses only). Works for Monthly and Per day people.
- **Workers (Field staff):** My claims → **+ Field duty** (date, km, where; only shown when that month has a TA or DA rate; one per
  day) or **+ Expense** (date, amount, what for, up to 3 bill photos). Up to 31 days back. They can **Withdraw** while
  it waits. Field duty never marks anyone present: they still scan the QR.
- **Owner:** the bell says "Expense from Anmol: ₹450". Open **Claims** (the tab shows how many wait): **Approve** or
  **Not approve** (write why: the worker sees it). An approved claim can be **Cancelled** later with a reason. The card
  shows TA / DA at that person's rates ("TA ₹126 (42 km × ₹3) · DA ₹150").
- **Entering for someone:** Staff → the person → **Claims** → + Field duty / + Expense: approved at once, any date from
  their first salary month.
- **Month end:** the Salary tab shows TA, DA and Expenses per person and "N claims waiting · Review". Decide them before
  **Mark paid** (the dialog warns); one approved later comes as an adjustment next month. The worker's slip (with "Can
  see own salary") lists field duty, TA, DA and each expense.
- **Photos** are kept on the server (`attendance-salary-volume`) and copied, encrypted, to the nightly backup.

### Attendance: office desk and supervisor (v0.23.0)
Two more roles for Attendance & Salary, given on PlantOps → Manage users like any role (the buttons show when
Attendance is switched on). Tick **Plant staff** as well if the person is on the payroll: without it they are not on
the Today board, the Staff list or the Salary tab, and don't mark their own attendance.
- **Office staff** (e.g. the office clerk):
  - **Mark for someone:** Attendance → Mark for someone → tap Mark IN / Mark OUT beside the name. The office phone's
    location is checked like a scan (it must be inside the plant circle); the time is the server's. The day shows
    "by Ramesh (office)". Never for themselves: they scan the QR like everyone.
  - **Fix** a wrong or missing time on anyone's day (with a reason), never their own. You get a bell: "Ramesh changed
    Bindu's attendance".
  - **Advances:** Staff → the person → + Advance: today or up to 7 days back, at most ₹1 lakh, never to themselves,
    only for someone whose salary you have set. Your phone buzzes: "Advance ₹2,000 to Bindu · Given by Ramesh". They
    can correct their own entry the same day; anything older, you correct it.
  - They see attendance and advances ("still to recover from earlier months"), **never a salary, slip or claim**.
- **Supervisor** (e.g. the shift in-charge): the **Today board**, read-only; a **bell for every IN / OUT** (theirs and
  the office's marks; never sent to owners); and the morning **"N people not marked by 10:00"** alert.
- **The not-marked alert:** Attendance → Settings → Not-marked alert: 08:00, 09:00, 10:00 (default), 11:00 or Off. One
  phone alert to the owners and supervisors listing who has no mark yet today. Weekly offs and leave aren't built
  yet, so a day off shows there too. It needs the "Attendance morning" job on cron-job.org (section 10, hourly
  08:01-11:01 India time).
- **Permanent / Temporary:** in each person's Salary box (from a month). The Salary tab shows "TEMP" beside temporary
  people and a **Manpower cost** card split Permanent / Temporary; the CSV has a "Staff type" column. Pay is worked out
  the same way for both.
- Launcher tiles: Office staff see "Attendance desk", supervisors "Today board", both with attendance numbers, never
  money.

### Job applications: public page, Turnstile, QR poster, removal (v0.25.0)
- **Switching it on for a plant:** super_admin → the plant → plan → tick Job applications (optionally set "Job
  applications storage (MB)"). Give the person who calls applicants the **HR desk** role on Manage users; tick "Gets
  Job applications alerts" if they should get the bell. Plant staff never see it.
- **The public page:** `jobs.bluemins.life` shows the plant in `JOBS_DEFAULT_PLANT` (001 on the shared copy); any
  other plant is at `jobs.bluemins.life/<plant code>`. A plant that is unknown, suspended or hasn't switched the module
  on gets "This page is not available" (the same answer for every reason, so nobody can find plant codes this way).
  Don't give a plant the code `APPLY`: `/apply` is the default plant's form.
- **Openings (owner):** Job applications → Openings: + Add (position, group, short tag, description, minimum
  qualification, good to have), the on / off switch, ↑ ↓ within a group, the message at the top of the page. Switched-off
  positions vanish from the public page at once; nothing is deleted, and applications keep the name they applied for.
  People can always "just send their resume" (Any job), even with no position on.
- **The QR poster:** Openings → Print QR poster (A4, "We are hiring" + the QR of the public address). The address is
  taken from `MODULE_URL_JOB_APPLICATIONS`, so it is the real `https://jobs…` one.
- **Spam rules:** a hidden trap field; **20 sends per internet connection per hour** (a hiring drive on one mobile
  network still works); one application per phone per position per 30 days; files checked by their contents (PDF,
  JPEG, PNG, WebP only); a full storage plan closes the form and tells the owners.
- **Turning Turnstile on** (Cloudflare's free "are you human?" check): Cloudflare → Turnstile → Add widget, name
  "PlantOps jobs", hostname `jobs.bluemins.life`, mode Managed. Put the **Site key** in `TURNSTILE_SITE_KEY` and the
  **Secret key** in `TURNSTILE_SECRET` on the `job-applications` service (both, or neither). Never in a file. When
  Cloudflare can't be reached, a send is refused with "try again in a minute".
- **Kept 12 months:** applicants agree to that on the form. The daily job removes applications sent more than 12 months
  ago (with notes and resume files), and deletes the files from storage **and the backup bucket**. The owner's
  **Remove now** (on an application, with a reason, e.g. "the applicant asked") does the same at once; only the line
  "J-0042 removed: <reason>" stays in Recent changes. Nightly database dumps are kept 30 days, so a removed applicant is
  gone everywhere within 30 days.
- **The hourly limit counts the sender's address** as Railway's proxy passes it on. If many different people are
  refused at once ("Too many applications from this connection"), tell me: the proxy may be giving one shared address.

## 11. Files, backups and data location

- **Uploaded documents** are on `document-store-volume`, mounted at `/data`. `DOC_STORAGE_DIR=/data/documents`,
  and `RAILWAY_RUN_UID=0` lets the app write there.
- **Bill photos of expense claims** (v0.22.0) are on Attendance's **own** `attendance-salary-volume` at `/data`
  (`ATTEND_STORAGE_DIR=/data/attendance`, `RAILWAY_RUN_UID=0`); the backup step needs the GitHub variable
  `ATTENDANCE_BACKUP_FILES=on`.
- **Resumes** (v0.25.0) are on Job applications' **own** `job-applications-volume` at `/data`
  (`JOBS_STORAGE_DIR=/data/jobs`, `RAILWAY_RUN_UID=0`); the backup step needs the GitHub variable
  `JOBS_BACKUP_FILES=on`. **This is the only module whose files are ever deleted** (12-month removal, Remove now): the
  daily job deletes them from the volume and their copy from the backup bucket.
- **Complaint photos / videos** are on Complaint Box's **own** `complaint-box-volume` at `/data`
  (`COMPLAINT_STORAGE_DIR=/data/complaints`, `RAILWAY_RUN_UID=0`). Never Document Store's volume or bucket.
- **Backups: every night, encrypted, outside Railway** (Railway's own Backups tab needs the Pro plan). The
  **Backup** workflow (`.github/workflows/backup.yml`, 02:00 India time) puts everything into one private
  Cloudflare R2 bucket:
  - **Database:** a `pg_dump` of all schemas made with the read-only login `plantops_backup`
    (`db/<copy>/plantops-<copy>-<date>.dump.age`), kept **30 days**.
  - **Files:** each app that stores files (Document Store, Complaint Box) copies its **new** files there
    (`files/<module>/tenant/<plant>/<file>.age`). Files are never changed or deleted in PlantOps, so the copies
    are kept as long as the app keeps them: forever. **Except Job applications:** its resumes are removed after 12
    months or by the owner's Remove now, and the daily job deletes their backup copy too (the R2 token's *Object Read
    & Write* allows that).
  - Everything is encrypted with `age`. GitHub and Railway hold only the **public** key, which can lock but not
    open. The **private** key ("PlantOps backup key") is only in your password manager. **Lose it and the
    backups can't be opened by anyone.** Keep two copies.
  - A failed night fails the workflow and GitHub emails you. The Postgres TCP Proxy must stay **on**.
  - Not covered: Railway settings / variables (they are in the password manager) and the code (it is in GitHub).

  **Setting it up (once per copy):**
  1. Cloudflare → R2 → create bucket `plantops-backup` (location hint: Asia-Pacific). Leave it **private**.
  2. R2 → Manage API tokens → **Create API token**: permission *Object Read & Write*, *only* this bucket.
     Note the Access Key ID, Secret Access Key and the S3 endpoint `https://<account id>.r2.cloudflarestorage.com`.
  3. `pnpm backup:keygen` → save the **private** key in the password manager (two places); keep the public
     key (`age1...`) for the next steps.
  4. `./scripts/setup-backup-login.sh shared` (asks for Railway → Postgres → Variables → `DATABASE_PUBLIC_URL`).
     It adds `DATABASE_URL_BACKUP` to `.env.railway.shared`.
  5. Add to `.env.railway.shared` (for `pnpm backup`): `BACKUP_BUCKET`, `BACKUP_ENDPOINT`, `BACKUP_ACCESS_KEY_ID`,
     `BACKUP_SECRET_ACCESS_KEY`. Save the updated file in the password manager.
  6. GitHub → Settings → Environments → `shared`:
     - secrets `DATABASE_URL_BACKUP`, `BACKUP_ACCESS_KEY_ID`, `BACKUP_SECRET_ACCESS_KEY` (`CRON_SECRET` is there)
     - variables `BACKUP_BUCKET`, `BACKUP_ENDPOINT`, `BACKUP_RECIPIENT` (= the public key) (`DOCS_URL` is there)
  7. Railway → `document-store` → Variables: `BACKUP_BUCKET`, `BACKUP_ENDPOINT`, `BACKUP_ACCESS_KEY_ID`,
     `BACKUP_SECRET_ACCESS_KEY`, `BACKUP_RECIPIENT`. Every app that stores files gets the same five (also
     `complaint-box`, plus `COMPLAINT_URL` in GitHub for its backup step; `attendance-salary`, plus
     `ATTENDANCE_BACKUP_FILES=on` in GitHub for its step; and `job-applications`, plus `JOBS_BACKUP_FILES=on`).
  8. GitHub → Actions → **Backup** → Run workflow. All steps green; then `pnpm backup list` shows the dump.
  9. Do a practice restore (below) once, and again every few months.

  **Restoring** (on this computer; `pnpm backup` only reads the bucket and asks for the private key, hidden):
  ```bash
  pnpm backup list                                   # dumps by date, files per module
  pnpm backup db ~/restore/plantops.dump             # newest dump (or: pnpm backup db 2026-10-12 <file>)
  pnpm backup files document_store ~/restore/documents
  ```
  - Practice: restore the dump into a scratch database and look at it, never into `plantops`:
    ```bash
    sudo -u postgres createdb -O plantops_owner plantops_restore_test
    pg_restore --no-owner --no-privileges -d "postgres://plantops_owner:<local owner password>@localhost/plantops_restore_test" ~/restore/plantops.dump
    ```
  - Real disaster: restore into the Railway Postgres (a new empty `plantops` database, logins from
    `setup-railway-db.sql` first), then copy the files folder into the `document-store` volume at
    `/data/documents` (same `tenant/...` paths). Ask for help before doing this on the live copy.

- **S3-compatible storage** (e.g. Cloudflare R2 or AWS S3) is supported and its signed read/write round trip is
  tested locally. A real bucket is still needed for the live check. Important: setting `STORAGE_BUCKET`
  immediately changes the app to use S3, but does **not** move existing files from `/data`. Keep the current
  volume attached and do not set the bucket on the running service until a safe copy of all stored objects has
  been made and verified. After configuration, upload and download a test document and verify it survives a
  redeploy before considering removal of the volume.
- **Data location:** Singapore (Railway has no India region). Don't tell plants their data is in India.
  If a plant needs it in India, move PlantOps (or that plant's Dedicated copy) to a host with a Mumbai
  region, such as AWS Lightsail Mumbai or DigitalOcean Bangalore.

## 12. When something goes wrong

**Is it up?** These 10 addresses are the whole live copy. Open them by hand, or let UptimeRobot check them (below).

| # | What | Address | Up means |
|---|---|---|---|
| 1 | Platform: login page | `https://app.bluemins.life/login` | page loads (200) |
| 2 | Platform: login keys (every module needs them) | `https://app.bluemins.life/.well-known/jwks.json` | shows `"keys"` |
| 3 | Lab Records | `https://lab.bluemins.life/health` | shows `"database":"ok"` |
| 4 | Document Store | `https://docs.bluemins.life/health` | shows `"database":"ok"` |
| 5 | Floor Stock | `https://stock.bluemins.life/health` | shows `"database":"ok"` |
| 6 | Complaint Box | `https://complaints.bluemins.life/health` | shows `"database":"ok"` |
| 7 | Order Capture | `https://orders.bluemins.life/health` | shows `"database":"ok"` |
| 8 | Attendance & Salary | `https://attendance.bluemins.life/health` | shows `"database":"ok"` |
| 9 | Job applications (sleeps when idle; the first answer takes ~3 s) | `https://jobs.bluemins.life/health` | shows `"database":"ok"` |
| 10 | Job applications: the public page strangers see | `https://jobs.bluemins.life/001` | page loads (200) |

A `/health` that answers 503 with `"database":"unreachable"` means the app runs but can't reach Postgres (table below).

**UptimeRobot (free; STABILITY_PLAN B-09, owner 2026-10-19: every address once a day).** One monitor per row
above, all at the **longest interval (24 hours)**, so services that sleep when idle (`job-applications`, later
`lab-records` and others) are woken only once a day and the Railway saving holds. The cost of this choice: an outage
may be noticed up to a day late; shorten the interval of rows 1–2 (the platform: nothing works without it) if that
proves too slow.
1. uptimerobot.com → free account (owner's email; turn on the mobile app's alerts too).
2. **Add New Monitor** for each row:
   - rows 1 and 10: type **HTTP(s)**, the address, interval **24 hours**
   - rows 2–9: type **Keyword**, the address, keyword `"keys"` (row 2) or `"database":"ok"` (rows 3–9), alert when
     the keyword is **not present**, interval **24 hours**
   - friendly name = the "What" column; alert contact = the owner
3. Nothing to set up on Railway or in the code, and no secret is involved (these addresses are public).
4. A new module adds its `/health` row here and a monitor.

**What went wrong inside an app** (since v0.25.5): super_admin → Plants → **Errors**. Every server error of the
platform and all modules from the last 7 days, grouped, with the plant and "Details" (the code trace). A red card on
the Plants page says "N errors yesterday". Plants never see it; rows are kept 30 days.

**Logs:** Railway → service → **Deployments** → the active deployment → **View logs**. There are build logs
and deploy (runtime) logs. Copy the last ~30 lines when asking for help.

| Symptom | Likely cause and fix |
|---|---|
| Build fails | Read the build log. Often a Dockerfile or lockfile issue. Fix it on `main`, test locally, release again. The old version keeps running meanwhile. |
| Service crashes at start, "Missing environment variable X" | A variable wasn't pasted into that service. Add it → Deploy. |
| `/health` shows `"database":"unreachable"` | Postgres is down, or a `DATABASE_URL_*` is wrong. Check the Postgres service, and that the URLs use `${{Postgres.RAILWAY_PRIVATE_DOMAIN}}`. |
| Module sends people to the wrong login address | `PLATFORM_URL` on that module is wrong. It must be `https://app.bluemins.life`. |
| Login works but opening a module says it can't verify | Module URL or secret mismatch: super_admin → Modules (URL `https://…`, rotate the secret and paste it into the service). |
| Certificate error on a new address | DNS isn't visible yet, or the TXT record is missing. Check with dns.google (section 9) and wait. |
| A page errors after a release | Did you run `railway-migrate.sh` first? If not, run it now. Otherwise go back to the previous release (section 3). |
| Can't run `railway-migrate.sh` / password reset from the terminal | Postgres TCP Proxy is off (Settings → Networking), or `.env.railway.shared` is missing (restore it from the password manager). |
| Daily job failed | GitHub → Actions → open the run. A 401 means `CRON_SECRET` differs between GitHub and the service. A 503 means it's missing on the service. |

## 13. Costs

- Railway Hobby plan: $5/month, which includes $5 of usage. Three small apps + Postgres + a small volume
  is estimated at **about $5–15/month** (₹450–1,300) for pilots.
- Watch it under Railway → workspace → **Usage**.
- Each Dedicated copy costs roughly the same again.
- The website (GitHub Pages) and daily jobs (GitHub Actions) are free.
- For cost control, set **Watch Paths** on each service (DEPLOY.md step 3) so a change to one app doesn't
  rebuild all three.

## 14. Adding a new module later

Example: Floor Stock, Phase 5. It becomes **one more Railway service** and **one more subdomain**, e.g.
`stock.bluemins.life`:
1. Build it in `apps/floor-stock` on the module kit, with its own Dockerfile and database login (e.g.
   `stock_app`).
2. Extend `scripts/setup-railway-db.sql` (new login) and `setup-railway-db.sh` (new block). For an
   **existing** copy, create the login once with `psql` as `postgres`, then run
   `./scripts/railway-migrate.sh shared`.
3. Add the service (same repo, branch `production`, `RAILWAY_DOCKERFILE_PATH=apps/floor-stock/Dockerfile`, its
   port and variables) → custom domain → CNAME + TXT at WordPress.com.
4. super_admin → **Modules**: set its URL and a new client secret → paste the secret into the service.
5. Add its daily job (if any) to `daily.yml`, and update [deployments/shared.md](deployments/shared.md) and
   [DEPLOY.md](DEPLOY.md).

## 15. Decisions made, and why

| Decision | Why |
|---|---|
| Railway, Singapore, one project | Lowest cost and least upkeep; latency is acceptable. No India region on Railway. |
| Subdomains, not ports | Railway gives one HTTPS address per service. Ports would also share cookies between apps (unsafe). |
| Website stays on GitHub Pages | Free and already working. PlantOps lives only on the `app` / `lab` / `docs` subdomains. |
| `production` branch deploys, `main` doesn't | Nothing goes live by accident, and migrations can run before the code. |
| Migrations run from your computer | Simple and rare. Can be automated later. |
| Settings in the dashboard, Dockerfile via `RAILWAY_DOCKERFILE_PATH` | Railway's `railway.json` stops working on 2026-12-01, and new services can't use it. |
| Timed jobs started by cron-job.org (GitHub as safety net) | Free, on time. GitHub's scheduler ran them hours late or not at all (B-01). No extra Railway service. |
| Files on a Railway volume | Cheapest to start. Move to S3/R2 before relying on it for real documents. |
| Shared for every plant, Dedicated only as a paid upgrade | Same code everywhere. No per-plant forks. |
| One record per copy + CHANGELOG + git tags | Always clear which release runs where, and what each release changed. |

## 16. Still to do

- [ ] Finish the first checks on Railway (DEPLOY.md, "Checks after a deploy"):
  - Modules screen addresses
  - a test plant
  - owner tiles
  - both modules via SSO and on a phone
  - a document upload that survives a redeploy
  - the daily job run
  - the support view
- [ ] Delete `.env.railway.shared.paste` once everything is pasted (GitHub environment included).
- [x] Set up the nightly backups (section 11, "Setting it up") and do one practice restore, before real plant
  data.
- [ ] Owner and each document's responsible person turn on phone notifications and send a test (section 10,
  "No email").
- [ ] Set up the 11 cron-job.org jobs (section 10); each **Test run** answers 200.
- [ ] Choose and configure a real S3 bucket only after safely copying and verifying the existing document files.
- [ ] WhatsApp, when Meta approves.
- [ ] Optional: set Watch Paths on each service.
