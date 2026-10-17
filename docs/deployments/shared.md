# Copy: `shared`

The normal PlantOps copy that every plant uses (separated by `tenant_id` + row-level security).
Set up and updated with [`../DEPLOY.md`](../DEPLOY.md). **Never write secrets in this file.**

| | |
|---|---|
| Status | **Live** since 2026-10-04 (first checks in progress) |
| Hosting | Railway, region Singapore |
| Railway project | `plantops-shared`, environment `production`; services `Postgres`, `platform`, `lab-records`, `document-store` (+ `document-store-volume` at `/data`), `floor-stock`, `complaint-box` (volume at `/data`: to confirm), `order-capture` (no volume), `attendance-salary` (no volume) |
| Deploys from | git branch `production` (pushing `main` does not deploy) |
| Platform | https://app.bluemins.life |
| Lab Records | https://lab.bluemins.life |
| Document Store | https://docs.bluemins.life (volume at `/data`) |
| Floor Stock | https://stock.bluemins.life (since 2026-10-08) |
| Complaint Box | https://complaints.bluemins.life (since 2026-10-12) |
| Order Capture | https://orders.bluemins.life (since 2026-10-13) |
| Attendance | https://attendance.bluemins.life (v0.18.0; recorded afterwards on 2026-10-16) |
| DNS | WordPress.com (bluemins.life itself stays on GitHub Pages) |
| super_admin login | contact@bluemins.life (password in the password manager) |
| Secrets | Railway variables + password manager entry "PlantOps railway shared"; `.env.railway.shared` on Rocky's computer |
| Daily jobs | GitHub environment `shared` (`.github/workflows/daily.yml`, 07:00 IST: Platform, Lab Records, Document Store, Floor Stock); first successful run 2026-10-04 (#8). Variables `APP_URL`, `LAB_URL`, `DOCS_URL`, `STOCK_URL`, `COMPLAINT_URL`, `ORDER_URL` + secret `CRON_SECRET` (also on every Railway service, platform since 2026-10-11) |
| Evening jobs | `.github/workflows/evening.yml`, hourly 17:00-23:00 IST (Lab Records from 20:00, Floor Stock at each plant's reminder hour); first run green 2026-10-11 |
| App notifications | Web Push keys `VAPID_*` on `platform` (own pair for this copy, in the password manager; created 2026-10-11). Working on desktop (Chrome, Firefox) and Android (installed app, test push) since 2026-10-11; iPhone not yet tested |
| Email | Brevo HTTPS API (`BREVO_API_KEY`; Railway Hobby blocks SMTP), sender `contact@bluemins.life`; domain DKIM + DMARC records at WordPress.com (2026-10-04). Live sending not yet confirmed |
| WhatsApp | not set up (waiting for Meta approval) |
| File storage | Railway volume (move to S3-compatible storage + backups before real plant documents) |
| Backups | nightly 02:00 IST, encrypted (`age`), to Cloudflare R2 bucket `plantops-backup` (`backup.yml`): database dump (30 days, read-only login `plantops_backup`) + Document Store files. Private key in the password manager. Practice restore done 2026-10-11 |
| Runs release | v0.19.0 (`production` = commit `b12380b`) |

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
| 2026-10-11 | v0.11.1 live ("Send a test to this phone" on `/notifications`; platform only, no migration). Why: plant 001's four Android phones were signed up correctly but turned on after the day's last notification, so nothing had reached them. Checks: `/api/push/test` refuses without login (401). Same day: the owner confirmed the test push arrives on Android (installed app). |
| 2026-10-12 | v0.12.0 live (Complaint Box), recorded afterwards on 2026-10-13. `production` = `a375c8f`; the live database has the `complaint_box` schema, so `backup.yml` now also checks it is in each nightly dump (`91f32c3`). Check 2026-10-13: `complaints.bluemins.life/health` 200 with the database OK. The owner has tried it on a phone. **To confirm** (not recorded at deploy time): volume at `/data`, `CRON_SECRET` + five `BACKUP_*` on `complaint-box`, GitHub variable `COMPLAINT_URL`, a green Daily jobs and Nightly backup run with complaint files in R2. Delete `.env.railway.shared.complaint_box.paste` once its values are saved. |
| 2026-10-13 | v0.13.0 live (Order Capture, `orders.bluemins.life`). In order: platform migration `0014_order_capture.sql` (module + role "Order desk" only; checked read-only, no plan had it); `add-railway-module.sh shared order_capture order_app ORDER 3005 orders.bluemins.life` (login `order_app` without BYPASSRLS, 8 tables all FORCE RLS, none owned by the app login, migration `0001`, registration `https://orders.bluemins.life` with its secret) and `railway-migrate.sh shared` (all apps up to date; backup login reads `order_capture`); new Railway service `order-capture` (branch `production`, `/health`, Singapore, **no volume**, variables from the paste file + `CRON_SECRET`); DNS at WordPress.com: `orders` CNAME `tem8un74.up.railway.app` + `_railway-verify.orders` TXT (seen in public DNS); GitHub variable `ORDER_URL`; `git push origin v0.13.0:production` (`77a39ce`). Checks: `/health` database OK; pages without a session → PlantOps login; new order / rates / CSV / lookup APIs 401; tile numbers without (or with a fake) platform ticket 401; daily job with no / wrong secret 401; fake login / support codes 403; the platform recognises the module (`/sso/start?module=order_capture` → login); JWKS + Lab / Docs / Stock / Complaints health OK. `backup.yml` now also checks the dump has `order_capture` data. The module secret was printed once in a Claude Code session log during setup: rotate it in super_admin → Modules if wanted. **To do:** Daily jobs run with the Order Capture step green; first nightly backup with `order_capture`; the owner's phone checklist (plant 001). |
| 2026-10-13 | v0.13.1 live (Order Capture: order note + owner's pending summary). `railway-migrate.sh shared` applied Order Capture `0002_order_note.sql` before the deploy (other apps up to date); checked on the live database: `orders.order_note` exists, nullable, `order_app` may INSERT but not UPDATE it. `v0.13.1:production` (`6821739`) pushed by the owner. Checks: `orders` `/health` database OK, login redirect; JWKS + Lab / Docs / Stock / Complaints health OK. Not yet tried on screen: a note on a real order, the owner's summary card. |
| 2026-10-13 | v0.13.2 live (Floor Stock "Can make" card at the bottom of the home page; no migration). `v0.13.2:production` (`5491df5`) pushed by the owner. Checks: Lab / Docs / Stock / Complaints / Orders health and platform JWKS OK. |
| 2026-10-13 | v0.13.3 live (installed app in the plant's own look; no migration), pushed by the owner (`3092c96`); recorded afterwards on 2026-10-14. |
| 2026-10-14 | v0.14.0 live (Order Capture: plant staff view-only without amounts, tick + "Copy as WhatsApp message" on Pending; owner's Permissions screen; no migration, SSO token unchanged). `git push origin v0.14.0:production` (`e09f10b`); only `platform` and `order-capture` changed. Checks: see below. |
| 2026-10-14 | v0.15.0 live (Order Capture WhatsApp thank-you, migration Order Capture `0003_customer_messages.sql`): `production` = `b5d4cf6`; recorded afterwards with v0.16.0 (the migration was already applied when v0.16.0's migrations ran). Twilio settings on `order-capture` and a real message not yet checked. |
| 2026-10-14 | v0.16.0 live (Order Capture: notes after an order is saved). `railway-migrate.sh shared` applied Order Capture `0004_order_notes.sql` before the deploy (other apps up to date); checked on the live database: `order_events` allows kind `note` with text required, `order_app` still has no UPDATE / DELETE on it. `git push origin v0.16.0:production` (`4a0a749`). Checks: new `/api/orders/<id>/notes` refuses without login (401); `orders` `/health` database OK and login redirect; JWKS + Lab / Docs / Stock / Complaints health OK. Not yet tried on screen: adding a note to a real order, the bell notification, the new kind on `/notifications`. |
| 2026-10-15 | v0.16.1 live (clearer role buttons on Add / Edit user; platform screen only, no migration, no access change). `git push origin v0.16.1:production` (`8a9c749`). Checks: the live Users screen code has the new texts; JWKS and `/login` 200; Lab / Docs / Stock / Complaints / Orders `/health` database OK. Not yet looked at on screen by the owner. |
| 2026-10-15 | v0.17.0 live (Plant staff = employee: no longer opens Floor Stock, Document Store, Complaint Box or Marketing Contacts; keeps the Order Capture view; no migration). Before the deploy the owner had moved everyone off Plant staff except Gaja (Store keeper + Plant staff), so only Gaja lost Document Store + Complaint Box. `git push origin v0.17.0:production` (`232f02c`). Checks: the live Users screen code has the new Plant staff text; JWKS and `/login` 200; Lab / Docs / Stock / Complaints / Orders `/health` database OK. Not yet tried: a Plant-staff-only login refused by Floor Stock on the live copy. |
| 2026-10-16 | v0.18.0 (Attendance) and v0.19.0 (Floor Stock "Made from") live, recorded afterwards during Salary Phase 0: `production` = `b12380b`; `attendance.bluemins.life/health` 200 with the database OK; the owner says Attendance is in use at plant 001. Not recorded at deploy time: the `add-railway-module.sh` run, DNS, the `attendance-salary` service variables, GitHub variable `ATTENDANCE_URL` and a green Daily jobs run with the Attendance step. |

## v0.20.0 (Salary): owner's checklist at plant 001
From `docs/SALARY_PHASE_PLAN.md` Phase 7; how-to in `docs/HANDBOOK.md` "Attendance: salary at month end". Tick each
when done and date it.
1. [ ] Set salary, shift hours, paid leave and overtime (Gets overtime + rate) for each person (Staff → person).
2. [ ] Enter this month's advances.
3. [ ] Open the Salary tab and check two people with the checking panel against the notebook.
4. [ ] A worker checks their calendar shows overtime (only if they get it) and no money.
5. [ ] Download the Salary CSV.
6. [ ] At month end (31 Oct, 07:00): the "salary review" notification arrives; fix any no-exit days; read "Remaining
   to pay".
7. [ ] Tick "Can see own salary" for one person and mark their month Paid: they get "Your salary is paid" and see only
   their own slip; a person without the tick sees attendance only.
