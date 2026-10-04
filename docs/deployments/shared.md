# Copy: `shared`

The normal PlantOps copy that every plant uses (separated by `tenant_id` + row-level security).
Set up and updated with [`../DEPLOY.md`](../DEPLOY.md). **Never write secrets in this file.**

| | |
|---|---|
| Status | Being set up |
| Hosting | Railway, region Singapore |
| Railway project | _(name, once created)_ |
| Platform | https://app.bluemins.life |
| Lab Records | https://lab.bluemins.life |
| Document Store | https://docs.bluemins.life (volume at `/data`) |
| DNS | WordPress.com (bluemins.life itself stays on GitHub Pages) |
| super_admin login | _(email)_ |
| Secrets | Railway variables + password manager entry "PlantOps railway shared"; `.env.railway.shared` on Rocky's computer |
| Daily jobs | GitHub environment `shared` (`.github/workflows/daily.yml`) |
| Email (SMTP) | not set up |
| WhatsApp | not set up (waiting for Meta approval) |
| File storage | Railway volume (move to S3-compatible storage + backups before real plant documents) |
| Backups | _(to decide before real plant data)_ |
| Runs release | _(none yet; first deploy will be v0.4.0)_ |

## History
| Date | What |
|---|---|
| 2026-10-04 | Hosting decided: Railway Singapore, subdomains app / lab / docs. Deploy files added (v0.4.0). |
