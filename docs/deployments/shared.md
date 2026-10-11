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
| Daily jobs | GitHub environment `shared` (`.github/workflows/daily.yml`); first successful run 2026-10-04 (#8) |
| Email | Brevo HTTPS API (`BREVO_API_KEY`; Railway Hobby blocks SMTP), sender `contact@bluemins.life`; domain DKIM + DMARC records at WordPress.com (2026-10-04). Live sending not yet confirmed |
| WhatsApp | not set up (waiting for Meta approval) |
| File storage | Railway volume (move to S3-compatible storage + backups before real plant documents) |
| Backups | nightly encrypted dump + Document Store files to Cloudflare R2 (`backup.yml`, v0.6.2): **not set up yet** (HANDBOOK.md section 11). Railway's Backups tab needs Pro |
| Runs release | v0.6.1 (`production` = commit `2b01230`) |

## History
| Date | What |
|---|---|
| 2026-10-04 | Hosting decided: Railway Singapore, subdomains app / lab / docs. Deploy files added (v0.4.0). |
| 2026-10-04 | Database set up (`setup-railway-db.sh shared`); 3 services + volume created; DNS at WordPress.com; HTTPS live on all three; health checks OK. v0.4.0 live from branch `production`. super_admin password changed. |
| 2026-10-04 | v0.5.0 live (Document Store ZIP export, Hindi/Odia, safer email setup). Brevo SMTP + domain DKIM/DMARC set up. Daily jobs workflow fixed (invalid YAML) and run #8 succeeded. |
| 2026-10-08 | v0.6.0 live: Floor Stock added with `add-railway-module.sh` (`stock_app` login, migration, module registration), new `floor-stock` service, `stock` CNAME + `_railway-verify` TXT at WordPress.com, HTTPS issued. Checks: all four health endpoints OK, platform login redirect, APIs refuse without session / ticket / secret. Platform, Lab Records and Document Store redeployed fine. |
| 2026-10-11 | v0.6.1 live (Plant staff role). `railway-migrate.sh shared`: all four apps "up to date", so platform migration `0008_plant_staff.sql` was already applied. "Plant staff" shows on the owner's Users screen. Saving a user with the role not yet tried. |
