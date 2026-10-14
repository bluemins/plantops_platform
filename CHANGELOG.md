# Changelog

One entry per release. Every hosted copy (`docs/deployments/`) runs one of these releases. **Migrations**
lists the new database migrations: run `./scripts/railway-migrate.sh <copy>` for each copy **before**
deploying a release that has any (docs/DEPLOY.md, "Releasing an update").

## v0.16.0 — 2026-10-14 — Order Capture: notes after an order is saved

**What's in it**
- **"+ Add a note"** on the order page, for the owner and Order desk, on any order (pending, delivered or
  cancelled). Up to 300 characters; never changed or removed afterwards.
- The note typed with the order stays fixed; the yellow Note box lists it with every added note (who and when).
  History shows "Note by …". Plant staff and PlantOps support read notes but can't add them.
- New notification **"Note added to an order"** (bell only) to the owners and people ticked for Order Capture alerts,
  not the person who wrote it.

**Migrations:** Order Capture `0004_order_notes.sql` (order history accepts a "note" entry; no new table).

## v0.15.0 — 2026-10-14 — Order Capture: WhatsApp thank-you to the customer on "Delivered"

**What's in it**
- The **"Mark delivered"** panel has a tick box, **ticked by default**: "Send a WhatsApp thank-you to <customer>
  (+91 …)". When the order is saved as delivered, PlantOps sends the plant's approved Twilio WhatsApp template to the
  customer, with their name in it. The customer's reply goes to the plant's Twilio number.
- The order's **History** shows "WhatsApp thank-you sent", "… waiting to send" or "… not sent: <Twilio's reason>".
- **Once per order:** after Undo delivered + Delivered again, nothing more is sent.
- A delivery never waits for or fails because of WhatsApp. If Twilio can't be reached, the daily job tries again
  (at most 3 tries, within 24 hours).
- Only plants listed in `TWILIO_WHATSAPP_SENDERS` see the tick box (settings on `order-capture`: `TWILIO_ACCOUNT_SID`,
  `TWILIO_AUTH_TOKEN`, `TWILIO_WHATSAPP_SENDERS`; docs/DEPLOY.md "Good to know").

**Migrations:** Order Capture `0003_customer_messages.sql` (one new table; no existing table changed).

## v0.13.3 — 2026-10-13 — The installed app shows the plant's logo and name

**What's in it**
- **Installed app ("Add to Home Screen") in the plant's own look:** a logged-in plant user's phone now installs the
  app with **the plant's logo** as the icon (on a white square) and **the plant's name** under it, in the plant's
  brand colour. Before login, and for super_admin, it stays PlantOps with the "P".
- A plant with no logo, or a WebP logo, keeps the "P" icon (upload a PNG or JPG logo in Business details).
- **Phones that already installed PlantOps keep the old icon:** remove it from the home screen and add it again
  after logging in (always needed on iPhone).
- Behind the scenes: phones fetch the icon without the login, so each plant's icon and install details are at a
  signed link (`/plant-app/<plant>.<logo version>.<signature>/…`) showing only the name, colour and logo.

**Migrations:** none.

## v0.13.2 — 2026-10-13 — Floor Stock: "Can make" at the bottom of the home page

**What's in it**
- Floor Stock home page: the "Can make from today's stock" card moved to the bottom, below the low-stock list and
  the buttons (History, Sections & items, …), so a long list no longer pushes them off the screen. Same for
  everyone who opens the page.

**Migrations:** none.

## v0.13.1 — 2026-10-13 — Order Capture: order note + owner's pending summary

**What's in it**
- **Order note:** staff can type an optional note (up to 300 characters) before saving a new order, e.g. "deliver
  after 4 pm". It is fixed once saved, like the customer copy, and the database refuses a change. It shows on the
  order page, the saved screen, one line on the pending list, the owner's CSV ("Order note" column after Place) and
  at the end of the owner's "New order" notification (shortened if too long).
- **Owner's pending summary** (owner only) at the top of the Pending tab: the total value of all pending orders,
  and per product the quantity, rate (lowest to highest when customers pay different rates), amount and number of
  orders. Worked out when the page opens, never stored; counts each order's latest version.

**Migrations:** Order Capture `0002_order_note.sql` (one new optional column on `orders`; no new grant).

## v0.13.0 — 2026-10-13 — Order Capture

**What's in it**
- **New module: Order Capture** at `orders.bluemins.life`. Staff take customers' orders on their phone instead of
  sending a WhatsApp message: customer by phone number (found, or added with the order), products with whole
  quantities and a rate filled in from that customer's last order (else the default rate), live total, and a
  reference (O-0001, O-0002 … per plant). Saving twice never makes two orders.
- **Order list:** Pending (oldest first, amber after 2 days) / Delivered / Cancelled, search by order no., name, phone
  or place, dates. The order page has the history and every version.
- **Handling:** Change (saved as a new version), Mark delivered (optional note and Zoho invoice no.), Cancel (with a
  reason; final), Undo delivered (owner only). If two people act at once, the second is told "just changed by …".
- **Rates** (owner): unit and default rate per PlantOps product. **Customers:** name, phone, place, one per phone
  number; the owner can **upload a CSV** (Google Sheets / Excel / Zoho) with a preview of new / unchanged / updated /
  rejected rows before anything is saved.
- **Alerts** (bell + phone): new order to the owner (and people ticked "Gets Order Capture alerts"); delivered to
  whoever entered it; cancelled (bell).
- **New role "Order desk".** Plant staff do **not** work in Order Capture (like Lab Records); give "Order desk" to
  whoever takes orders. Nothing can be deleted.
- **Launcher tile** "N pending · N pending over 2 days · N new today"; owner CSV export; support view with the owner's
  "Support access" page; super_admin "Open Order Capture (read-only)".
- **Behind the scenes:** the Indian-mobile phone rule is shared by Complaint Box and Order Capture (no change for
  users).

**Migrations:** platform `0014_order_capture.sql`; Order Capture `0001_order_capture.sql` (new schema and login: run
`add-railway-module.sh … order_capture …` after the platform migration, see DEPLOY.md "Adding a module").
**Deploy:** `platform`, `complaint-box` (shared phone code) and the new `order-capture` service (no volume). Lab
Records, Document Store and Floor Stock unchanged.

## v0.12.0 — 2026-10-11 — Complaint Box

**What's in it**
- **New module: Complaint Box** at `complaints.bluemins.life`. Plant staff record customer complaints on their phone
  (customer, mobile, place, item, optional batch, what went wrong) with up to 5 photos (shrunk on the phone) and
  one short video, and get a reference (C-0001, C-0002 … per plant).
- **Follow-up:** the complaint list (filters, search, tap-to-call, "Open N days", amber after 3 days), the complaint
  page with photos / video / history, notes with photos, In progress, Resolve with quick picks ("Replaced",
  "Refund given", "Not valid", "Entered by mistake") and Reopen (owner only), owner CSV export.
- **Item list** (owner): starter list from the plant's products + Dispenser / Delivery / Other; switched off, never
  deleted; complaint count per item; Recent changes.
- **Alerts** (bell + phone): new complaint; resolved (to whoever logged it); reopened; note / in progress (bell);
  storage nearly full; still open on day 3, 10, 17…
- **New role "Complaint desk"**; plant staff work in Complaint Box too. Nothing can be deleted; complaint details are
  locked after saving.
- **Launcher tile** "N open · N open over 3 days · N new today"; support view with the owner's "Support access"
  page; nightly encrypted backup of the photos / videos.
- **super_admin dashboard:** "Open Floor Stock (read-only)" now appears too (it was missing).
- **Behind the scenes:** Document Store's file storage moved into the shared module kit (no change for users);
  `add-railway-module.sh` refuses to register a module the platform doesn't know yet.

**Migrations:** platform `0013_complaint_box.sql`; Complaint Box `0001_complaint_box.sql` (new schema and login:
run `add-railway-module.sh … complaint_box …` after the platform migration, see DEPLOY.md "Adding a module").
**Deploy:** `platform`, `document-store` (shared storage code) and the new `complaint-box` service (with a volume).
Lab Records and Floor Stock unchanged.

## v0.11.1 — 2026-10-11 — "Send a test to this phone"

**What's in it**
- **Notifications page: "Send a test to this phone"** once phone notifications are on. One test message to that
  device only (nothing in the bell), with what to check on the phone if it doesn't arrive. A phone whose sign-up has
  expired is removed, so the page shows Off and it can be turned on again.
- Why: Android phones of plant 001 were turned on after the day's last notification, so nothing had been sent to
  them yet and there was no way to check them.

**Migrations:** none. Deploy the `platform` service only.

## v0.11.0 — 2026-10-11 — Floor Stock "Can make"

**What's in it**
- **Floor Stock works out how many boxes today's stock is enough for**, on the home page and each day page, after
  every count and correction. Each product shows "up to N box (M bottles)" and which material runs out first.
- **Set up by the owner on Sections & items:** a **Contents** button on raw material and consumable items ("1 packet
  = 25,000 g", damage allowance %, labels' count = loose pieces) and a **Recipe** button on finished goods ("1 bottle
  = 18.5 g preform + 1 cap + 1 label"). Bottles per box come from the PlantOps product. Store keepers see it
  read-only; every change shows in Recent changes.
- **Products that share a material** (e.g. one preform for two 1 L brands) are shown together as "make one OR the
  other", with the shared material's total for both.
- Nothing changes in the daily count or in existing data: the setup lives in three new tables.

**Migrations:** Floor Stock `0004_recipes.sql`. Deploy the `floor-stock` service only.

## v0.10.0 — 2026-10-11 — Notification settings, reminder hour, outbox, cleanup

**What's in it**
- **Notification settings** on the notifications page: per kind Phone + bell / Bell only / Off (Bell / Off for
  events that never buzz). Urgent ones are always on: ON HOLD, Form 3/4 FAIL, document expiry, someone locked out.
- **Floor Stock evening reminder hour** chosen by the owner on Sections & items: 5 pm–11 pm or Off (default 8 pm).
  **Evening jobs** now run every hour from 5 pm to 11 pm India time; Lab Records still reminds at 8 pm.
- **Nothing lost when PlantOps is briefly down:** a notification that can't be delivered waits in the module's
  outbox and is resent by the next morning / evening job (up to 10 tries or 3 days).
- **Old notifications** (90 days) are removed by the platform's morning job through a locked-down database
  function; the app itself still can't delete notifications.

**Migrations:** platform `0012_notification_settings.sql`, Floor Stock `0003_reminder_and_outbox.sql`,
Lab Records `0004_notification_outbox.sql`, Document Store `0002_notification_outbox.sql`. Deploy all four
services.

## v0.9.0 — 2026-10-11 — Document Store and PlantOps notifications

**What's in it**
- **Document Store notifications:** expiry at 30 / 7 / 1 days before, on expiry, then weekly (one per document,
  also to the responsible person, once per stage like the email), "You are responsible for …" (only that person),
  new / renewed documents (bell only), storage 80% / 95% full.
- **PlantOps notifications to owners:** someone locked out after 5 wrong PINs / passwords (opens Manage users),
  PlantOps support viewed a module (bell), a module switched on (phone) / off and plan changes (bell), plan
  renewal 30 / 7 / 1 days before and on the day (new platform step in **Daily jobs**).

**Migrations:** platform `0011_platform_notifications.sql` (PlantOps events without a module; renewal list
function). Needs **Postgres 15+**. Before deploying: `CRON_SECRET` on the **platform** service and the GitHub
variable `APP_URL`. Deploy `platform` and `document-store`.

## v0.8.0 — 2026-10-11 — Chosen people get alerts; Lab Records notifications

**What's in it**
- **Gets alerts** tick boxes on Manage users → Edit (and when adding a user, and for super_admin): besides the
  owners, only the people the owner ticks get a module's notifications, e.g. a manager for Floor Stock. Only
  modules the person works in are offered; a role change drops ones that no longer fit; every change is audited.
- **Notifications page** `app.bluemins.life/notifications` for everyone, and a 🔔 with the unread count in every
  module's header (staff who skip the launcher reach their alerts and turn on phone notifications there). The
  launcher bell now shows for everyone.
- **Lab Records notifications:** ON HOLD, Form 3/4 FAIL, ready for approval, approved / rejected (also to the
  technicians who tested the batch), result corrected (bell only), the morning reminder, and "No lab tests
  entered today" at 20:00 (new Lab Records step in **Evening jobs**). WhatsApp alerts are unchanged.

**Migrations:** platform `0010_alert_recipients.sql` (who gets which module's alerts; RLS). Deploy `platform`,
`lab-records`, `floor-stock` and `document-store` (header bell).

## v0.7.0 — 2026-10-11 — App notifications (bell + phone), Floor Stock first

**What's in it**
- **Bell 🔔 on the owner's launcher** with the unread count and a list (tap = open the module page, mark all
  read). Free phone notifications through Web Push once the owner taps **Turn on** (iPhone: Add to Home Screen
  first; the card explains it). PlantOps is now installable (`manifest.webmanifest`, app icon, `sw.js`).
- **Floor Stock tells the owners:** count saved / corrected / low stock / check the count (one notification per
  save, the most serious wins the title), "Today's stock count is not done yet" at 8 pm India time (new
  **Evening jobs** workflow), and setup changes by a store keeper (bell only). Never for the owner's own actions.
- Modules send events with `kit.notify()`; the platform decides who receives them (`POST
  /api/m/tenants/:tid/notifications`). Logging out turns notifications off for that phone. Email alerts are
  unchanged. Design and later phases: `docs/notifications.md`.

**Migrations:** platform `0009_notifications.sql` (tables `notifications`, `push_subscriptions`, both with RLS);
Floor Stock `0002_counting_tenants.sql` (plant ids for the evening job). Before deploying `platform`, add its
three `VAPID_*` variables (`pnpm --filter @plantops/platform push:keys`; docs/DEPLOY.md step 4). Deploy
`platform` and `floor-stock`.

## v0.6.2 — 2026-10-11 — Nightly encrypted backups

**What's in it**
- **Backup** workflow (`.github/workflows/backup.yml`, 02:00 India time): a `pg_dump` of the whole database with a
  new read-only login, checked, encrypted with `age` and uploaded to a private Cloudflare R2 bucket; dumps are kept
  30 days.
- Document Store copies its new uploaded files, encrypted, to the same bucket (`POST /api/cron/backup`, shared code
  in `packages/module-kit/src/backup.ts`, so any future app with files does the same).
- `pnpm backup:keygen` (key pair) and `pnpm backup list | db | files | decrypt` (restore). Only the public key is
  on servers and in GitHub.
- `scripts/setup-backup-login.sh` creates the read-only login `plantops_backup` (SELECT only, read-only sessions,
  BYPASSRLS so the dump has every plant's rows); `railway-migrate.sh` keeps its read access up to date.
- Document Store's S3 signing moved into `packages/module-kit/src/s3.ts` (now also lists a bucket).

**Migrations:** none. One-time setup per copy: docs/HANDBOOK.md section 11, "Setting it up". Deploy
`document-store` (the other apps are unchanged).

## v0.6.1 — 2026-10-08 — Plant staff role

**What's in it**
- **New role "Plant staff"** on the owner's Add user / edit user screens. A general plant worker who can work
  in every module the plant has switched on, with that module's normal staff rights, **except Lab Records**
  (lab technicians and lab leads only; refused by Lab Records' own server).
  - Floor Stock: same as a store keeper (count, add / edit items; no limits or sections).
  - Document Store: same as a document keeper; can be a document's responsible person.
  - Launcher: a tile per module they may open; with only one, they go straight into it.
- The SSO token is unchanged.

**Migrations:** `apps/platform/db/migrations/0008_plant_staff.sql` (adds the role row). Run
`./scripts/railway-migrate.sh <copy>` before pushing to `production`. Deploy **all four apps**: a module still on
v0.6.0 refuses plant staff until it is rebuilt.

## v0.6.0 — 2026-10-08 — Floor Stock

**What's in it**
- **Floor Stock (Phase 5)**, a new module app at `stock.bluemins.life` (port 3002). It replaces the evening
  WhatsApp message:
  - each plant's own sections and items, with a starter list made from the plant's products
  - the daily count: today's production + closing stock, for today or yesterday, pre-filled, locked on submit,
    corrections with a reason; append-only in the database
  - day page with Sold / Used / received worked out against the day before, history by date and by item,
    Recent changes, owner CSV, "Copy as WhatsApp message"
  - low-stock email to the owners (once per item per day), tile badges, read-only support view
- **Platform:** the owner's Floor Stock tile has a "⚙ Set up sections" link; the staff tile says "Daily stock
  count". No database change.
- **Email sender** moved into `packages/module-kit` (shared by Document Store and Floor Stock); Document Store's
  behaviour is unchanged.
- `apps/dev-module` no longer serves Floor Stock or Document Store (development only).
- **Deployment:** new `apps/floor-stock/Dockerfile`; `scripts/add-railway-module.sh` adds a module to a copy that
  already runs; `setup-railway-db.sh` includes Floor Stock for new copies; the daily workflow gets a Floor Stock
  step (skipped until the GitHub variable `STOCK_URL` is set).

**Migrations:** `apps/floor-stock/db/migrations/0001_floor_stock.sql` (new schema `floor_stock`). It needs the
`stock_app` login first. On an existing copy, run `./scripts/add-railway-module.sh <copy> floor_stock stock_app
STOCK 3002 <address>` **before** pushing to `production` (docs/DEPLOY.md, "Adding a module to a running copy").

## v0.5.1 — 2026-10-04 — Document Store email through Brevo's API

**What's in it**
- **Document Store:**
  - reminder emails can go through Brevo's HTTPS API (`BREVO_API_KEY` + `MAIL_FROM`). Railway's Hobby plan blocks
    outgoing SMTP, so SMTP sends timed out. SMTP still works where the host allows it.
  - a failed reminder email is tried again by each daily run for 7 days, then left as failed
- Daily jobs workflow: fixed invalid YAML; it had never run before.

**Migrations:** none.

## v0.5.0 — 2026-10-04 — Document Store follow-ups

**What's in it**
- **Document Store:**
  - owner-only ZIP download (`/api/export/files`): the CSV list plus the original file of every version; audited
  - English / Hindi / Odia screens, chosen from the header (a browser preference; emails stay English)
  - email reminders wait as "pending" until SMTP is set up and are then sent; old "Email is not set up yet"
    rows are retried once SMTP works
  - incomplete SMTP or storage settings now stop with a clear error instead of failing quietly
- Deployment: Railway's `railway.json` is deprecated, and new services can't use it. The `apps/*/railway.json`
  files are removed. Settings are now made in the dashboard, following `docs/DEPLOY.md`, and the Dockerfile is
  set by `RAILWAY_DOCKERFILE_PATH`, which `setup-railway-db.sh` now writes.
- New package: `archiver` (Document Store, for the ZIP).

**Migrations:** none.

## v0.4.0 — 2026-10-04 — first deployable release (Phases 1–4)

**What's in it**
- **Platform (Phase 1):**
  - plant login with plant code + username + PIN/password, and forced change of temporary secrets
  - super_admin: plants, plans, owners, users
  - owner: user management, business details (logo, brand colour), products
  - SSO with one-time handoff codes and EdDSA tokens
- **Launcher (Phase 2):**
  - module tiles per role and plan, with live numbers
  - single-module staff go straight into their module
  - direct module links for phones (`/sso/start`)
  - super_admin Modules screen and plant dashboard
  - plant brand colour on every screen
- **Lab Records (Phase 3):**
  - batches with hold / approve / reject
  - daily tests with automatic pass/fail
  - FSSAI Forms 1–4
  - append-only results, enforced by the database
  - failed-test flow
  - WhatsApp alerts (off until Meta approves)
  - daily reminders, print-ready registers, CSV export
  - support view (read-only, logged)
- **Document Store (Phase 4):**
  - documents with renewal history and files
  - expiry email reminders (off until SMTP is set up)
  - plan storage limit, CSV export, support view
- **Shared module kit** (`packages/module-kit`).
- **Deployment:**
  - Railway config per app (`apps/*/railway.json`)
  - `scripts/setup-railway-db.sh` and `scripts/railway-migrate.sh`
  - GitHub daily-job workflow
  - `docs/DEPLOY.md` and `docs/deployments/`

**Migrations** (all, first setup):
- platform `0001`–`0007`
- lab_records `0001`–`0003`
- document_store `0001`
