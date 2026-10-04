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
                         Postgres        one database, private (each app its own schema + login)

GitHub repo bluemins/plantops_platform
  main        everyday work (pushing it does NOT deploy)
  production  what Railway runs (pushing it DEPLOYS)
  Actions     "Daily jobs" at 07:00 India time
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
| Addresses | `http://localhost:3000` / `:3001` / `:3003` | `https://app` / `lab` / `docs.bluemins.life` |
| Settings and secrets | `.env` in the project folder | each service → **Variables** |
| Database | Postgres on this computer (`plantops`; tests use `plantops_test`) | Railway's Postgres |
| super_admin | `admin@plantops.local` | `contact@bluemins.life` |
| Plants, users, lab records, documents | test data only | real data |
| Uploaded files | `.data/` in the project folder | `document-store-volume` |
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
| `CRON_SECRET` | lab-records, document-store **and** GitHub environment `shared` | (pasted, then file deleted) | ✔ |
| super_admin password | (stored as a hash in the database) | not stored | ✔ |

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
| `CRON_SECRET` | Change it on both modules **and** in the GitHub environment. |
| SSO key | Run `pnpm sso:keygen`. Put the new key in platform's `SSO_PRIVATE_JWK_B64`, and the old *public* key in `SSO_PREVIOUS_PUBLIC_JWK_B64` for a day. |
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

## 10. Daily jobs, email and WhatsApp

**Daily jobs.** GitHub Actions runs **Daily jobs** (`.github/workflows/daily.yml`) every day at **07:00 India
time**, for each copy listed in it:
- Lab Records: reminders about holds older than 24 h, and Form 1 due from the 25th
- Document Store: expiry emails

To check or run it: GitHub → **Actions** → *Daily jobs*. Click **Run workflow** to run it now. A failed run
sends GitHub's failure email.

Its settings live in GitHub → Settings → **Environments** → `shared`: variables `LAB_URL` and `DOCS_URL`,
and the secret `CRON_SECRET`. If the repo is ever made public, GitHub pauses schedules after 60 days without
commits.

**Email (Document Store reminders): not set up yet.** Until it is, reminders show "Email is not set up yet".
To set it up:
1. Get an SMTP account (Brevo or Resend have free tiers; Zoho or Amazon SES also work).
2. Add `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS` and `MAIL_FROM` to **document-store** → Variables.
3. Make sure owners and responsible users have an email saved.

**WhatsApp (Lab Records alerts): waiting for Meta approval.** Alerts are kept as "WhatsApp not set up yet".
When approved, add `WHATSAPP_TOKEN`, `WHATSAPP_PHONE_ID`, `WHATSAPP_TEMPLATE` and `WHATSAPP_TEMPLATE_LANG` to
**lab-records** → Variables.

## 11. Files, backups and data location

- **Uploaded documents** are on `document-store-volume`, mounted at `/data`. `DOC_STORAGE_DIR=/data/documents`,
  and `RAILWAY_RUN_UID=0` lets the app write there.
- **Back up before real plant data goes in.**
  - Postgres → **Backups** tab: switch on scheduled backups.
  - Do the same for `document-store-volume` if your plan offers it.
  - Otherwise take a weekly dump from your computer:
    ```bash
    pg_dump "$(grep ^DATABASE_URL_OWNER= .env.railway.shared | cut -d= -f2-)" -Fc -f plantops-$(date +%F).dump
    ```
- **Later, move the files to S3-compatible storage** (e.g. Cloudflare R2 or AWS S3) with built-in backups:
  1. Set `STORAGE_BUCKET`, `STORAGE_ENDPOINT`, `STORAGE_REGION`, `STORAGE_ACCESS_KEY_ID` and
     `STORAGE_SECRET_ACCESS_KEY` on document-store.
  2. Remove the volume and `RAILWAY_RUN_UID`.

  The code already supports this.
- **Data location:** Singapore (Railway has no India region). Don't tell plants their data is in India.
  If a plant needs it in India, move PlantOps (or that plant's Dedicated copy) to a host with a Mumbai
  region, such as AWS Lightsail Mumbai or DigitalOcean Bangalore.

## 12. When something goes wrong

**Is it up?** Open these. All should load:
- `https://app.bluemins.life/.well-known/jwks.json` shows a key
- `https://lab.bluemins.life/health` shows `"database":"ok"`
- `https://docs.bluemins.life/health` shows `"database":"ok"`

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
| Daily jobs from GitHub Actions | Free. No extra Railway service. |
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
- [ ] Switch on Postgres backups (and volume backups if available) before real plant data.
- [ ] Set up SMTP email for Document Store.
- [ ] WhatsApp, when Meta approves.
- [ ] Optional: set Watch Paths on each service.
- [ ] Optional: turn off the Postgres TCP Proxy between releases (switch it on again to run migrations or
  password resets).
