# Order Capture Module — Phase Plan and Build Prompts

**Status:** Design and phase plan approved by the owner on 2026-10-12 ("I am ok with the plan", including the CSV
upload with the duplicates table, recipients via "Gets Order Capture alerts", bell-only delivered / cancelled,
cancelled is final, whole quantities 1–100,000 with each product once per order, default unit "box"). **Built (v0.13.0, 2026-10-13); notes per phase in `apps/order-capture/NOTES.md`.** Planned to be built **after Complaint Box is deployed
and tried, before Phase 6 (Preventive Management)** (owner, 2026-10-12). Schema, permission and platform changes
listed here are agreed in principle; each migration is still shown to the owner before it runs (CLAUDE.md working
rules).

## Purpose

Staff and marketing staff take orders from customers (hotels, shops, homes) and send them to the plant as a WhatsApp
message. Order Capture replaces that message: staff enter the order on their phone inside PlantOps, and the owner and
Order desk see the pending orders at any time and mark them delivered. Billing stays in the plant's own tool (Zoho
Invoice for plant 001).

**Mock-ups** (9 phone screens, 2026-10-12): https://claude.ai/artifact/G18XDFf4ffwNzwd3PJfPbb (private to the
owner; screens follow them once the owner approves them).

**Today's WhatsApp message (sample from the owner):**
```text
Sri ram hotel
bijepur
<customer mobile>
500ml = 1 box / 90
1ltr = 3 box / 140
```
= customer name, place, phone; then per line: product = quantity in boxes / rate per box. The total (not in the
message) = 1 × 90 + 3 × 140 = ₹510.

## Names used in this plan

| Thing | Value |
|---|---|
| Module id | `order_capture` (label "Order Capture") |
| New role | `order_desk` (label "Order desk") |
| App folder / local port | `apps/order-capture` on `:3005` |
| Database schema / login | `order_capture` / `order_app` |
| `.env` prefix for the setup scripts | `ORDER` |
| Live address | `orders.bluemins.life` |
| Order reference | `O-0001`, `O-0002`, … per plant |
| Plan limit | none in v1 (no files) |

## Agreed design (owner, 2026-10-12)

### Who uses it
| Person | Can do |
|---|---|
| **Owner** (`tenant_admin`) | Everything below, plus: set product units and default rates, upload the customer list, undo "Delivered", CSV export, Recent changes |
| **Order desk** (new role) | Enter orders, see **all** the plant's orders and customers, add / edit customers, change an order before delivery, mark delivered, cancel |
| **Plant staff** | **Nothing**: Order Capture is added to `PLANT_STAFF_EXCLUDED`. A plant staff worker who takes orders is also given Order desk |
| **PlantOps support** (super_admin) | Read-only view; every page view logged on the owner's "Support access" page |
| Anyone else | Nothing. Checked on the server on every route and page, never by tile hiding only |

- `order_desk` is tied to `order_capture` in `ROLE_MODULE`. A user whose only working module is Order Capture (e.g.
  a marketing staff member) skips the launcher and lands straight in the app.
- No public order link for customers in v1.

### Minimal data at the first level (owner, 2026-10-12)
- **Customer:** name, phone, place. Nothing else.
- **Order:** customer + lines of **product, quantity, rate**. The total is worked out.
- Optional, never required: delivery note and Zoho invoice no. when marking delivered.

### Products and rates
- **Products = the plant's finished goods:** the plant's active **PlantOps products** (Business details → Products,
  `tenant_skus`), the same list Floor Stock's finished goods link to (`sku_id`). Read through the platform
  (`kit.products`, cached for a minute). No separate item list and no call to Floor Stock.
  - `kit.products` also returns inactive products: Order Capture keeps only `status === "active"` for new orders and
    rates (old orders keep their copies).
  - Floor Stock is **not** read: a product added, renamed or switched off in Business details → Products reaches
    Order Capture within a minute, whatever Floor Stock's items say. What matters is that every product the plant
    sells exists there with the right `units_per_pack` / pack type.
- **Owner sets per product:** a **unit** label (default "box" when the product holds more than one unit, else the
  pack type, e.g. "jar") and a **default rate per unit** (₹, up to 2 decimals). A product without a default rate can
  still be ordered (the rate is typed).
- **Rates differ per customer:** the rate box is pre-filled with **this customer's last rate for that product** (from
  their latest non-cancelled order), else the default rate. Staff can change it. No reason needed; the history
  records every change. Not stored separately: worked out from past orders.
- If the platform can't be reached, the product list is empty: the entry screen says "Products can't be loaded right
  now, try again" and nothing is saved with an unchecked product.

### Customers
| Field | Rule |
|---|---|
| Name | Required, 2–100 characters (a person or a business, e.g. "Sri ram hotel") |
| Phone | Required. Indian mobile, the same rule as Complaint Box: spaces / dashes removed, a leading `+91`, `91` (12 digits) or `0` dropped; the result must be 10 digits starting 6–9. **One customer per phone per plant** |
| Place | Required, 2–200 characters |

- Owner and Order desk add customers (also inline while entering an order) and edit name and place. The phone is
  fixed; a different number is a different customer.
- Customers are switched off (no longer found by the lookup), never deleted.
- **Upload (owner):** a CSV file with name, phone and place columns (Google Sheets, Excel and Zoho all save / export
  CSV). The screen asks which column is which, then shows a **preview**. Nothing is saved until the owner confirms.
  Audited.
- **Template:** a "Download template" link on the upload screen gives `customers-template.csv`:
  ```text
  Name,Phone,Place
  Sri ram hotel,98765 43210,bijepur
  Maa Tarini Store,+91 91234 56780,Bargarh
  ```
  Headers may differ (the column choice handles that); extra columns are ignored; any phone format works (`+91`,
  `0`, spaces). Names in Hindi / Odia need "CSV UTF-8" when saving from Excel. In Excel, format the phone column as
  **Text** first: Excel can save long numbers as `9.18E+11`, which the preview would reject.
- **Duplicates (owner, 2026-10-12: "duplicity will be handled"):** the phone number (after normalising) is the
  customer's identity, so `+91 96929 05402`, `096929 05402` and `9692905402` are the same customer.
  | Case | Preview shows | On confirm |
  |---|---|---|
  | Phone not in the list yet | **New** | Added |
  | Phone already in the list, same name and place | **Unchanged** | Nothing (uploading the same file twice changes nothing) |
  | Phone already in the list, different name or place | **Update**: old → new side by side | Name / place updated (audited); old orders keep their copies |
  | Phone already in the list but switched off | **Update** (switched back on) | Updated and switched on |
  | Same phone twice in the file, identical rows | **New / Unchanged** once, "repeated row ignored" | Counted once |
  | Same phone twice in the file, different name or place | **Rejected**, both rows listed with their line numbers | Neither saved; fix the file or add by hand |
  | Bad phone, missing name / place, too long | **Rejected** with the reason and line number | Not saved |
  | Same name and place as another customer but a different phone | **New**, with a "possible duplicate of …" warning | Added (a customer may have two numbers; the owner decides) |
  - The owner can download the rejected rows as a CSV to fix and upload again.
  - The database enforces one customer per phone per plant, so a duplicate can never get in, even with two uploads
    or an upload and an order saved at the same moment.
- **Adding by hand / while entering an order:** typing a phone that already exists shows that customer instead of
  creating a second one (also for switched-off customers, which the owner or Order desk can switch back on).

### Entering an order (Order desk / owner, on a phone)
1. Type the customer's phone → name and place appear. Not found → type name and place; the customer is created with
   the order.
2. Lines: pick a product, type the **quantity** (whole number, 1–100,000, in the product's unit) and the **rate**
   (pre-filled as above). Each product at most once per order.
3. The total is shown → **Save** → "Order O-0042 saved".

- The server takes the plant, who entered it and when from the session; ids sent by the browser are never used.
- The reference `O-0001…` is allocated per plant inside the saving transaction under a per-plant
  `pg_advisory_xact_lock`, as Complaint Box does (safe when two phones save at once).
- **Double save blocked:** the screen sends a one-time request key with each save; a repeat with the same key returns
  the same order instead of a new one. (Generate the key without `crypto.randomUUID()`, which fails on plain-`http`
  phone testing, as found in Complaint Box.)
- The order keeps a **copy** of the customer's name, phone and place and of each product's name, unit and rate, so
  later edits to customers, products or rates don't change it. The phone copy also allows a later feedback message.

### Order states
| Status | Set by | Rule |
|---|---|---|
| **Pending** | — | Every new order |
| **Delivered** | Owner, Order desk | From Pending, only when the **whole** order is delivered. Records who and when. Optional delivery note (≤ 300 chars, e.g. "80 delivered, 20 next trip") and Zoho invoice no. (≤ 40 chars) |
| **Cancelled** | Owner, Order desk | From Pending; **reason required** (≥ 3 characters). Final: a cancelled order is re-entered if needed |
| Undo Delivered → **Pending** | **Owner only** | **Reason required** |

- **Changing an order:** while Pending, owner and Order desk may change lines (products, quantities, rates). Each
  change saves a **new version of the lines**; old versions stay (who, when, what changed). After delivery nothing
  changes until the owner undoes Delivered.
- **Two people at once:** every change states the order version / status it expects; if someone else changed it
  first, the answer is 409 "This order was just changed by …, please reload".
- **Kept for good.** Orders are never deleted. Owner **CSV export** (one row per order line, with order status,
  customer and who / when; formulas neutralised; audited).

### Order list (home page)
- **Pending** tab (default): oldest first; each row shows reference, customer, place, products with quantities,
  total, who entered it and its age; **amber after 2 days**. Tap to open; Mark delivered from the order page.
- **Delivered** and **Cancelled** tabs: newest first.
- Search by reference, customer name, phone digits or place; date range filter.
- The order page has the details, the history (versions, delivered, undo, cancel) and only the buttons the user may
  use. The customer's phone is a `tel:+91<number>` link (plain text in the support view).

### Notifications (N5+, agreed)
All go through `kit.notify(tenantId, input)` **after** the answer. Nobody is notified about their own action
(`exclude_user_id`). "Owner + ticked" = the plant's owners + the people ticked "Gets Order Capture alerts" (N2); the
owner ticks the Order desk users who should hear about new orders. None is urgent; each person can mute or
downgrade any of them on `/notifications`.

| # | Kind (`NOTIFICATION_KINDS`) | Event | Who | Example title / body | Link | Dedupe key | Level |
|---|---|---|---|---|---|---|---|
| 1 | `order_capture.new` | Order saved | Owner + ticked | "New order O-0042: ₹510" / "Sri ram hotel, bijepur. 500ml 1 box, 1ltr 3 box (by Atharv)" | `/o/<id>` | `new:<id>` | Phone + bell |
| 2 | `order_capture.delivered` | Order marked delivered | **The person who entered it only** (`also_user_ids` + `only_listed`) | "O-0042 delivered" / "Sri ram hotel" | `/o/<id>` | `delivered:<id>:<event id>` | **Bell only** (`bellOnly`) |
| 3 | `order_capture.cancelled` | Order cancelled | Owner + ticked + the person who entered it (`also_user_ids`) | "O-0042 cancelled" / "Customer changed mind" | `/o/<id>` | `cancelled:<id>` | **Bell only** (`bellOnly`) |

Reliability: a notification that can't reach the platform (unreachable / 5xx) waits in the module's
`notification_outbox` and is resent by the daily job (`kit.retryOutbox()`). No customer phone numbers in
notifications. No MSG91, SMS, WhatsApp or email.

### Standard pieces (as in every PlantOps module)
- **Launcher tile** (`/api/plantops/summary`): "N pending" (info), "N pending over 2 days" (warn), "N new today"
  (ok). Max 3 badges. Owner setup link "⚙ Rates" → `/rates`.
- **Support view** (`/sso/support`): read-only (proxy + server guards), every page view logged on the owner's
  `/support-access` page.
- **Daily job** `POST /api/cron/daily` (`CRON_SECRET`): retry the outbox only (no scheduled notifications in v1).
- 🔔 link in the header (`NotificationsLink`), "Account" link to the launcher, plant colour and logo.
- No files, so no storage, volume or file backup; the nightly database dump covers the schema.
- English labels in v1.

### Not in version 1
- Public order link / QR for customers (if added: hidden-out name "R**** K., Cuttack" in the lookup, rates locked
  for the customer, per-device limits, replaceable link, orders arrive "not confirmed").
- Payments, dues, invoices, tax, discount: stay in Zoho Invoice.
- Zoho Invoice link (draft invoice from a delivered order; Zoho contacts as customers): only if retyping becomes a
  nuisance; optional per plant; needs per-plant Zoho authorisation, separate design.
- Customer feedback after delivery: first a free "Send feedback on WhatsApp" button (`wa.me` link with the message
  typed); automatic WhatsApp Cloud API only with Meta approval, cost and consent.
- Floor Stock and batch link: no automatic stock deduction (Floor Stock works out "Sold" from the count); later
  "Delivered by orders" next to "Sold" on the Floor Stock day page as a leakage check, and the held-batch rule
  designed once with Floor Stock's dispatch entries (needs module-to-module calls).
- Partial delivery, delivery dates, assigning orders to a driver.
- Reading `.xlsx` files directly (CSV covers Sheets, Excel and Zoho); second phone per customer; removing a
  customer's details on request.

## Database (agreed in principle; each migration shown to the owner before it runs)

**Platform** (one migration, `0014_order_capture.sql`, like `0013_complaint_box.sql`):
- add module `order_capture` to `platform.modules` and role `order_desk` to `platform.roles`
- code:
  - `packages/types`: `MODULE_IDS` (after `complaint_box`; the order is the tile order), `ROLE_IDS`, `ROLE_MODULE`,
    **`PLANT_STAFF_EXCLUDED` gets `order_capture`**, the three kinds in `NOTIFICATION_KINDS`
  - tile text, icon and the "⚙ Rates" setup link in `apps/platform/src/lib/modules.ts`
  - `ROLE_LABELS` in `apps/platform/src/lib/api.ts`
  - dev-module `LABELS` + `REAL_APPS`
- the SSO token is **unchanged**

**Module schema `order_capture`** (login `order_app`; every table has `tenant_id` + FORCE RLS; nothing has a DELETE
grant):

| Table | Holds | `order_app` may |
|---|---|---|
| `product_rates` | per product: `sku_id`, unit label, default rate, who / when | SELECT, INSERT, UPDATE (`unit`, `default_rate`, `updated_by`, `updated_at` only) |
| `customers` | name, phone typed + normalised (unique per plant), place, active, who added | SELECT, INSERT, UPDATE (`name`, `place`, `active`, `updated_at` only) |
| `orders` | `ref_no`, `customer_id` + name / phone / place copies, `status`, `version`, `total`, who entered + name, `created_at`, `status_changed_at`, delivered by / at, delivery note, invoice no., request key (unique per plant) | SELECT, INSERT, UPDATE (`status`, `version`, `total`, `status_changed_at`, delivered fields only) |
| `order_lines` | `order_id`, `version`, `sku_id`, product name + unit copies, quantity, rate, line total | SELECT, INSERT |
| `order_events` | history: `created`, `changed` (new version), `delivered`, `undelivered` (reason), `cancelled` (reason); who, when | SELECT, INSERT |
| `audit_log` | rate changes, customer adds / edits / uploads, CSV exports (Recent changes) | SELECT, INSERT |
| `support_views` | support page views | SELECT, INSERT |
| `notification_outbox` | notifications waiting to be resent | as in the other modules |

Plus `outbox_tenants()` (plant ids only). Database checks: text lengths, normalised phone `^[6-9][0-9]{9}$`,
quantity whole and 1–100,000, rate ≥ 0 with 2 decimals, `ref_no` unique per plant, status values `pending` /
`delivered` / `cancelled`, `cancelled` / `undelivered` events must have text.

## Phases

Finish and test each phase before the next. Phase 0 happens once in plan mode; phases 1–7 are the build. Each phase
ends with `pnpm test` for the touched apps, `typecheck`, and a short note in `apps/order-capture/NOTES.md`.

| Phase | What | Result |
|---|---|---|
| **0** | Placement and prerequisites | Complaint Box live and tried; plan re-checked against the code |
| **1** | Platform registration | Module + role + plant-staff exclusion + notification kinds exist; tile says "Temporarily unavailable" until the app is registered |
| **2** | Module foundation | App on module-kit, own schema and login, login / support / tile skeleton |
| **3** | Rates and customers | Owner sets units and default rates; customer list, add / edit, CSV upload with preview |
| **4** | Entering an order | Phone form: lookup, new customer inline, lines with last-rate pre-fill, total, save |
| **5** | Order list and handling | Pending / Delivered / Cancelled, search, order page, change, deliver, cancel, undo, CSV |
| **6** | Notifications, tile and support view | Three kinds, outbox + daily job, badges, support logging |
| **7** | Release and deploy | Docs, Dockerfile, Railway service, DNS, live checks, owner tries it on a phone |

### Phase 0 — Placement and prerequisites
- Complaint Box (v0.12.0) is deployed and the owner has tried it on a phone.
- The open Floor Stock items in `apps/floor-stock/NOTES.md` are done or explicitly deferred.
- Every product plant 001 sells exists as a PlantOps product (Business details → Products) with the right
  `units_per_pack` / pack type. Order Capture reads that list, not Floor Stock; the Floor Stock link only matters
  later ("Delivered by orders" next to "Sold").
- Re-read this plan against the current code (module-kit, Complaint Box phone rule and references, notifications);
  report anything that changed since 2026-10-12.
- Exit: owner says "start".
- **Done 2026-10-13:** Complaint Box live (2026-10-12) and tried on a phone; Floor Stock's open items deferred for
  later by the owner; plan re-checked against the code (it matches; wording fixes made in this file).

### Phase 1 — Platform registration
- Platform migration `0014_order_capture.sql`: module `order_capture`, role `order_desk` (label "Order desk"). Show it
  first.
- `packages/types`: `MODULE_IDS`, `ROLE_IDS`, `ROLE_MODULE`, `PLANT_STAFF_EXCLUDED` (+ `order_capture`), three
  `NOTIFICATION_KINDS` (`delivered` and `cancelled` bellOnly; none urgent).
- Platform: `ROLE_LABELS`; launcher tile (🧾, staff: "Take an order", owner setup link "⚙ Rates" → `/rates`). The
  "Gets Order Capture alerts" tick box should appear for Order desk users without extra code (`roleWorksIn`).
- `apps/dev-module`: label in `LABELS` and `order_capture` in `REAL_APPS`.
- Tests: `roleWorksIn` (order_desk yes, plant_staff **no**, owner yes), alert tick box offered to order_desk and not
  to plant_staff, an order_desk-only user lands straight in the module.

### Phase 2 — Module foundation
- `./scripts/setup-module-db.sh order_capture order_app ORDER 3005` (dev + test databases).
- Module migration `0001_order_capture.sql`: all tables above, grants, FORCE RLS, checks, `outbox_tenants()`. Show it
  first.
- `apps/order-capture` (Next.js, `:3005`) on `createModule()`: callback, support, logout, logo, proxy, header with 🔔
  and Account, plant colour; empty home page; summary endpoint with no badges yet; `/health`.
- One access table in the server (read, enter / change orders, deliver, cancel, undo delivered, rates, customer
  upload, export) used by every route and page.
- Tests: tenant isolation, FORCE RLS guard on every table, append-only refusals (UPDATE / DELETE on lines, events,
  audit; UPDATE of order copies / customer phone; DELETE anywhere), the access table per role (owner, order_desk,
  plant_staff refused, store_keeper refused, support read-only), no session → platform login / 401.

### Phase 3 — Rates and customers
- `/rates` (owner; support read-only): every active PlantOps product with unit label and default rate; audited;
  Recent changes page (owner + support).
- `/customers` (owner + Order desk): list with search, add, edit name / place, switch off / on; audited.
- `/customers/upload` (owner): CSV, column choice, preview (new / updated / rejected with the reason), confirm;
  audited.
- Tests: owner-only rates, unit default from the product, phone rule (good and bad examples), one customer per phone
  per plant, edit can't change the phone, upload preview counts and nothing saved before confirm, **every row of the
  duplicates table** (different spellings of one number, unchanged, update, switched-off, repeated identical row,
  conflicting rows, possible-duplicate warning), the same file uploaded twice changes nothing, rejected-rows CSV,
  isolation of customers between plants.

### Phase 4 — Entering an order
- `/new` mobile form: phone → customer found / new customer fields; product lines (active PlantOps products of the
  plant only) with quantity and pre-filled rate; live total; Save.
- `POST /api/orders` (JSON) with the request key → `O-0001…`; customer created in the same transaction when new;
  lines version 1; event `created`.
- Last-rate lookup: latest non-cancelled order of this customer containing the product, else the default rate.
- Products unavailable (platform unreachable) → clear message, nothing saved.
- Tests: field rules, inactive / other-plant product refused, browser-sent tenant / user ignored, two parallel saves
  get different references, the same request key twice gives one order, last-rate pre-fill (none / default / last
  order / cancelled order skipped), totals with decimals, copies stored. Check the form at phone width in headless
  Chrome, and from a phone on `pnpm dev:lan` if possible.

### Phase 5 — Order list and handling
- Home `/`: Pending (oldest first, amber after 2 days), Delivered, Cancelled tabs; search; date filter; cards on
  phones.
- `/o/<id>`: details, history, buttons by role: Change (new version of lines), Mark delivered (note, invoice no.),
  Cancel (reason), Undo delivered (owner, reason); `tel:` link.
- Every change sends the expected version / status → 409 if it changed; event + status / version in one transaction.
- Owner CSV export (one row per current order line; formulas neutralised; audited).
- Tests: state rules per role, reasons required, no change after delivery, undo owner-only, 409 on stale changes,
  versions kept and shown, totals after a change, CSV owner-only and neutralised, list / search isolation, amber
  boundary at 2 days. Check the screens at phone width in headless Chrome.

### Phase 6 — Notifications, tile and support view
- `src/server/notify.ts` with the three events above, called after the answer; `src/server/outbox.ts` +
  `kit.retryOutbox()`; `POST /api/cron/daily` (outbox only); Order Capture step in `.github/workflows/daily.yml`,
  skipped until the GitHub variable `ORDER_URL` exists (also add `ORDER_URL` to the variable list in its header
  comment).
- Summary badges: "N pending", "N pending over 2 days" (warn), "N new today".
- Support view: read-only in proxy and server guards; page views logged; owner's `/support-access`; add
  `order_capture` to `SUPPORT_READY` in `apps/platform/src/app/super/dashboard/page.tsx`.
- Tests: one per event (recipients, excluded actor, `only_listed` for delivered, level, dedupe), outbox kept on 5xx
  and dropped on 4xx, wrong cron secret 401, badges for an empty and a mixed plant, every write refused for support,
  page views logged. Verify on `pnpm dev` that Sujata (plant 002) gets a new-order notification and the tile shows
  numbers.

### Phase 7 — Release and deploy
- `apps/order-capture/NOTES.md`, Dockerfile, CLAUDE.md status note (module list in "Repo layout", "Every module app
  must" list, public addresses), HANDBOOK / DEPLOY additions, `docs/deployments/shared.md` record, next minor
  version.
- Also: `scripts/setup-railway-db.sh` / `.sql` include Order Capture (host question, `order_app` password, session
  and module secrets, `.env` lines, as done for Complaint Box); `.github/workflows/backup.yml` "every schema
  has data" list gets `order_capture` **only after** the live migration has run; check the `.paste` file from
  `add-railway-module.sh` (no storage, no `BACKUP_*`, no Brevo needed; `CRON_SECRET` needed).
- Live: platform migration, `./scripts/add-railway-module.sh shared order_capture order_app ORDER 3005
  orders.bluemins.life`, Railway service (no volume), `CRON_SECRET`, DNS (`orders` CNAME + `_railway-verify` TXT at
  WordPress.com), GitHub variable `ORDER_URL`.
- Checks: `/health`, no session → PlantOps login, APIs 401, tile without the platform ticket refused, cron with a
  wrong secret 401; then the owner tries it on a phone: switch it on for plant 001, set rates, upload customers, give
  a marketing staff member Order desk, enter the sample order (Sri ram hotel), get the notification, mark delivered.

## Build prompts

Paste **one** phase prompt (as it is) into a new Claude Code session at `~/projects/plantops_platform`; its first
line makes the session read the shared header below. Each starts in plan mode and waits for approval. Run them in
order; each assumes the previous phase is finished and tested.

### Shared header (each phase prompt's first line points here; no need to paste it)
```text
We are building the Order Capture module of PlantOps. The agreed design is docs/ORDER_CAPTURE_PHASE_PLAN.md
(owner agreed on 2026-10-12): read it fully, plus CLAUDE.md, before anything else. The screens follow the owner's
mock-ups (link at the top of the plan). Follow the module conventions of
apps/complaint-box (phone rule, per-plant references, 409 on stale changes, notifications, support view) and
apps/floor-stock (owner setup screens, Recent changes, CSV), all through packages/module-kit. Apps import shared
code only from packages/*.

Rules: start in plan mode and wait for my approval; show every migration before running it; ask before any
change to schema, permissions, tenant isolation or the SSO token that is not already in the plan; never trust
tenant or user ids from the browser; enforce access on the server; no secrets in code, docs or tests. Write tests
with the feature (real Postgres test database). Explain each change in plain language; I am not a full-time
developer. At the end of the phase run the tests of every touched app, typecheck and build, and add a short
dated note to apps/order-capture/NOTES.md (create it in phase 2). Don't commit until I say so.

Keep the first level minimal: customer = name, phone, place; order = product, quantity, rate. Don't add fields
that are not in the plan. This module must send notifications from day one (docs/notifications.md N5+); the
events are listed in the plan.
```

### Phase 0 prompt
```text
Before anything else, read the "Shared header" in docs/ORDER_CAPTURE_PHASE_PLAN.md (Build prompts section) and
follow it for this whole session.

Phase 0 only: check readiness, change nothing.
1. Summarise where the repo stands (CLAUDE.md status log, apps/complaint-box/NOTES.md, apps/floor-stock/NOTES.md
   Pending) and whether Complaint Box is deployed and tried.
2. Tell me how to check that every Floor Stock finished good of plant 001 is linked to a PlantOps product (read-only
   query or screen), so all of them will appear in Order Capture.
3. Re-check docs/ORDER_CAPTURE_PHASE_PLAN.md against the current code: module-kit API (products cache, notify,
   retryOutbox), Complaint Box's phone rule and reference allocation, PLANT_STAFF_EXCLUDED / roleWorksIn,
   NOTIFICATION_KINDS, alert tick boxes, setup-module-db.sh, add-railway-module.sh, daily.yml / backup.yml. List
   anything in the plan that no longer matches and propose the edit.
4. Ask me whether to start Phase 1.
```

### Phase 1 prompt
```text
Before anything else, read the "Shared header" in docs/ORDER_CAPTURE_PHASE_PLAN.md (Build prompts section) and
follow it for this whole session.

Build Phase 1 (Platform registration) of docs/ORDER_CAPTURE_PHASE_PLAN.md:
- platform migration 0014_order_capture.sql adding module order_capture and role order_desk (show it first; dev +
  test databases)
- packages/types: MODULE_IDS (after complaint_box), ROLE_IDS, ROLE_MODULE (order_desk → order_capture),
  PLANT_STAFF_EXCLUDED gets order_capture, the three order_capture kinds in NOTIFICATION_KINDS (delivered and
  cancelled are bellOnly; none urgent)
- platform: ROLE_LABELS; tile text, icon and "⚙ Rates" setup link in apps/platform/src/lib/modules.ts; confirm the
  user form offers the role and the "Gets Order Capture alerts" tick box without extra code
- make sure apps/dev-module does not serve order_capture
Tests: roleWorksIn for order_desk (yes) and plant_staff (no), the alert tick box offered to order_desk and not to
plant_staff, an order_desk-only user lands straight in the module, the notification settings page lists the new
kinds. Then verify on pnpm dev with plant 002.
```

### Phase 2 prompt
```text
Before anything else, read the "Shared header" in docs/ORDER_CAPTURE_PHASE_PLAN.md (Build prompts section) and
follow it for this whole session.

Build Phase 2 (Module foundation) of docs/ORDER_CAPTURE_PHASE_PLAN.md:
- ./scripts/setup-module-db.sh order_capture order_app ORDER 3005 for dev and test
- apps/order-capture/db/migrations/0001_order_capture.sql with every table, grant, FORCE RLS policy, check
  constraint and function from the plan's Database section (show it first)
- the Next.js app on :3005 using createModule(): callback, support, logout, logo, proxy, header (🔔 + Account),
  plant colour, empty home page, empty summary endpoint, /health
- one access table in the server (read, enter / change orders, deliver, cancel, undo delivered, rates, customer
  upload, export) used by every route and page
Tests: tenant isolation, FORCE RLS guard over every table, append-only refusals for order_app (list each refused
statement), access table per role (owner, order_desk, plant_staff refused, store_keeper refused, support read-only),
no session → platform login for pages and 401 for APIs. Verify login through the platform on pnpm dev.
```

### Phase 3 prompt
```text
Before anything else, read the "Shared header" in docs/ORDER_CAPTURE_PHASE_PLAN.md (Build prompts section) and
follow it for this whole session.

Build Phase 3 (Rates and customers) of docs/ORDER_CAPTURE_PHASE_PLAN.md:
- /rates, owner only (support read-only): every active PlantOps product of the plant (kit products cache) with a
  unit label (default from the product: "box" if it holds more than one unit, else its pack type) and a default
  rate; audited; Recent changes page (owner + support)
- /customers (owner + Order desk): search, add, edit name / place, switch off / on; the phone (Indian-mobile rule,
  same as Complaint Box) is fixed and unique per plant; audited
- /customers/upload (owner): CSV with name, phone, place; choose the columns; preview new / unchanged / update /
  rejected exactly as the plan's duplicates table says (phone after normalising is the identity); nothing saved
  until confirmed; rejected rows downloadable as CSV; audited
Tests: owner-only rates, unit default, phone rule (good and bad examples), one customer per phone per plant, phone
can't be edited, every row of the duplicates table, the same file uploaded twice changes nothing, nothing saved
before confirm, isolation.
Check the screens at phone width in headless Chrome.
```

### Phase 4 prompt
```text
Before anything else, read the "Shared header" in docs/ORDER_CAPTURE_PHASE_PLAN.md (Build prompts section) and
follow it for this whole session.

Build Phase 4 (Entering an order) of docs/ORDER_CAPTURE_PHASE_PLAN.md:
- /new mobile form: phone → customer found (name, place shown) or new customer fields; product lines with whole
  quantity and a rate pre-filled from this customer's last non-cancelled order for that product, else the default
  rate; each product once; live total; Save
- POST /api/orders (JSON) with a one-time request key (not crypto.randomUUID, which fails on plain http): per-plant
  reference O-0001… allocated safely under concurrency; new customer created in the same transaction; lines
  version 1; event "created"; copies of customer and product details stored; a repeated key returns the same order
- products unavailable (platform unreachable) → clear message, nothing saved
Tests: field rules, inactive / other-plant product refused, browser-sent tenant / user ignored, two parallel saves
get different references, the same key twice gives one order, last-rate cases (none, default, last order, cancelled
order skipped), totals with decimals, copies stored. Enter the owner's sample order (Sri ram hotel: 500ml 1 box at
90, 1ltr 3 box at 140 = ₹510) on pnpm dev and check the form at phone width.
```

### Phase 5 prompt
```text
Before anything else, read the "Shared header" in docs/ORDER_CAPTURE_PHASE_PLAN.md (Build prompts section) and
follow it for this whole session.

Build Phase 5 (Order list and handling) of docs/ORDER_CAPTURE_PHASE_PLAN.md:
- home: Pending tab (oldest first, amber after 2 days), Delivered and Cancelled tabs (newest first), search
  (reference, name, phone digits, place), date filter, cards on phones
- /o/<id>: details, history, and only the buttons the user may use: Change (new version of the lines, while
  pending), Mark delivered (optional note ≤ 300, optional Zoho invoice no. ≤ 40), Cancel with a reason, Undo
  delivered (owner only, reason); the customer's phone as a tel:+91 link (plain text in the support view)
- every change sends the expected version / status; 409 with a plain message if it changed; event + status /
  version in one transaction
- owner CSV export (one row per current order line, formulas neutralised, audited)
Tests: state rules per role, reasons required, no change after delivery, undo owner-only, 409 on stale changes,
versions kept and shown, totals after a change, CSV owner-only and neutralised, list / search isolation, the 2-day
amber boundary. Check the screens at phone width in headless Chrome.
```

### Phase 6 prompt
```text
Before anything else, read the "Shared header" in docs/ORDER_CAPTURE_PHASE_PLAN.md (Build prompts section) and
follow it for this whole session.

Build Phase 6 (Notifications, tile and support view) of docs/ORDER_CAPTURE_PHASE_PLAN.md, using the notification
table in the plan exactly (kinds, recipients, texts, links, dedupe keys, levels):
- src/server/notify.ts called with kit.notify after the answer; exclude_user_id = whoever acted; delivered goes to
  the person who entered the order only (also_user_ids + only_listed); cancelled adds that person; no customer
  phone numbers in notifications
- src/server/outbox.ts + kit.retryOutbox(); POST /api/cron/daily (CRON_SECRET, outbox only); Order Capture step in
  .github/workflows/daily.yml, skipped until the GitHub variable ORDER_URL exists
- summary badges: "N pending" (info), "N pending over 2 days" (warn), "N new today" (ok)
- support view: read-only in proxy and server guards; page views logged; owner's /support-access page; add
  order_capture to SUPPORT_READY in apps/platform/src/app/super/dashboard/page.tsx
Tests: one per event (recipients, excluded actor, level, dedupe), outbox kept on 5xx and dropped on 4xx, wrong
secret 401, badges for an empty and a mixed plant, every write refused for support, page views logged. Verify on
pnpm dev that Sujata (plant 002) gets a new-order notification and the tile shows numbers.
```

### Phase 7 prompt
```text
Before anything else, read the "Shared header" in docs/ORDER_CAPTURE_PHASE_PLAN.md (Build prompts section) and
follow it for this whole session.

Phase 7 (Release and deploy) of docs/ORDER_CAPTURE_PHASE_PLAN.md:
- apps/order-capture/NOTES.md complete, Dockerfile, CLAUDE.md dated status note (and the repo layout, public
  addresses and "Every module app must" mentions), HANDBOOK and DEPLOY additions, setup-railway-db.sh / .sql, the
  next minor release version
- give me the live steps one at a time and wait for me at each: platform migration on the shared copy,
  ./scripts/add-railway-module.sh shared order_capture order_app ORDER 3005 orders.bluemins.life, Railway service
  (no volume), CRON_SECRET, DNS at WordPress.com, GitHub variable ORDER_URL, deploy from the production branch, and
  only then order_capture in backup.yml's "every schema has data" list
- live checks: /health, platform-login redirect, 401s, tile ticket refused without the platform, wrong cron secret
- then a checklist for me on a phone: switch it on for plant 001, set rates, upload customers, give a marketing
  staff member Order desk, enter the sample order, the notification, mark delivered, cancel one, CSV
Record everything in docs/deployments/shared.md.
```
