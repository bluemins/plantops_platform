# Order Capture — module notes

Orders that staff and marketing staff take from customers (hotels, shops, homes), entered on their phones instead of
a WhatsApp message; the owner and the Order desk see what is pending and mark it delivered. Billing stays in the
plant's own tool (Zoho Invoice). Design, phases and build prompts: `docs/ORDER_CAPTURE_PHASE_PLAN.md`.

- App `apps/order-capture` on **:3005**, on `packages/module-kit` (built like `apps/complaint-box`).
- Database schema `order_capture`, login `order_app` (`./scripts/setup-module-db.sh order_capture order_app ORDER
  3005`), `.env` prefix `ORDER_`.
- No files, so no storage, volume or file backup; the nightly database dump covers the schema.

## Who may do what
**One table**, `src/server/access.ts`, used by every route and page:
- **Owner** (`tenant_admin`): everything.
- **Order desk:** read, amounts, enter / change orders, customers, deliver, cancel.
- **Plant staff** (without Order desk): **view only, no amounts** (owner, 2026-10-14). They see the order list and each
  order (customer, phone, place, products, quantities, note, history) and can tick pending orders to copy. They don't
  see rates, totals, the customer list, Rates or CSV, and never write. Rule: `viewOnlyIn()` + `PLANT_STAFF_VIEW_ONLY`
  in `packages/types`. Order Capture stays in `PLANT_STAFF_EXCLUDED`, so plant staff are never Order desk, never
  ticked for its alerts (the "New order" notification carries the ₹ amount) and never in its alert contacts.
  Amounts are removed on the server (`listOrders`, `getOrder`), not only hidden on screen.
- **PlantOps support:** read (with amounts), and also the Rates and Recent changes pages; never writes.
- **Anyone else:** nothing (store keeper, complaint desk…).

| Action | Owner | Order desk | Plant staff | Support |
|---|---|---|---|---|
| read (order list, an order) | ✓ | ✓ | ✓ | ✓ |
| see amounts (rates, totals) | ✓ | ✓ | | ✓ |
| tick pending orders + copy as WhatsApp message | ✓ | ✓ | ✓ | |
| customer list | ✓ | ✓ | | ✓ |
| enter (new order, change a pending order) | ✓ | ✓ | | |
| customers (add, edit name / place, switch off / on) | ✓ | ✓ | | |
| deliver, cancel | ✓ | ✓ | | |
| undo delivered, rates, customer upload, export, pending summary, support log | ✓ | | | |
| view rates, Recent changes | ✓ | | | ✓ |

## Running it
- **Local:**
  1. `./scripts/setup-module-db.sh order_capture order_app ORDER 3005` once
  2. then `pnpm db:migrate && pnpm db:seed`
  3. `pnpm --filter @plantops/order-capture dev` (or `dev:lan` for phones on the same Wi-Fi)
- **Tests:** `pnpm --filter @plantops/order-capture test` (real Postgres test database).
- **Hosted (Railway):**
  - service `order-capture`, `apps/order-capture/Dockerfile`, port 3005, health `/health`, address
    `orders.bluemins.life`
  - **no volume** (no files); variables from `add-railway-module.sh`'s paste file plus **`CRON_SECRET`** (no
    `BACKUP_*`, no Brevo)
  - added to a running copy with `docs/DEPLOY.md` "Adding a module": platform migration first, then
    `add-railway-module.sh`
- **Jobs:** daily (GitHub `daily.yml`, 07:00 IST): `POST /api/cron/daily` resends notifications waiting in the outbox.
  By hand: `pnpm --filter @plantops/order-capture daily`. Skipped until the GitHub variable `ORDER_URL` exists. The
  nightly dump covers the `order_capture` schema (nothing else to back up).
- **Switching it on for a plant:**
  1. super_admin → plan → tick Order Capture
  2. owner → give staff "Order desk" and tick "Gets Order Capture alerts" for whoever should hear about new orders

## Phase log

### 2026-10-13 — Phase 1: platform registration (done, not committed)
- **Platform migration** `0014_order_capture.sql`: module `order_capture` and role `order_desk` ("Order desk").
  Nothing else changed in the database.
- **`packages/types`:**
  - `MODULE_IDS` (after `complaint_box`), `ROLE_IDS`, `ROLE_MODULE` (`order_desk` → `order_capture`)
  - **`PLANT_STAFF_EXCLUDED` = Lab Records + Order Capture**
  - three `NOTIFICATION_KINDS`: `new`; `delivered` and `cancelled` bell only; none urgent
- **Platform screens:**
  - `ROLE_LABELS`
  - tile 🧾 "Take an order" with the owner's "⚙ Rates" link (`/rates`)
  - the "Gets Order Capture alerts" tick box comes from `roleWorksIn` with no extra code
- **dev-module:** never serves Order Capture (`REAL_APPS`).
- **Tests:** platform 272 (+8, `test/order-capture.test.ts` + launcher), auth 49 (+8). Covered:
  - plant staff refused Order Capture (but not Floor Stock)
  - an Order-desk-only user lands straight in it
  - the tick box is refused for plant staff
  - the settings list has the three new kinds
- **Checked on `pnpm dev`** (plant 002, Sujata through a temporary session; all put back afterwards):
  - the tile showed locked "Not enabled", then "Temporarily unavailable" while switched on with no app yet
  - the "Order desk" role button is on the user form
  - ticking a non-Order-desk user → 400

### 2026-10-13 — Phase 2: module foundation (done, not committed)
- **Database** (`db/migrations/0001_order_capture.sql`, applied to dev): 8 tables:
  - `product_rates`, `customers`, `orders`, `order_lines`, `order_events`
  - `support_views`, `audit_log`, `notification_outbox`
  - all with `tenant_id` + FORCE RLS, and **no DELETE anywhere**
  - only these columns may be updated:
    - rates: unit, default rate, who / when
    - customers: name, place, on / off
    - orders: status, version, total, delivery fields
    - outbox: the retry columns
  - `outbox_tenants()` (plant ids only)
- **Database checks:**
  - phone `^[6-9][0-9]{9}$`, one customer per phone per plant
  - `ref_no` and `request_key` unique per plant
  - quantity 1–100,000 whole; rate ≥ 0 with 2 decimals; `line_total = quantity × rate`
  - each product once per version
  - "delivered" ⇔ who / when filled in; note / invoice no. only on a delivered order
  - cancel / undo need a 3-character reason; invoice no. only on a delivery event
- **Two additions to the plan's wording (approved with the migration):**
  - `order_lines.line_no` keeps the typed order of lines
  - `order_events.invoice_no` keeps a delivery's note and invoice no. in the history after "Undo delivered"
- **App** (copied from Complaint Box's foundation):
  - kit routes (callback, support, logout, support-exit, plant logo), the proxy, `/health`
  - the empty tile answer `{ badges: [] }`
  - header with plant logo / colour, 🔔 and Account; role label Owner / Order desk / Read-only
  - home page with a "being set up" card
  - support page views logged in `support_views`
  - outbox store and daily job: Phase 6
- **Tests: 62.**
  - FORCE RLS guard over exactly the 8 tables, and tenant isolation per table (incl. foreign keys across plants)
  - **59 refused statements** listed one by one, plus the allowed updates and every database check
  - the access table for owner / Order desk / plant staff / store keeper / support
  - login: plant staff, store keeper and complaint desk refused; plant staff + Order desk allowed
  - support read-only and logged; tile ticket; health
  - all other suites unchanged and passing; `next build` passes
- **Checked on `pnpm dev`** (plant 002, Wi-Fi address; test data removed afterwards):
  - Order Capture switched on temporarily; a temporary Order desk user was added by Sujata
  - that user logged in with the temporary PIN, set their own PIN, and the launcher sent them **straight to Order
    Capture**
  - the one-time code gave a module session; the same code again → 403
  - the home page at phone width showed the plant logo, 🔔, initials and the card
  - Sujata's tile was "Open"
  - without a session: the page went to the PlantOps login, the API answered 401; health 200
- **Left on dev on purpose:** the module's registration (`MODULE_URL_ORDER_CAPTURE` = the Wi-Fi address, secret
  hash) and the empty schema.

### 2026-10-13 — Phase 3: rates and customers (done, not committed)
No database change: the Phase 2 tables, grants and checks covered everything.
- **Shared phone rule:** `normalisePhone` / `telLink` / `phoneDisplay` moved from Complaint Box into
  `packages/module-kit/src/phone.ts` (export `./phone`). Complaint Box re-exports them; its 190 tests ran unchanged.
- **Rates** (`/rates`; owner edits, support reads, Order desk sent home):
  - lists the plant's **active** PlantOps products
  - unit default **"box"** when a pack holds several bottles, else the pack type (`defaultUnit` in `src/lib/rates.ts`)
  - rate blank = "not set" (typed on each order)
  - one Save writes only the changed rows, plus one `rates.set` audit row
  - no products (or platform unreachable) → a plain message, no form
- **Customers** (`/customers`; owner and Order desk; support reads):
  - search by name, place or phone digits; switched-off ones on request; at most 200 shown
  - add: an existing number (any spelling) answers 409 "This number is already …" and offers **Switch on** if it
    was off; two adds at the same moment → one customer
  - edit name / place; **the phone can't be changed** ("a different number is a new customer")
  - switch off / on; audited `customer.add` / `customer.update`
- **Upload** (`/customers/upload`, owner only):
  - **the file:** read in the browser (`src/lib/csv-read.ts`: quotes, CRLF, BOM, `;` files); only the three chosen
    columns are sent as JSON; the file is never stored; ≤ 2 MB / 5,000 rows
  - **template download**; columns guessed from the header and changeable
  - **the duplicates table:** `classifyUpload` in `src/lib/upload.ts`, pure and tested case by case
  - **preview saves nothing.** Confirm re-runs it in one transaction under a per-plant lock and saves only if the
    preview's fingerprint still matches (else 409); one `customers.upload` audit row with every update's old → new
  - **rejected rows:** downloadable as the file had them plus a Reason column (formulas neutralised)
- **Decisions made while building:**
  - "same" name / place = equal after trimming and joining spaces, **letter case counts** (so fixing capitals by
    upload is an Update); the possible-duplicate warning ignores case
  - phone numbers are shown in full in the preview (the mock-up hid digits only as sample data)
  - several problems in one row are listed together
- **Recent changes** (`/changes`, owner + support): rates, customer adds / edits / on-off, uploads, in words.
- **Home page:** link rows to Rates / Customers / Recent changes by role, until the order list arrives in Phase 5.
- **Tests: 132 Order Capture** (+70: rates 16, customers 17, upload 30, changes 7); module-kit 52 (+19 phone).
  Every other suite unchanged and passing; typecheck and both builds pass.
- **Checked on `pnpm dev`** (plant 002 through real platform logins as Sujata and a temporary Order desk user; all
  test data, the user and the plan change removed afterwards):
  - pages: owner 200 on all; Order desk sent away from Rates / Upload / Recent changes; rates saved (Order desk
    403)
  - customer added, same number → 409, place edited, phone change → 400 with the plain message, off / on
  - a 10-row sample file covering every duplicates case uploaded in headless Chrome at 390 px: preview 3 new /
    1 unchanged / 1 update / 4 rejected / possible duplicate / repeat ignored; saved; **the same file again: 0 new,
    0 updated**
  - Recent changes listed everything
  - after the screenshots, each customer's buttons were moved under the details (they jumped between beside and
    below depending on the name length)

### 2026-10-13 — Phase 4: entering an order (done, not committed)
No database change.
- **`/new`** (owner and Order desk), as the mock-ups:
  - **Customer:** phone → lookup as soon as it is a valid mobile. Found: green card "bijepur · last order 13 Oct".
    Switched off: amber card with **Switch back on**. New: name + place, saved with the order.
  - **Lines:** "+ Add product" offers only products not yet in the order. Each line has a whole quantity and a rate
    pre-filled from **this customer's last non-cancelled order** (that order's current lines), else the default
    rate, else empty. The hint says "Their last rate: ₹90" / "Default rate" / "No default rate: type the rate".
    A rate the person typed is never overwritten by a late lookup.
  - **Footer:** "Total · 4 box" (quantities per unit) and ₹ total, then Save.
  - **Saved screen:** "Order O-0001 saved", the lines and total, **New order** (a new request key) / **Home**. The
    mock-up's "owner notified" line waits for Phase 6.
  - **Products can't be loaded** → a plain message and Try again, no form.
  - **A dropped connection:** "Not saved: no connection… press Save again" (same key, so no double order).
- **`POST /api/orders`:** JSON; unknown fields dropped (plant, user, reference, status and totals come from the
  session / server).
  - **Validation:** lines 1–50, each product once, quantity 1–100,000 whole, rate ≤ 2 decimals.
  - **Products:** active PlantOps products only; none loadable → 503, nothing saved.
  - **One transaction under a per-plant advisory lock:**
    - a repeated request key → the same order (200, `created: false`)
    - an existing customer is used as is (typed name / place ignored); switched off → 409
    - a new customer is created and audited `customer.add` (`via` O-0001)
    - the reference is `max + 1`, shown as O-0001 (`src/lib/ref.ts`)
    - copies of the customer and of each product's name and unit are stored
    - lines version 1 and the `created` event
  - **Totals:** worked out in whole paise as BigInt (`src/lib/money.ts`).
- **`GET /api/customers/lookup?phone=`:** the customer (on or off), the last order date and the last rates.
- **Home page:** "+ New order" for owner and Order desk.
- **Tests: 168 Order Capture** (+36: orders 28, money 8). Covered:
  - field rules; inactive / unknown product; platform down → 503
  - browser-sent `tenant_id` / `entered_by` / `ref_no` / `status` / `total` ignored
  - 2 and 10 parallel saves get different references; another plant also starts at O-0001
  - the same key twice (and at the same moment) → one order
  - a failing order leaves no new customer
  - last-rate cases (none, default, last order beats default, cancelled skipped, other customer ignored, latest lines
    version)
  - exact totals (3 × 33.33, 510, the largest line)
  - copies kept after customer / rate edits; who may; isolation
- **Checked on `pnpm dev`** (plant 002; temporary Order desk user + Sujata; test data, user and plan change removed
  afterwards):
  - Rates 500ml ₹90 / 1L ₹140, then the owner's sample order typed into the form in headless Chrome at 390 px:
    98765 43210 → new customer Sri ram hotel, bijepur; 500ml 1 box, 1L 3 box (default rates filled in) → "Total ·
    4 box ₹510" → **Order O-0001 saved**
  - "New order" for 098765 43210: customer found, "last order 13 Oct", rate pre-filled "Their last rate: ₹90"
  - the same request key sent twice → one order (O-0002, 201 then 200)
  - plant 002's dev product name has a double space ("SampleAqua  500ml"): shown as the platform gives it

### 2026-10-13 — Phase 5: order list and handling (done, not committed)
No database change.
- **Home = the order list** (mock-up "Pending orders"):
  - "+ New order"; tabs **Pending · N** / Delivered / Cancelled
  - search: "O-0042" / "42" = reference, phone digits (a full "+91 …" number is normalised), else name or place
  - From / To dates (India date entered)
  - Pending oldest first; Delivered / Cancelled newest first by when that happened
  - cards: customer, age badge or "Delivered 13 Oct", "place · O-0042 · by …", products, total
  - **Amber from 2 full days** (the mock-up shows "2 days" amber; `AMBER_AFTER_DAYS` in `src/lib/history.ts`)
  - at most 200 cards; links to Rates / Customers / Recent changes; the owner's **Download all orders (CSV)**
- **`/o/<id>`** (mock-up "Order O-0042"):
  - status badge; customer with "Call +91 …" (`tel:`; plain for support)
  - current lines and total; "Entered by … · version N"; delivered by / when / note / Zoho invoice
  - **History** in words (created, changed with the diff "1ltr: 3 box → 4 box · total ₹510 → ₹650", delivered,
    undone, cancelled)
  - **All versions (N)**
  - only the buttons this person may use: Mark delivered / Change order / Cancel order (pending; owner + Order
    desk), Undo delivered (delivered; owner). Cancelled: "Cancelled is final".
- **Panels:** Mark delivered (optional note ≤ 300 and Zoho invoice no. ≤ 40; Delivered / Not yet); Cancel and Undo
  (reason ≥ 3).
- **`/o/<id>/change`:** the New order line editor, now shared (`src/app/lines-editor.tsx`).
  - Starts from the current lines; hints "Was 3 box × ₹140".
  - A product switched off in PlantOps since can stay (with its saved name / unit) but can't be added.
- **Server** (`src/server/handling.ts`): every action sends `expected: { status, version }`.
  - **One transaction:** `select … for update`. If it changed meanwhile → 409 "This order was just changed by
    <name>. Please reload." A wrong state → 409 "O-0001 is cancelled / already delivered, so this can't be done."
  - **Change:** version N+1 (identical lines = nothing written), order version / total, event `changed`.
  - **Deliver:** sets the delivered fields; event `delivered` carries the note and invoice no.
  - **Cancel:** final. **Undo** (owner): back to Pending, delivered fields cleared, still in the event.
- **CSV** (`GET /api/export`, owner):
  - one row per line of each order's current version, 19 columns, `orders-YYYY-MM-DD.csv`
  - formulas neutralised
  - audited `export.csv` ("Exported the orders (CSV, 3 orders, 6 lines)")
- **Bug found by the tests and fixed:** a search for a full number with +91 / 0 found nothing (the digits kept the
  91). Now normalised, in the order list and the customer search.
- **Tests: 204 Order Capture** (+36: history 15, handling 14, list / export 7).
  - **Rules:** state rules per role; reasons (form and database); no change after delivery or cancel; undo owner-only
    and back to Pending.
  - **409s:** on stale changes (two sessions, and two at the same moment: one wins); nothing written by the refused
    one.
  - **Versions:** 1–3 kept with exact totals (3 × 33.33); identical lines write nothing; pre-fill reads the new
    version; a switched-off product kept.
  - **List and CSV:** tabs and order; the 2-day boundary (1 d 23 h 59 min / exactly 2 days); search and dates;
    isolation and 404 across plants; CSV owner-only and neutralised.
- **Checked on `pnpm dev`** (plant 002; Sujata + a temporary Order desk user; all test data, the user and the plan
  change removed afterwards):
  - three orders (one back-dated 3 days → amber "3 days" first in Pending)
  - in headless Chrome at 390 px: order page → Change 1L 3 → 4 box (footer "Total · 5 box (was ₹510) ₹650") → Mark
    delivered with note + INV-000123 → Sujata's Undo ("marked by mistake") → history shows all four → Cancel
    O-0003 → Cancelled tab
  - a stale cancel → 409 "just changed by Sujata"; the CSV had 6 rows (O-0002 at version 2), the Order desk got 403,
    and the export was in Recent changes

### 2026-10-13 — Phase 6: notifications, tile and support view (done, not committed)
No database change (outbox, support views and the three kinds existed since Phases 1–2).
- **Notifications** (`src/server/notify.ts`), exactly the plan's table:
  - Sent with `kit.notify` inside `after()`, once the answer has gone; never the customer's phone; titles ≤ 80 and
    bodies ≤ 300 with "…".
  - `order_capture.new` (push): "New order O-0001: ₹510" / "Sri ram hotel, bijepur. <products> (by Atharv)",
    `new:<id>`, the person who saved it excluded. A repeated request key sends nothing.
  - `order_capture.delivered` (bell): only whoever entered it (`also_user_ids` + `only_listed`), "O-0001
    delivered" / "Sri ram hotel · <note>", `delivered:<id>:<event id>`. Nothing when they delivered it themselves.
  - `order_capture.cancelled` (bell): owners + ticked + whoever entered it, minus whoever cancelled; the reason as
    the body; `cancelled:<id>`.
  - **Change and Undo delivered send nothing** (not in the table).
  - `deliverOrder` / `cancelOrder` now also return the event details the texts need.
- **Saved screen:** "The owner has been notified." when the person isn't an owner (owners are left out of their own
  events).
- **Outbox:** `src/server/outbox.ts` (copied from Complaint Box), passed to `createModule`. Kept on unreachable /
  5xx, not on 4xx.
  - `POST /api/cron/daily` (`x-cron-secret` = `CRON_SECRET`; none set → 503, wrong → 401) runs `kit.retryOutbox()`
    only.
  - `pnpm --filter @plantops/order-capture daily` runs it by hand.
  - `daily.yml` has an **Order Capture** step, skipped until the GitHub variable **`ORDER_URL`** exists.
- **Tile** (`src/server/summary.ts`): "N pending" (info) or "No pending orders" (ok), "N pending over 2 days" (warn,
  the amber rule), "N new today" (ok, any status, India date).
- **Support view:**
  - `src/server/support.ts`: paths in words (order list, order O-0001, the rates, the customer list, Recent changes)
  - the owner's **`/support-access`** page, linked from home
  - platform `SUPPORT_READY` + `order_capture` → super_admin's "Open Order Capture (read-only)"
- **Tests: 224 Order Capture** (+20: notify 11, summary 4, support 4, plus the Phase 2 tile test updated).
  - every event's exact input; nothing for own delivery / change / undo / a repeated key
  - outbox kept on 503 and resent by the daily job; not kept on 403
  - cron 503 / 401 / 200
  - badges: empty, mixed, the 2-day boundary, isolation
  - support: 11 write routes refused at the proxy and 11 server functions refused; page views in words; owner-only
    log
  - every other suite unchanged and passing; typecheck, both builds pass
  - The Phase 4 order tests needed a stand-in for `after()` (Next allows it only inside a real request).
- **Checked on `pnpm dev`** (plant 002, real platform + Order Capture; all test data, notifications, the user,
  sessions and the plan change removed afterwards):
  - tile "No pending orders" → a temporary Order desk user saved the sample order → **Sujata's bell: "New order
    O-0001: ₹510"** (push, unread 1) → tile "1 pending · 1 new today"
  - Sujata delivered it → the desk user got the bell "O-0001 delivered · handed to the manager"
  - daily job: wrong secret 401, right secret 200
  - a real super_admin support handoff: list / order / rates read (no `tel:` links, no buttons), three writes 403;
    Sujata's Support access page listed all three views; the super_admin dashboard showed "Open Order Capture
    (read-only)"

### 2026-10-13 — Phase 7: release and deploy (live, v0.13.0)
- **Release v0.13.0** (`77a39ce`, tag `v0.13.0`):
  - Dockerfile (port 3005, no storage)
  - CLAUDE.md status note, repo layout, addresses, module-kit and N5+ lists
  - HANDBOOK / DEPLOY additions
  - `setup-railway-db.sh` / `.sql` include Order Capture for new copies
  - CHANGELOG
- **Live on the shared copy at `https://orders.bluemins.life`** (record: `docs/deployments/shared.md`):
  - platform migration `0014`
  - `add-railway-module.sh shared order_capture order_app ORDER 3005 orders.bluemins.life` + `railway-migrate.sh
    shared`
  - Railway service `order-capture` (no volume, `CRON_SECRET`)
  - DNS `orders` CNAME + TXT at WordPress.com; GitHub `ORDER_URL`
  - `v0.13.0:production`
  - the first build failed as expected before the push (v0.12.0 had no Order Capture Dockerfile)
- **Live checks passed:**
  - `/health` database OK; login redirect
  - 401s for the APIs, the tile without the platform's ticket and the cron without its secret; 403 for fake codes
  - the platform recognises the module; the other services healthy
- **After the live migration:** `order_capture` added to `backup.yml`'s "every schema has data" list.
- **The module secret** was printed once in a Claude Code session log while checking the paste file; rotating it
  (super_admin → Modules → new client secret, then Railway variable) is optional.
- **To do:**
  - Daily jobs run (Order Capture step green)
  - the first nightly backup with `order_capture`
  - the owner's phone checklist for plant 001

### 2026-10-13 — Order note + owner's pending summary (v0.13.1)
Asked by the owner after v0.13.0 went live.
- **Order note** (migration `0002_order_note.sql`, approved by the owner): `orders.order_note`, optional, 1–300
  characters after trimming, null when blank. **Fixed once saved** (owner's choice): `order_app` has no UPDATE on
  it, as the column grants in `0001` list the updatable columns one by one; an append-only test checks the refusal.
  Spaces are tidied and line breaks kept (`src/lib/note.ts`). Shown on the order page, saved screen, pending list,
  owner CSV ("Order note" after Place) and, by the owner's choice, at the end of the "New order" notification body.
- **Pending summary** (owner only, new access action `pending_summary`; Order desk and support refused):
  `pendingSummary()` in `src/server/list.ts`. It adds up all pending orders (not the search), using each order's
  current lines version. Per product and unit it gives quantity, number of orders, lowest / highest rate and amount,
  biggest amount first. The product name comes from its newest order. No schema change.
- **Tests:** 232 Order Capture (+8). Typecheck and build pass.
- **Not yet checked on screen** (browser, phone width).

### 2026-10-14 — Plant staff view-only + "Copy as WhatsApp message" (v0.14.0)
Asked by the owner 2026-10-14; mock-ups approved the same day.
- **Plant staff view-only:** new `viewer` row in the access table (above). `canAccessModule` lets plant staff open
  Order Capture; the launcher shows them its tile (so a plant-staff-only user with Floor Stock now sees the tile screen
  instead of landing in Floor Stock). Header says "View only". The order page shows quantities only, plus "You can
  view orders. Order desk or the owner marks them delivered."
- **Amounts:** rule `see_amounts` (owner, Order desk, support). `LineView.rate / total` and order totals are `null`
  when hidden; history texts leave the rupee parts out (`versionDiff`, `eventText`); a rate-only change reads
  "version N".
- **Phone on the list cards** (tap to call), for everyone who reads.
- **Copy as WhatsApp message** (`src/lib/whatsapp.ts`, `src/app/order-cards.tsx`): Pending tab only; a tick box per
  card, Select all / Clear (the orders shown, so search and dates apply), a sticky bar "Copy N orders as WhatsApp
  message". Message: "*Delivery – 14 Oct – N orders*", then per order ref + customer, phone + place, product lines,
  note, and Amount + a grand total only for people who see amounts. **Changed 2026-10-17 (owner):** each product
  line shows its rate ("- Bluemins 1L (1 L × 12): 20 box × ₹120"); each order keeps its note and Amount; the grand
  Total at the end is gone; plant staff still get no rates or amounts. Ticks are not saved. Clipboard refused (plain
  http on a phone) → the text is shown to select.
- No database change; the SSO token is unchanged.
- **Tests:** Order Capture 243 (+11): access table with the plant-staff column, no amounts in the list / order /
  history, the WhatsApp text with and without amounts, the IST date.

### 2026-10-14 — WhatsApp thank-you to the customer on "Delivered" (v0.15.0)
Asked by the owner 2026-10-14: fully automatic through the owner's existing **Twilio** WhatsApp account, a tick box
ticked by default, feedback = "reply to this message" (replies reach the Twilio number, outside PlantOps), one
Twilio account with a sender per plant.
- **Config (environment, `order-capture` only):** `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`,
  `TWILIO_WHATSAPP_SENDERS` = `{"<plant id>": {"from": "whatsapp:+91…" | "MG…", "content_sid": "HX…"}}`. The
  template's `{{1}}` gets the customer's name. A plant not listed, missing or broken settings = no tick box (broken
  JSON is logged, never thrown). `TWILIO_API_URL` only for tests.
- **Migration `0003_customer_messages.sql`** (approved by the owner): `customer_messages` with `tenant_id` + FORCE
  RLS, FK to the order, **unique per order + kind** (one thank-you per order ever), `sent` ⇔ `sent_at`, Indian mobile
  check. `order_app`: SELECT / INSERT, UPDATE only on status / provider_sid / error / attempts / sent_at; no DELETE.
  `message_tenants()` (plant ids only) for the daily job.
- **Flow** (`src/server/thanks.ts`): `deliverOrder` writes the `pending` row in the delivery's transaction
  (`send_thanks: true`; 400 if the plant has no sender, 403 first for people who can't deliver); the deliver route
  sends it in `after()`. Each row is locked while sent (`for update skip locked`), so the route and the daily job
  never send it twice. Twilio 4xx → `failed` with Twilio's reason (not retried); 5xx / 429 / unreachable → stays
  `pending`; `runDaily` retries; `failed` after 3 tries or 24 h. Sender removed meanwhile → `failed`.
- **Screens:** the tick box in the deliver panel (with the customer's name and number); "This order already had its
  WhatsApp thank-you" instead when it had one; a History line (`thanksText` in `src/lib/history.ts`) for everyone
  who reads the order.
- **Tests:** Order Capture 258 (+15): fake Twilio (form fields, Basic auth, Messaging Service), unticked, no sender,
  broken settings, once per order, roles, 400 / 500 / unreachable / 24 h / sender removed, two senders at once,
  daily retry, database checks; guard tests include the new table.
- **Not yet checked:** on screen (dev servers were down), and a real message through Twilio.

### 2026-10-14 — Notes after an order is saved
Asked by the owner 2026-10-14: the note typed with the order stays fixed; more notes can be added later.
- **Who / when (owner's choice):** owner and Order desk (`add_note` in the access table), on an order in **any**
  status (pending, delivered, cancelled). Plant staff and support read them, never add.
- **Migration `0004_order_notes.sql`** (approved by the owner): `order_events.kind` also allows `'note'`, and a note
  event needs text. Append-only like every event: no UPDATE / DELETE for `order_app`.
- **Flow:** `POST /api/orders/<id>/notes` `{ text }` → `addNote` (`src/server/handling.ts`): cleaned like the first
  note (≤ 300), one `note` event at the current version. Status / version don't move, so no 409; the 409 message of
  a later stale action names the last real change, never a note's author.
- **Screens:** "+ Add a note" on the order page; the amber Note box lists the first note and every added note with
  who / when; History shows "Note by …". New order form: "More notes can be added to the order later."
- **Notification:** `order_capture.note` "Note added to an order", bell only, owners + ticked people, not the author.
- **Tests:** Order Capture 262 (+4).

### 2026-10-19 — Customer search by name on New order (v0.26.2)
Asked by the owner 2026-10-19: the New order box searched by phone only.
- **One box, "Customer name or phone":** a full mobile number goes to `lookupCustomer` as before; anything else (≥ 2
  characters, 250 ms after typing stops) goes to `GET /api/customers/search?q=` → `searchForOrder`
  (`src/server/orders.ts`): `enter` access (owner, Order desk), `listCustomers` with switched-off customers, at most 8
  + `more`. Tapping a match fills in its phone, which then runs the usual lookup.
- No match for a typed name → the name is kept and filled into the new customer's Name box once the number is typed.
- No schema or permission change. **Tests:** Order Capture 267 (+3).
- **Not yet checked:** on screen.
