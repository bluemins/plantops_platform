# Copy: `shared`

The normal PlantOps copy that every plant uses (separated by `tenant_id` + row-level security).
Set up and updated with [`../DEPLOY.md`](../DEPLOY.md). **Never write secrets in this file.**

| | |
|---|---|
| Status | **Live** since 2026-10-04 (first checks in progress) |
| Hosting | Railway, region Singapore |
| Railway project | `plantops-shared`, environment `production`; services `Postgres`, `platform`, `lab-records`, `document-store` (+ `document-store-volume` at `/data`) |
| Deploys from | git branch `production` (pushing `main` does not deploy) |
| Platform | https://app.bluemins.life |
| Lab Records | https://lab.bluemins.life |
| Document Store | https://docs.bluemins.life (volume at `/data`) |
| DNS | WordPress.com (bluemins.life itself stays on GitHub Pages) |
| super_admin login | contact@bluemins.life (password in the password manager) |
| Secrets | Railway variables + password manager entry "PlantOps railway shared"; `.env.railway.shared` on Rocky's computer |
| Daily jobs | GitHub environment `shared` (`.github/workflows/daily.yml`) |
| Email (SMTP) | Brevo (`smtp-relay.brevo.com`), sender `contact@bluemins.life`; domain DKIM + DMARC records at WordPress.com (2026-10-04). Live sending not yet confirmed |
| WhatsApp | not set up (waiting for Meta approval) |
| File storage | Railway volume (move to S3-compatible storage + backups before real plant documents) |
| Backups | to switch on (Postgres → Backups) before real plant data |
| Runs release | v0.4.0 (`production` = commit `bcb3ffd`) |

## History
| Date | What |
|---|---|
| 2026-10-04 | Hosting decided: Railway Singapore, subdomains app / lab / docs. Deploy files added (v0.4.0). |
| 2026-10-04 | Database set up (`setup-railway-db.sh shared`); 3 services + volume created; DNS at WordPress.com; HTTPS live on all three; health checks OK. v0.4.0 live from branch `production`. super_admin password changed. |
