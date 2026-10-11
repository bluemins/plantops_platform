# Copy: `shared`

The normal PlantOps copy that every plant uses (separated by `tenant_id` + row-level security).
Set up and updated with [`../DEPLOY.md`](../DEPLOY.md). **Never write secrets in this file.**

| | |
|---|---|
| Status | **Live** since 2026-10-04 (first checks in progress) |
| Hosting | Railway, region Singapore |
| Railway project | `plantops-shared`, environment `production`; services `Postgres`, `platform`, `lab-records`, `document-store` (+ `document-store-volume` at `/data`), `floor-stock` |
| Deploys from | git branch `production` (pushing `main` does not deploy) |
| Platform | https://app.bluemins.life |
| Lab Records | https://lab.bluemins.life |
| Document Store | https://docs.bluemins.life (volume at `/data`) |
| Floor Stock | https://stock.bluemins.life (since 2026-10-08) |
| DNS | WordPress.com (bluemins.life itself stays on GitHub Pages) |
| super_admin login | contact@bluemins.life (password in the password manager) |
| Secrets | Railway variables + password manager entry "PlantOps railway shared"; `.env.railway.shared` on Rocky's computer |
| Daily jobs | GitHub environment `shared` (`.github/workflows/daily.yml`, 07:00 IST: Platform, Lab Records, Document Store, Floor Stock); first successful run 2026-10-04 (#8). Variables `APP_URL`, `LAB_URL`, `DOCS_URL`, `STOCK_URL` + secret `CRON_SECRET` (also on every Railway service, platform since 2026-10-11) |
| Evening jobs | `.github/workflows/evening.yml`, hourly 17:00-23:00 IST (Lab Records from 20:00, Floor Stock at each plant's reminder hour); first run green 2026-10-11 |
| App notifications | Web Push keys `VAPID_*` on `platform` (own pair for this copy, in the password manager; created 2026-10-11). Working on desktop (Chrome, Firefox) since 2026-10-11; Android / iPhone not yet tested |
| Email | Brevo HTTPS API (`BREVO_API_KEY`; Railway Hobby blocks SMTP), sender `contact@bluemins.life`; domain DKIM + DMARC records at WordPress.com (2026-10-04). Live sending not yet confirmed |
| WhatsApp | not set up (waiting for Meta approval) |
| File storage | Railway volume (move to S3-compatible storage + backups before real plant documents) |
| Backups | nightly 02:00 IST, encrypted (`age`), to Cloudflare R2 bucket `plantops-backup` (`backup.yml`): database dump (30 days, read-only login `plantops_backup`) + Document Store files. Private key in the password manager. Practice restore done 2026-10-11 |
| Runs release | v0.11.0 (`production` = commit `e77204f`) |

## History
| Date | What |
|---|---|
| 2026-10-04 | Hosting decided: Railway Singapore, subdomains app / lab / docs. Deploy files added (v0.4.0). |
| 2026-10-04 | Database set up (`setup-railway-db.sh shared`); 3 services + volume created; DNS at WordPress.com; HTTPS live on all three; health checks OK. v0.4.0 live from branch `production`. super_admin password changed. |
| 2026-10-04 | v0.5.0 live (Document Store ZIP export, Hindi/Odia, safer email setup). Brevo SMTP + domain DKIM/DMARC set up. Daily jobs workflow fixed (invalid YAML) and run #8 succeeded. |
| 2026-10-08 | v0.6.0 live: Floor Stock added with `add-railway-module.sh` (`stock_app` login, migration, module registration), new `floor-stock` service, `stock` CNAME + `_railway-verify` TXT at WordPress.com, HTTPS issued. Checks: all four health endpoints OK, platform login redirect, APIs refuse without session / ticket / secret. Platform, Lab Records and Document Store redeployed fine. |
| 2026-10-11 | v0.6.1 live (Plant staff role). `railway-migrate.sh shared`: all four apps "up to date", so platform migration `0008_plant_staff.sql` was already applied. "Plant staff" shows on the owner's Users screen. Saving a user with the role not yet tried. |
| 2026-10-11 | v0.6.2 live (nightly backups). R2 bucket + scoped token, backup key pair, `setup-backup-login.sh shared`, GitHub + document-store variables. Backup run #1 green: 1 database dump + 3 Document Store files in the bucket (`pnpm backup list`). |
| 2026-10-11 | v0.7.0-v0.10.0 live together (app notifications N1-N4). Railway Postgres 18.6 (≥ 15 needed). `VAPID_*` (new pair) and `CRON_SECRET` added to `platform`; `APP_URL` added as a GitHub environment variable. `railway-migrate.sh shared`: platform `0009`-`0012`, Lab Records `0004`, Document Store `0002`, Floor Stock `0002`-`0003` applied; live apps unaffected while still on v0.6.2. Tags pushed, `v0.10.0:production` deployed (about 2 minutes). Checks: manifest, `sw.js` (no-cache), icon, `/notifications` 200; notification APIs 401 without login; all cron routes refuse a wrong secret (401); module health OK. Evening jobs run green (Lab waiting for 20:00, Floor Stock 1 plant not yet due); Daily jobs green after `APP_URL` / platform `CRON_SECRET` were fixed. Not yet tried: an owner turning on phone notifications, Android / iPhone delivery. |
| 2026-10-11 | First real notifications, plant 001 Bluemins. Bindu's count (14:15) → "Low stock: 1 item" to the owner only (nobody ticked yet; no device turned on). Owner ticked Kedar (plant staff + store keeper) for Floor Stock; owner turned on Chrome and Kedar Firefox (Windows). A correction (14:20) → "Count corrected (v2)" to both, phone level, outbox empty, both subscriptions still valid. |
| 2026-10-11 | v0.11.0 live (Floor Stock "Can make"). `railway-migrate.sh shared` applied Floor Stock `0004_recipes.sql`: the three new tables (`material_contents`, `recipes`, `recipe_lines`) exist with FORCE row-level security, still empty. `v0.11.0:production` deployed. Checks: Floor Stock `/health` database OK; platform JWKS, Lab Records and Document Store health 200. Same day: the owner entered Contents (9 materials) and Recipes (8 products, 22 lines) for plant 001 and checked the home page against a count. Decided: no Brevo email for Floor Stock; low-stock alerts by app notifications only. |
