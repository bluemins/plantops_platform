

### 2026-10-24 — WhatsApp reorder reminders (WhatsApp Step 4, v0.31.0)
Design `docs/WHATSAPP_BUILD_PLAN.md` section 9 (owner "build" 2026-10-24); pilot rules: contract checklist 6.
**Order Capture sends the reminder itself** (owner's choice over the delivered-event design of contract 3.5): no event
outbox, no event secret, no 15-minute job.
- **Migration `0005_reminders.sql`** (approved): `customer_consents` (append-only; newest row = the answer; sources
  bot_after_order / staff_phone / whatsapp_stop / whatsapp_start / reminder_button; wording `optin-v1`; kept forever),
  `reminder_groups` (append-only, one per customer), `customer_messages` kind `reorder_reminder`, status `skipped` +
  `skip_reason`. `order_app` SELECT + INSERT on the new tables; `reminder_tenants()`.
- **`src/server/consent.ts`:** newest answer; the same answer twice writes nothing; a stop needs a yes first.
- **Staff tick** (Customers → Edit, owner + Order desk, access row `consent`): consent row `staff_phone` + Recent
  changes line; the list shows a "Reminders" tag.
- **Bot API** `POST /api/bot/v1/consent`: source decides the possible answers; a yes needs the customer switched on;
  START only restores a WhatsApp stop (never a first yes, never a staff untick); unknown phone = `recorded: false`.
  Context answer + `reminders`, `reminders_on`.
- **`src/server/reminders.ts`** + `POST /api/cron/reminders`: orders delivered 15 India days ago (catch-up 2 days, from
  the pilot start); checked in order: pilot over, customer off, no consent, newer order, a reminder in the last 14 days,
  pilot full, holdout (30 %, drawn once), budget. The row is written `pending` before Twilio is called; never retried.
  Template `{{1}}` name, `{{2}}` "5 box Bluemins 1L, …". A Twilio 4xx stops the plant's reminders for this pilot +
  kind `order_capture.reminder_failed` (owners, phone + bell).
- **The thank-you sender only sends thank-yous** (`sendPending` filters on kind).
- **`/reminders` page** (access row `reminder_pilot`: owner, support): settings, groups, due / sent / skipped by reason,
  ordered again within 7 / 14 days per group (the reminded order itself excluded), opt-outs of pilot customers, cost,
  the stop rules.
- **Settings:** `ORDER_REMINDERS`, `REMINDER_PILOT_START`, `REMINDER_PILOT_CUSTOMERS` (100), `REMINDER_COST_PAISE`
  (100), `REMINDER_BUDGET_PAISE` (50000); `reminder_content_sid` in the plant's `TWILIO_WHATSAPP_SENDERS` entry.
- **Made while building:** an unreachable Twilio marks that reminder failed (not retried, as the thank-you's "late is
  worse than none"); the "no open complaint" check is not in the pilot (no module-to-module lookup yet).
- **Tests:** Order Capture 343 (+23: `test/reminders.test.ts`, access rows, append-only and isolation guards).

### 2026-10-25 — Broken WhatsApp / bot settings are loud (v0.31.3)
**Why:** on 2026-10-24 `TWILIO_WHATSAPP_SENDERS` on the live copy was replaced by the fragment
`"reminder_content_sid": "HX…"` (the build plan said "add … to the entry"). `senderFor` returned null, so the thank-you
tick box vanished and reminders were off, with only a log line. Found by the owner 2026-10-25.
- **`src/server/thanks.ts`:** `readSender` reads the plant's entry once and names what is wrong: not JSON / not an
  object, the plant's `from` or `content_sid` missing or invalid, Twilio account missing, `reminder_content_sid` not
  `HX…` (thank-you keeps working), the same template twice. `whatsappProblem(tenant)` for pages,
  `whatsappSettingsProblem()` for every plant (for `/health`). A plant not listed is not a problem (not set up).
- **Order page:** a red note above "Mark delivered" for whoever may deliver: "The WhatsApp thank-you is off: the
  WhatsApp settings are broken" + the reason. **Reminder pilot page:** the same in red; "Not sending" names it.
- **`src/server/bot.ts`:** `botKeysProblem()` for a broken `ORDER_BOT_KEYS`.
- **`/health`:** `warnings: [...]` (both of the above); still 200, since the app itself works. **Check it after any
  Railway variable change** on `order-capture`.
- No migration; platform and SSO token unchanged.
- **Tests:** Order Capture 355 (+12: the exact 24 Oct fragment and each other broken shape, another plant's broken entry
  only in `/health`, the order view, `/health` warnings).

### 2026-11-01 — Brand tags on orders (v0.32.0)
**Asked by the owner 2026-11-01:** all orders are in one list; a tag per order showing the brand (Bluemins / Mr.Charge /
Hemex), set by the owner or guessed. Owner chose: set on Rates (migration approved), plus brand chips and brand totals.
- **Migration `0006_product_brand.sql`** (approved by the owner): `product_rates.brand` (null = guessed, `''` = no brand,
  ≤ 30, trimmed) + UPDATE on that column only. Still no DELETE; nothing else changes.
- **Guess** (`src/lib/brand.ts`): the product name's words before its size ("Mr.Charge 5L" → Mr.Charge, "Bluemins (1 L
  × 12)" → Bluemins); none when the name starts with the size.
- **Rates:** a Brand box under each product, filled with the brand in use (the guess too); the same text back saves
  nothing, an emptied box = no tag. Audited ("brand Jar → Mr.Charge" in Recent changes).
- **Order list:** coloured tags next to the customer name (one per brand in the order's current lines; the same brand
  always has the same colour); chips "All brands · Bluemins · Mr.Charge …" when the plant has 2+ brands (`?brand=`,
  kept by the search and the tabs; Select all / WhatsApp copy work on the filtered list). Everyone who reads the list
  sees tags (a brand is not an amount).
- **Owner's pending summary:** "By brand" table (orders, quantity per unit, amount) above "By product"; "No brand" row
  for products without one; shown only when some product has a brand.
- **CSV:** a `Brand` column at the end (existing columns unchanged).
- The brand belongs to the product, not the order: changing it on Rates changes the tag on old orders too.
- **Not done:** tag on the order page itself and in the WhatsApp copy text.
- **Tests:** Order Capture 367 (+12 `test/brand.test.ts`; list summary / CSV tests updated).

### 2026-11-01 — Dates follow the tab (v0.35.1)
**Reported by the owner 2026-11-01:** Delivered with From = To = today showed only 2 orders. The dates filtered by the
day an order was **entered** on every tab, so orders entered earlier and delivered today were left out.
- Now: Pending by the day entered, Delivered by the day delivered, Cancelled by the day cancelled (India date of
  `status_changed_at`, the same time the list is sorted by). The first date box says which: "Entered from" /
  "Delivered from" / "Cancelled from" (`DATE_LABEL` in `src/server/list.ts`).
- No migration; platform and SSO token unchanged. Tests: Order Capture 368 (+1 in `test/list.test.ts`).

### 2026-11-04 — Phone calls Phase 1: the Delivery staff role (platform side; part of v0.36.0, not deployed)
Plan `docs/CALLS_PHASE_PLAN.md` (owner, 2026-11-04).
- **Platform migration `0021_delivery_staff.sql`:** role `delivery_staff` ("Delivery staff") for Order Capture. No new
  table, no grant change, SSO token unchanged.
- **`packages/types`:** in `ROLE_MODULE` (works in Order Capture only); `NO_ALERT_TICK_ROLES` makes `getsAlertsIn`
  false for it (Order Capture's other alerts carry amounts); `DESK_ROLES.order_capture` (their tile asks for the `desk`
  numbers); kind `order_capture.call` "Customer called" (`roles: ["delivery_staff"]`, `noOwners`; nothing sends it
  until Phase 2). Plant staff rules unchanged.
- **Platform:** label, role button "Order Capture · Calls only", Permissions "Delivery staff · Calls only" with 🔔 (they
  do get "Customer called", like a Supervisor's alerts), no "Gets alerts" tick box (form and API 400), tile line
  "Calls", single-module landing. `kindsFor`: a kind for named roles is now offered to those roles only, so Order desk
  doesn't see "Customer called" (Attendance's two such kinds unchanged).
- **Order Capture guard:** `whoFor` gives `desk` for Order desk only, so a Delivery-staff-only person is refused here
  until Phase 2 adds `Who = "delivery"`.
- **For Phase 2 / 4 to settle:** Delivery staff + Plant staff loses the orders view (`viewOnlyIn` is false once someone
  works in the module); Delivery staff + Order desk gets the `desk` numbers and the "Calls" tile line.
- **Tests:** platform 398 (+4 Delivery staff in `test/order-capture.test.ts`, +2 in `test/permissions.test.ts`), auth
  70 (+3), Order Capture 368 (`whoFor` checks added). Typecheck and both builds pass.

### 2026-11-04 — Phone calls Phase 2: database, phone key, recording calls (part of v0.36.0, not deployed)
Plan `docs/CALLS_PHASE_PLAN.md`. Decided by the owner today: **Delivery staff + Plant staff = Calls only**; **a new
caller's number is shown in the alert** (the only Order Capture alert with a customer number).
- **Migration `0007_calls.sql`** (shown and approved): `call_events`, `call_attended`, `ignored_number_changes`; FORCE
  RLS, `order_app` SELECT + INSERT only; no existing table changed. Extra checks: phone = 10-digit mobile / landline
  digits / `hidden`; a missed marks only a ring of the same plant; new customer needs a customer, wrong number none;
  a listed number needs a label, never `hidden`.
- **`src/server/calls.ts`:** `ORDER_CALL_KEYS` parsed like `botKeys()` (broken → off + `/health` warning); `occ_` keys;
  ring rules (incoming = ring; missed marks the newest unmarked incoming within 3 min, else its own ring; same number
  + event within 60 s = repeat, 200); a listed number is dropped before anything is stored (200 `{ ignored: true }`);
  advisory lock per plant + number. Errors, limits and the plan check reuse the bot's (`bot.ts` now exports
  `BotError`, `errorResponse`, `limit`, `checkPlant`).
- **`POST /api/calls/v1`:** outside the login proxy (matcher `api/calls/v1$`: exactly that address, so Phase 3's
  `/api/calls/*` stay behind the login; `test/proxy.test.ts`). 30 events / minute per key, 10 refused keys / minute per
  address, body ≤ 1 KB.
- **"Customer called"** (`callNotification` / `sendCallAlert` in `notify.ts`): Delivery staff from `kit.contacts` (not
  owners), `also_user_ids` + `only_listed`; first ring of a waiting number, again only 10 min after the last alerting
  ring ("· rang N times"), worked out from stored rings. Platform unreachable → outbox. If the contact list can't be read
  at all (no cached copy), the alert is skipped and logged.
- **Access:** `Who = "delivery"` (also with Plant staff / Order viewer; Order desk and owner win); `calls_view`,
  `calls_attend`, `calls_numbers`; every order / customer action refuses them ("Delivery staff work in Calls only.").
  `/` still says "no access" for them until the Calls page (Phase 3).
- **Key script:** `pnpm --filter order-capture call:key <plant uuid> [label]` prints the key once and the complete
  `ORDER_CALL_KEYS` value (adds to the current value when it is set in the shell).
- **Found while checking:** an Odisha landline (`0674 …`) reads as a mobile under the shared `normalisePhone` rule
  (area codes 06xx); tel:+91… still dials it. Left as is (shared with the customer list).
- **Verified on `pnpm dev`** (plant 002 with Order Capture on only for the check, a temporary Delivery staff person, a
  test key in the process environment only; all removed): 401 without / with a wrong key, 201 incoming, 200 repeat,
  missed joined its ring, hidden number, 400 unknown field, `/api/calls/attend` still 401 (login), a listed number
  stored nothing; the Delivery staff person's bell had both alerts, nobody else got one. Phase 1 seen working here too.
- **Tests:** Order Capture 421 (+53: `test/calls.test.ts`, `test/proxy.test.ts`, access table, RLS / append-only
  guards with the three tables).

### 2026-11-04 — Phone calls Phase 3: Calls tab, Attended, "Not an order number" (part of v0.36.0, not deployed)
Plan `docs/CALLS_PHASE_PLAN.md`, mock-up screen 4. **No migration**, no grant change, SSO token unchanged.
- **`src/server/calls-tab.ts`:** `callsTab` (waiting numbers oldest first, max 200; rings in India time with missed
  marked; known customer or "New number"; last delivered order as products × quantities, no rates or amounts; Attended
  today with rings covered, who and when; today's calls / numbers), `attendCall`, `ignoredList`, `setIgnored`,
  `waitingCount`.
- **Attended:** covers that number's waiting rings up to the newest one (worked out on the server, so the page sends
  only the number); a later ring is waiting again. Known customer → never renamed; new Indian mobile → name + place
  through `insertCustomer` (new, shared with the customer list: `on conflict do nothing`, so a phone added meanwhile is
  linked, never a second customer); "Wrong number, don't save"; landline / hidden → Attended only. Nothing waiting any
  more → 409 "Already attended by Raju at 10:33". Uses the phone address's per-number lock (`lockNumber`).
- **"Not an order number":** `/calls/ignored` (owner writes, support reads: `calls_ignore`, `view_ignored`), the card's
  "Not a customer, never show again" (owner only), numbers in any spelling, hidden refused, label 1–40; listed numbers
  and their earlier rings left out of the Calls tab and counts until Remove. "This is customer …" warning.
- **Audit:** `call.attended`, `call.attended_new_customer`, `call.wrong_number` are kept out of Recent changes (one per
  call); a saved caller is its `customer.add` line ("… from a phone call"); `ignored.add` / `ignored.remove` are shown.
- **Screens:** `/calls` (30 s refresh with `router.refresh()`, typed names kept), "Orders | 📞 Calls" switch with the
  waiting count for owner, Order desk and support; Delivery staff: `/` → `/calls`, no switch, other pages send them
  back to Calls. Support access names "Calls" / "Not an order number".
- **Verified on `pnpm dev`** (plant 002 with Order Capture on only for the check; temporary owner, Order desk, Delivery
  staff and customer; test key; Order Capture session cookies signed with its own key, re-checked by the live
  platform; headless Chromium at 390 px, no sideways scroll; all removed after): Raju's `/` → `/calls`; a known
  customer's incoming + missed as one missed ring; new number with name + place saved as customer; landline and
  hidden; owner's switch and "never show again" (landline gone from Calls and counts, on the list page); two taps at
  once → one saved, the other 409; Order desk refused on the list, Raju refused adding a customer. Fixed while checking:
  the hidden-number card's button now spans the card (no 📞 to call).
- **Tests:** Order Capture 443 (+22: `test/calls-tab.test.ts` and access rows for the two new actions). Typecheck and build pass.

### 2026-11-04 — Phone calls Phase 4: calls numbers, tiles, support (part of v0.36.0, not deployed)
Plan `docs/CALLS_PHASE_PLAN.md`, mock-up screen 5. **No migration**, platform and SSO token unchanged.
- **`/calls/numbers`** (`src/server/calls-numbers.ts`, owner + support, `calls_numbers`): Today / This week (from
  Monday) / this month / picked dates (≤ 92 days; anything wrong = today), India days. Calls, missed, numbers,
  attended, waiting (attended = an Attended covers the number's last ring in the period, so attended + waiting =
  numbers), new; by day; Rang most (top 10); Attended by (different numbers per person). Definitions on the page.
  Listed numbers left out. Linked from the Calls tab ("Calls numbers").
- **Tiles (`summaryFor`):** owner "N calls today · N waiting" (warn when waiting) instead of "N new today", **only once
  the plant has any call** (plants without the phone keep "N new today"); Delivery staff (`desk`) "N waiting" /
  "Nobody waiting" + "N calls today"; Order desk and viewers unchanged.
- **Support:** Calls, numbers and the list read-only, views logged ("Calls numbers" in `describeView`).
- **Verified on `pnpm dev`** (plant 002, temporary owner / Order desk / Delivery staff with platform sessions, test key,
  calls by curl; dev's Order Capture address pointed at localhost for the check and put back; all removed): tiles
  through the platform's `/api/launcher/summary/order_capture` — owner "No pending orders · 3 calls today · 3
  waiting", Delivery staff "3 waiting · 3 calls today", Order desk "No pending orders"; the numbers page at 390 and 1280
  px (no sideways page scroll; the by-day table scrolls inside its box on a phone).
- **Tests:** Order Capture 455 (+12: `test/calls-numbers.test.ts` with the mock-up's worked day, `test/summary.test.ts`).

### 2026-11-06 — Sales ledger tables + Import from Zoho (L2 + L3, v0.38.0)
Plan and decisions: `docs/ZOHO_IMPORT_PHASE_PLAN.md`. Migration `0008_ledger.sql` (approved): `zoho_imports`,
`zoho_contacts`, `bills`, `bill_lines`, `payments`, `payment_allocations`, `bill_adjustments`; FORCE RLS; `order_app`
SELECT + INSERT, UPDATE only on `zoho_contacts (customer_id, mobile, mobile_typed, updated_at)`, `bills (order_id,
zoho_gst_invoice_no, cancel columns)`, `payments (cancel columns)`; no DELETE. One open bill per order (partial unique
index); numbers unique per plant; a bill / payment belongs to exactly one customer or Zoho contact.
- **Money rules:** `src/lib/ledger.ts` (paise): `billDue`, `billStatus`, `paymentUnused`, `ledgerTotals`,
  `allocatePayment` (ticked bills or oldest first, rest = advance), `useAdvances`, `orderLedgerStatus` (Closed),
  `statement` (running balance, opening before a range). Nothing stored.
- **Import:** `src/lib/zoho-import.ts` (readers + `planImport`), `src/server/zoho-import.ts` (preview / confirm,
  fingerprint, refuses unless every due matches Zoho), `POST /api/zoho-import/{preview,confirm}`, page
  `/customers/zoho` (owner; access row `zoho_import`). Imported bills always point at the Zoho contact; the contact
  points at the customer (so adding a phone later moves its bills). Zoho bills keep Zoho's invoice id as
  `zoho_invoice_id`; an opening balance uses `ob:<contact id>` and number `OB-<contact id>`.
- **Made while building:** contacts' **opening balances** (12 at plant 001, ₹20,936; 11 payments "Customer opening
  balance") become bills, not found in the plan before; place from the brackets in the Zoho name (Zoho has no billing
  city for plant 001); order matching window 1 day before to 3 days after delivery (no delivered order at plant 001 has
  a typed invoice no.); Zoho's leading apostrophe on mobiles stripped; the Zoho rate is **not** imported to Rates.
- **Plant 001 (real files, dry run against live data, read-only):** billed ₹33,97,724.12 (incl. ₹20,936 opening
  balances), received ₹32,93,400.02 (2 drafts, ₹1,500, skipped), due ₹1,04,896.26 = Zoho, 0 mismatches, 33
  adjustments ₹6,892.84; 262 contacts linked, 382 new customers, 460 no phone yet; 42 of 86 delivered orders linked, 44
  to check. Real files through the real import into the test database: preview 0.1 s, confirm 0.8 s (2 MB request).
- **Changed the same day (owner: "I can do the match ... do not miss anything"):** the import never creates customers;
  it links a contact only when exactly one Zoho contact has a mobile already in the customer list (plant 001: 224
  linked, 880 to match). **Match screen** `/customers/match` (`src/server/zoho-match.ts`, `src/lib/name-match.ts`,
  `POST /api/zoho-match`; access row `zoho_match`, owner): To match / Linked / Your customers without Zoho, name
  suggestions (titles and punctuation dropped, place in brackets compared separately, score ≥ 0.5), link / unlink /
  new customer (409 when the mobile is already a customer). Mock-ups: https://claude.ai/artifact/31f4BLeKyxsT6azMdE62CQ
- Tests: Order Capture `ledger.test.ts`, `ledger-db.test.ts`, `zoho-import.test.ts`, `zoho-match.test.ts`, guards.

### 2026-11-06 — Bills and payments in daily use (L4 + L5, v0.39.0)
`src/server/ledger.ts` (account, lists, bill, makeBill, receivePayment, cancelBill / cancelPayment with reversing
allocation rows, setGstInvoice, CSV rows, `openBillNumber` for the Undo-delivered guard); pages `/bills`, `/bills/[id]`,
`/payments`, `/customers/[id]`, `/customers/z/[id]` (shared `src/app/account-view.tsx`), forms in
`src/app/ledger-forms.tsx`; order page bill box + Make bill; Delivered list "Closed" (`ListRow.closed`, only for people
who see amounts). Access rows `ledger_view` (owner, desk, support), `bill_make` / `payment_receive` (owner, desk),
`bill_cancel` / `payment_cancel` / `ledger_export` (owner). Notifications `order_capture.payment`,
`order_capture.bill_cancelled`, `order_capture.payment_cancelled` (bell). Tests `ledger-actions.test.ts` (12).
- **Made while building:** a bill's date is the day it is made; due date defaults to the same day (owner can pick later);
  bills keep the order's lines at its current version (HSN from the product); an advance is used by the next bill
  automatically, oldest payment first; a cancelled bill frees its payments as advance (it is not re-applied to other
  bills automatically: the next payment / bill does that).
- **Next Zoho Books features (owner to order):** credit notes; receivables aging (0–30 / 31–60 / 61–90 / 90+ days) and
  sales by customer / product; payment reminders (WhatsApp / bell for overdue bills); a bill without an order (walk-in);
  recurring bills; sending bills to Zoho for GST (send queue, decision 4.9).
- **v0.39.1 (owner, same day):** the plant's totals (Bills "Still due / Overdue", Payments "Received") are owner +
  support only (`ledger_totals`); `billsList().summary` / `paymentsList().total` are null for Order desk.

### 2026-11-06 — Accounts role (v0.40.0)
Owner: only people with **Accounts** see the Bills section. Platform migration `0025_accounts_role.sql`; `accounts` in
`ROLE_IDS` / `ROLE_MODULE` (works in Order Capture, so it can be ticked for its alerts). Order Capture: `Who` gains
`accounts`; `OcUser.also` carries Accounts for someone who is also Order desk (`can()` checks both). Access:
`read`, `see_amounts`, `view_customers`, `ledger_view`, `bill_make`, `payment_receive` for Accounts; Order desk loses
`ledger_view`, `bill_make`, `payment_receive` (plain refusal "Bills and payments need the Accounts role. Ask the owner.").

### 2026-11-07 — Make bill with Zoho-like fields, GST bills, GST invoices to make (B2–B4, v0.42.0)
Owner 2026-11-07 (plan + mock-ups: `docs/BILL_FIELDS_PHASE_PLAN.md`). Migration `0009_bill_fields.sql` (approved):
bills gain terms, salesperson_id, vehicle, reference_no, private_note, needs_gst, gstin, place_of_supply,
tax_inclusive, cgst / sgst / igst (= tax_total for PlantOps bills), sent_to_zoho_at / by / by_name (the only new
UPDATE); bill_lines.taxable; customers.gstin / state_code (UPDATE); new `bill_settings` (one row per plant, FORCE RLS,
no DELETE). Code: `src/server/bill-make.ts` (form data, makeBill, settings, gstQueue, zohoCsvRows); money rules
`billAmounts` / `dueFromTerms` in `src/lib/ledger.ts`.
- **Decided by the owner:** salesperson and vehicle are separate fields on the main form (no "delivered by"); GST tick
  on by itself when the customer has a GSTIN; rates include GST by default, changeable per bill; product GST rates set
  by hand on PlantOps Products (never from Zoho items); one screen for the ticked bills, then export.
- **Made while building:** salespeople = owners + people with an Order Capture role (the alert-contacts list; no
  platform change), stored as id + name; the bill's discount is shared over the lines before GST (Zoho's "discount
  before tax"), the last line taking left-over paise; inclusive GST: taxable = amount ÷ (1 + rate) rounded, CGST
  rounded, SGST = the rest; bill date between the delivery and today; the customer's GSTIN / state follow their latest
  GST bill; the Zoho file's rows are drafts with Invoice Number = the B-number and Subject "PlantOps B-…"; "new" marks
  bills sent once (who / when), "again" re-downloads sent ones; support sees the list, can't download; Order desk
  sees nothing (Bills are Accounts + owner since v0.40.0); private note shown only to people who make bills.
- Tests: Order Capture 626 (+23: `bill-amounts.test.ts` 13, `bill-make.test.ts` 10; guards extended for the new table
  and 11 locked bill columns).
- **Not yet verified:** on screen; a real Zoho import of the file (Invoice Number column and other states' codes).

### 2026-11-07 — Reports: Sales by Item / Customer (v0.43.0)
Owner 2026-11-07 (`docs/REPORTS_PHASE_PLAN.md`, mock-ups linked there). `/reports` (sections; Sales now) and
`/reports/sales/item|customer` with one filter bar (period, break down by month / quarter, salesperson, place,
vehicle, group by, before / with GST), CSV `/api/reports/sales/<kind>?…` and print. Rules: `src/lib/report.ts` (pure);
data: `src/server/reports.ts` (bill lines of the period; PlantOps + Zoho bills; cancelled and `ob:` bills left out;
row per `sku_id`, else Zoho's name). Access row `reports` = owner + support. Summary view `reports` = the owner's
dashboard card (last month's sales, change on the month before).
- **Made while building:** salesperson names compared without case or spaces ("Anmol " = "anmol"), first spelling
  shown; "Not mentioned" / "No …" groups first, then by name, like Zoho; rows biggest first; quarters are Indian FY
  quarters (Q1 Apr–Jun); a month without sales shows 0; group by customer isn't offered on Sales by Customer; place =
  the PlantOps customer's place (an unmatched Zoho contact: "No place (Zoho contact not matched)"); "with GST" = the
  line before GST + its GST; a salesperson name on Sales by Customer (grouped by salesperson) opens Sales by Item.
- Tests: Order Capture 651 (+21: `report-lib.test.ts` 16, `reports.test.ts` 4, access row 1), platform 424.
- **Not yet verified:** on screen; the owner's check against Zoho's Oct 2026 Sales by Item by salesperson.

### 2026-11-07 — Customer page like Zoho + owner's Customers card (Part 1, v0.44.0)
Plan `docs/CUSTOMER_PAGE_PHASE_PLAN.md`; mock-up https://claude.ai/artifact/NcJtuLX74cmspbpZU5vgzx.
- `src/app/account-view.tsx`: tabs Overview / Transactions / Orders / Statement (`pickTab` in `src/lib/customer-page.ts`;
  old `bills` / `payments` links → Transactions; no tab → Overview). Same page for an unmatched Zoho contact.
- `account()` (`src/server/ledger.ts`) also returns the customer's GSTIN / state / added by, the linked Zoho contacts'
  details, `billed_6m`, each payment's `for_bills` and `timeline` (bills, Zoho invoices dated by their bill date,
  payments, cancellations, `customer.add/update/reminders`, `zoho.match/unmatch` audit rows; newest 50).
- Transactions filters are links (`bs` = all / due / paid / cancelled, `ps` = all / received / cancelled); "Due" = due,
  partly paid and overdue. Tables on PC, the old cards on phones (payment Cancel stays on both).
- Statement quick ranges: this month, previous month, this quarter (Apr–Jun …); plant name + GSTIN from branding (the
  plant's address isn't in the branding answer yet).
- Summary view `customers` (`src/server/summary.ts`): active customers · due (> 0) and how many owe (a Zoho contact
  counts with its customer) · Zoho contacts not matched.
- **Made while building:** Contact box shows the mobile as text (the tap-to-call is in the heading); the card says
  "Zoho contacts to match" rather than "no phone yet" (unmatched contacts are what the owner can act on).
- Verified on `pnpm dev` (plant 002 with Sales switched on for the check, one example customer with two Zoho invoices +
  payments and one PlantOps bill; headless Chromium at 390 / 1280 px; all removed afterwards): Overview, Transactions,
  Statement, the dashboard's Customers card with live numbers.

### 2026-11-07 — Customer page Part 2 + GST details (v0.45.0)
Migration `0010_customer_details.sql` (owner approved): customers + 11 optional columns (GST details, contact, delivery,
terms) with column UPDATE (+ `phone`, `phone_typed`, D3); bills + `bill_to_name` / `bill_to_address` / `gst_treatment`
(GST bills only, check; no UPDATE); `customer_comments`, `customer_persons` (UPDATE `active` only), `customer_locations`
(set / clear rows; accuracy ≤ 150 m; source phone / map_link / field_visit).
- `src/server/customer-details.ts`: Edit (`updateCustomerDetails`: a GSTIN fills the state + "registered" when empty; new
  mobile needs a reason, 409 if another customer has it), comments, persons, `saveLocation` / `clearLocation`,
  `shopSearch` / `shopView`. Access rows: `customer_edit`, `customer_comment` (owner); `location_view` / `location_save`
  (owner, Order desk, Accounts, Delivery staff; support views); `location_clear` (owner, Order desk).
- A pasted Maps link: numbers, `?q=` / `query=` / `ll=`, `@lat,lng`, `!3d!4d` (`parseMapPosition`); a
  `maps.app.goo.gl` / `goo.gl` short link is opened by the server (redirect header only, 3 s, those hosts only).
- Make bill (`bill-make.ts`): GST details from the form or the customer (else the linked Zoho contact's name, one with a
  GSTIN first); registered business = GSTIN; needs address, city, PIN; saved back on the customer; bill-to copy on the
  bill (address on lines: street / city / PIN). Zoho CSV: Customer Name = bill-to name (older bills: calling name),
  billing columns at the end.
- `/shops`, `/shops/[id]` for Order desk / Accounts / Delivery staff (Calls → Shop locations; customer list "📍 Location"
  for Order desk). Delivery staff still can't open the customer page (redirect to Calls).
- **Made while building:** the Edit form spans the full width above the Overview boxes; the comment count on the tab;
  changed-field names in the timeline in the form's order; validation errors from these functions are plain 400s.
- **Not yet confirmed:** that Zoho's invoice import takes the Billing columns (check with one import; Zoho also keeps the
  address on its contact).
- Verified on `pnpm dev` (plant 002 with Sales on for the check; a customer linked to a Zoho contact and a delivered
  order; headless Chromium with a faked GPS fix; all removed afterwards): Edit + save, Save my location here (±18 m),
  Comments, Make bill's GST details filled from the customer, Delivery staff's Shop locations at 390 px and refused on
  the customer page.

## 2026-11-07 — v0.45.1: link all Zoho contacts with no mobile to one customer
- Owner: staff can't take a payment on an unlinked Zoho contact (Receive payment is per customer). Plant 001's contacts
  without a usable mobile (~346) all go to "Retail Customer" 7999293831.
- `link_no_mobile` in `src/server/zoho-match.ts` (access `zoho_match`, owner): `insertCustomer` finds the customer by
  mobile or adds it; one UPDATE links every contact with `customer_id` and `mobile` both null; one `zoho.match` audit
  row per contact (`no_mobile_bulk: true`) so the customer timeline lists each and each can be unlinked alone.
  Contacts with a mobile (incl. shared mobiles) are left to match by hand. No migration.
- Card on Match → To match with a confirm. Not plant-specific: the owner types the mobile / name / place.
- Tests: `test/zoho-match.test.ts` (+1: owner only, bad mobile, new then reused customer, only no-mobile unlinked).

## 2026-11-07 — v0.45.2: "Link by mobile" on the Match screen
- Owner: "build the Link by mobile button" (unmatched contacts block payments). `link_by_mobile` in
  `src/server/zoho-match.ts`; the rule in `src/lib/by-mobile.ts` (`byMobilePlan`, used by the card's counts and the
  server): mobile = a customer's → link; mobile on only this one unmatched contact → `insertCustomer` (`customerName`,
  `placeFromName`) + link; mobiles shared by several unmatched contacts stay. One `zoho.match` audit row per contact
  (`by_mobile_bulk: true`). No migration.
- Plant 001 before the press (live, read-only): 525 to match = 102 + 343 + 80 shared.
- Tests: Sales 695 (+1).

## 2026-11-07 — v0.45.3: Link by mobile takes shared mobiles too
- Owner: "first take all to PlantOps and then have a strategy to merge the contacts". `linkByMobile` links every
  unmatched contact with a mobile, newest bill first (`newestFirst` in `src/lib/by-mobile.ts`): the first contact of a
  mobile no customer has becomes the customer (its name, place from the brackets), the rest with that mobile are linked
  to it. `byMobilePlan` now counts toCustomer / toNew / sharedContacts / sharedMobiles for the confirm box.
- Plant 001 (live, read-only, before the press): 80 contacts on 34 mobiles (71 billed; e.g. DM Sanskruti / DM Sankruti
  (Pada), Mohini / Maheswari Hotel on one phone). Merge strategy still to agree with the owner.
- Tests: Sales 696.

## 2026-11-07 — v0.45.4: WhatsApp thank-you only for chosen brands
Owner 2026-11-07: no "Send a WhatsApp thank-you" tick for Mr.Charge orders, only Bluemins (1 L / 500 ml / 250 ml).
Generic, config only (no migration, no plant name in code): the plant's `TWILIO_WHATSAPP_SENDERS` entry takes an
optional `"thanks_brands": ["Bluemins"]`. The tick box shows only when at least one product of the order's current
lines has one of those brands (the brand on Rates, else guessed from the name; any letter case), so a mixed
Bluemins + Mr.Charge order still gets it. Other orders show "No WhatsApp thank-you for this order: it is sent only
for Bluemins orders."; `send_thanks` on them is refused (400). Left out = every order (as before). A broken list
(not a list of brand names) turns the thank-you off for every order and is named on the order page and `/health`.
Reminders are unchanged. Tests: `test/thanks.test.ts` (+4).

## 2026-11-07 — v0.46.0: Marketing staff
Owner 2026-11-07: Marketing staff see customers with amounts and edit their details (the mobile too, after "allow the
marketing staff to update the mobile number"); GST details and payment terms stay owner-only; no orders.
- Platform migration `0027_marketing_staff.sql`; `marketing_staff` in `ROLE_MODULE` and `NO_ALERT_TICK_ROLES`.
- Access table: `Who = "marketing"`; new actions `account_view` (one customer's / Zoho contact's page, a bill's page,
  statement CSV; `ledger_view` is now only the Bills section) and `customer_details` (every field but GST details and
  payment terms, incl. the mobile; contact persons); `customer_edit` (owner) = GST details, payment terms, pasted Maps link.
  `updateCustomerDetails` refuses a changed owner-only field (403) and accepts it sent back unchanged.
- `whoFor`: owner > Order desk > Accounts > Marketing staff > Delivery staff > viewers; `also` adds marketing to Order
  desk / Accounts and delivery to Marketing staff. Marketing staff + Order viewer sees no orders.
- `account()` returns no orders to anyone without `read`; the Orders tab and order links are hidden for them.
- Home `/` redirects Marketing staff to `/customers` (with a Shop locations link); a bill's back link goes to the customer.
- Tile: summary view `marketing` (`summaryViewFor` on the platform when they hold no order role): customers, added in 7
  days, without a saved shop location. Not `customers`: that has the plant's money due (plant totals are owner-only).
- Made while building: Marketing staff can't tick "Agreed to WhatsApp reminders" (consent stays owner / Order desk).
- Tests: access (+ Marketing staff), customer-details (+5), summary (+1); platform permissions / tile view.

## 2026-11-07 — v0.47.0: "Buying & paying" on a customer's page
Owner 2026-11-07 (plan agreed in chat; bill value for the chart; "Due to reorder" list = next release). A card at the top
of a customer's (and an unmatched Zoho contact's) Overview tab. Rules in `src/lib/customer-insights.ts` (pure, worked out
when the page opens, nothing stored); facts gathered by `buyingAndPaying` in `src/server/ledger.ts`; card
`src/app/buying-paying.tsx`. No migration; SSO token unchanged.
- **Pays in:** average days from bill date to the day allocations + adjustments reach the bill's total (an undone
  payment re-opens it), last 12 months (all time with fewer than 3), "usually within" = 80th percentile; paid after the
  due date count; oldest unpaid bill (opening balances count there). **Paying slower / faster:** the last 3 bills (paid,
  or unpaid for longer than usual) against the others: ≥ 7 days and ≥ 1.5× (slower) / ≤ 0.67× (faster).
- **Orders every:** a purchase = a day with a bill or an order not billed yet; the middle gap of the last 13. **Next
  order** = last + gap (needs 3): ahead / due (within max(2, 30 %)) / late / "may have stopped" (> max(60, 3 × gap)).
- **Usual order:** products in at least half of the last 5 purchases, middle quantity. **Stopped buying:** in ≥ 3 and
  ≥ 40 % of the 10 purchases before the last 3, none in the last 3. Zoho lines without a product link count as the
  product with the same name.
- **Bills per month** April–March with last year's pale bars and a year picker (`?fy=2025`); this FY so far vs the same
  days last year; customer since; average bill (whole rupees, last 12 months).
- Left out everywhere: cancelled bills, Zoho opening balances (OB-…), ₹0 bills. Marketing staff: only bills count (they
  never see orders).
- Phones: the three boxes, the trend and the chart show; the rest is under "More". On a PC it's all open.
- Tests: `test/customer-insights.test.ts` (13 new); new checks in ledger-actions (days to pay) and customer-details (Marketing staff: bills only). Checked on `pnpm dev` (plant
  002 with Sales switched on for the check, a temporary customer with 77 sample bills; headless Chrome at 390 / 1280 px;
  all removed afterwards). Not yet seen with plant 001's real Zoho history.

## 2026-11-08 — v0.48.0: free boxes on the order (scheme, "12 + 1 free")
Owner 2026-11-08 ("build it"; plan + mock-ups `docs/FREE_BOXES_PHASE_PLAN.md`). Found on O-0100 (Bikash Kirana): the free
box could only go in the note, so the bill, the Zoho file and every box count said 12 when 13 left the plant.
- **Migration `0011_free_lines.sql`** (approved): `order_lines.free` + `bill_lines.free` (default false, so every saved
  row reads as paid). Order lines: free → `line_total = 0`, else `quantity × rate` (`order_lines_total_check`); unique
  per (order, version, product, free) (`order_lines_product_once`), so a product can be once paid and once free. Bill
  lines: free → `line_total = 0`. No grant change (both SELECT + INSERT).
- **Order form / Change** (`src/app/lines-editor.tsx`): "+ Add free boxes" below the products; a green FREE card with
  a quantity only; the total bar says "+ 1 box free". A free line's rate is what the boxes are worth: the paid line's
  rate for the same product, else the rate it started with, else 0. Any product, the same as a paid one or another.
  At least one paid line (`LinesInput`). Bot orders never send `free`.
- **Shown:** order page (FREE tag, "Boxes to load: 13 box …"), list cards and notifications ("… 1 box free"), history
  ("added … 1 box free", "(free): 1 box → 2 box"), versions, Calls tab's last order, WhatsApp copy ("1 box FREE"; the
  load totals count free boxes), owner's pending summary ("+ 1 free" under the paid quantity; rates and brand units from
  paid lines), order CSV ("Free" column at the end).
- **Make bill:** the free line comes over as is: quantity, rate = worth, discount = quantity × worth, amount 0,
  description "Free" unless typed; no line discount and no share of the bill discount; no GST. Bill page shows it with
  FREE. The Zoho file: its own row (Item Price = worth, Discount Amount = the same).
- **Reports → Sales by Item:** a "Free" column (screen and CSV) only when the period has free boxes; sold quantity and
  amounts unchanged.
- **Left out of:** the customer's last rates, "Buying & paying" (usual order, stopped buying), the bot's "repeat last
  order", the reminder text.
- Old orders unchanged: O-0025, O-0059, O-0063, O-0100, O-0105 have the free box only in the note. O-0100 (delivered,
  no open bill): Undo delivered → Change (+ 1 free Bluemins 1L) → Mark delivered → Make bill.
- Tests: `test/free-lines.test.ts` (15 new); list / brand tests updated for the CSV's Free column and `free_quantity`.

## 2026-11-08 — v0.49.0: Drop Phase 1 (switch, extra phones, login)
Owner 2026-11-08 (plan `docs/CUSTOMER_APP_PHASE_PLAN.md`, mock-ups https://claude.ai/artifact/N3Mz1ucytpBxbJqbje8ypE).
The server side of the Drop customer app's login, plus the staff screens to switch shops on. No app yet (Phase 3).
- **Migration `0012_drop_access.sql`** (approved): `app_access_changes` (Can use Drop + brands, newest row wins),
  `app_phone_changes` (extra phones, newest row per phone wins), `app_login_codes` (HMAC only; UPDATE attempts / used_at),
  `app_sessions` (token SHA-256 only; UPDATE last_seen_at / ended_at / end_reason). FORCE RLS, no DELETE. Two triggers
  (`app_phone_check`) refuse a phone on two shops (extra vs main / extra), with a transaction lock per (plant, phone).
- **Settings** (`src/server/drop/config.ts`): `DROP_APPS` = `{"<app id>": {"tenant_id", "brand"}}` (the app id → plant
  and the brand every shop sees; brands stay data), `DROP_CODE_SECRET` (≥ 32), and `"login_content_sid"` in the plant's
  `TWILIO_WHATSAPP_SENDERS` entry (`thanks.ts` reads it; a bad or reused one is named and only the login goes off).
  Broken settings switch the customer API off and show under `/health` warnings.
- **Staff:** Drop card on the customer's Overview (owner, support) and at `/customers/[id]/drop` (also Order desk, linked
  "Drop phones" on the customer list): Can use Drop, brands (Rates brands minus the main one), main + extra phones with
  last login, Add / Remove (owner + Order desk), Make main (owner: swaps with the customer's mobile, reason, audited as
  `customer.details` + `drop.make_main`; nobody logged out). Customers → **Drop shops** (owner, support): switched-on
  shops and the three pilot numbers. Access rows `drop_view`, `drop_manage`, `drop_phones`, `drop_shops`.
- **An extra phone is the same shop everywhere:** `findByPhone` = main phone, else active extra phone (bot, Calls, New
  order, customer list); `insertCustomer` returns the shop; the upload refuses such a row; the mobile Edit refuses
  another shop's extra phone (and points to Make main for this shop's own).
- **Customer API** (`/api/app/v1/*`, outside the login proxy; header `x-drop-app`): `login/start` (same answer for every
  number; a code only for an active switched-on shop's phone; 3 per 15 min / 10 a day per phone from the database; 20
  per connection an hour; the WhatsApp message goes after the answer), `login/verify` (10 min, single use, 5 wrong tries;
  90-day token `dpt_…`), `logout`, `session` (shop name, phone, brands). A session ends (with the reason) when the shop
  is switched off, the phone removed or the customer switched off. Errors `{ error: { code, message } }`, no-store.
  Logins / codes are audit rows `app.*`, kept out of Recent changes; `drop.*` shown.
- Made while building: the Drop card page for Order desk (the account page shows money, which Order desk doesn't see);
  the main brand in `DROP_APPS` (not in code); Zoho match needed no change (it goes through `insertCustomer`).
- Tests: `test/drop-access.test.ts` (9), `test/drop-login.test.ts` (11); guard lists (rls, append-only, access) and the
  thank-you settings test updated; `calls-tab.test.ts` times kept inside today's India date (failed just after midnight).
- Checked on `pnpm dev` (2026-11-09, plant 002 with Sales switched on for the check, two temporary customers, a fake
  Twilio; headless Chromium at 390 px; all rows removed and plant 002 switched back afterwards): owner switch on, Order
  desk refused the switch (403) but added an extra phone, a clash named ("already the main phone of …"); login start gave
  the same answer for the shop's extra phone, an unknown number and a shop not switched on, with one WhatsApp message
  (login template) to the first; wrong code 401, right code a 90-day token, same code again 401; session showed the
  shop; switching the shop off ended it (401). Screens matched the mock-ups (card on Overview, Add / Make main forms,
  Order desk's card page without Make main, Drop shops with the three numbers, "Drop phones" on Order desk's list).
  Found and fixed: the Drop card ran its four reads at once on one transaction (pg's "already executing" warning); now
  one after another. Dev note: `.env`'s `PLATFORM_URL` is an old LAN address (192.168.1.2); the check used localhost.

## 2026-11-09 — v0.50.0: Drop Phase 2 (customer API for Home)
Owner 2026-11-09 (plan `docs/CUSTOMER_APP_PHASE_PLAN.md` Phase 2). `GET /api/app/v1/home` (Drop session; 30 a minute per
session, 120 per connection; `no-store`), built in `src/server/drop/home.ts` field by field. **No migration, no new
setting; platform and SSO token unchanged.** Nothing calls it until the app (Phase 5).
- **Answer:** `shop { name }`, `orders` (pending = "received" with its date, delivered today with the time; per product
  `{ product, size, unit, qty, free }`, only the shop's brands; an order with none of them left out; `[]` = nothing on the
  way), `dues` (one per brand the shop sees, paise), `boxes` (`{ <main brand>: this_month / last_month with sizes,
  this_year + last_year_same_days }` or null), `support { phone, hours }` (Business details) or null, `news: null`.
  Never rates, order / bill amounts, refs, notes, history or staff names (a test searches the answer).
- **Which product a line is** (`lineMatcher` in `src/lib/brand.ts`): its product link; else (old Zoho lines) the one
  product with the same SKU code, name, or name without its brand words in front (Zoho "1L Water Bottle" → "Bluemins
  1L Water Bottle"); two fitting = none. Brand = Rates brand or the guess, as everywhere. Size from `volume_ml`.
- **Due per brand** (`src/lib/brand-due.ts`, D3): the account page's bills (`partyFacts`, now exported from
  `src/server/ledger.ts`); each bill's due split by the brands' share of its line values with GST (like Reports),
  leftover paisa to the largest share; **a bill with no line value (a Zoho opening balance) goes to the main brand**
  (owner, 2026-11-09); lines with no brand stay "Other" (never sent); the unused advance is not taken off.
- **Box totals** (`src/lib/box-totals.ts`, 18.5 / 20.3 / D4): non-cancelled bills (no opening balances) by bill date +
  delivered orders without a live bill by delivery date, each box once, free lines never; the main brand only (so
  "Bluemins 20L", Mr.Charge, Hemex don't count); this year against the same days last year (as "Buying & paying");
  null when the shop bought none of the main brand in the last 12 months.
- Made while building: `orders` is a list (`[]` for none) instead of `order | null` (a shop can have two on the way);
  the 12-month window and month / year edges use India dates.
- **Found in the live check (2026-11-09):** 38 of plant 001's orders delivered up to 5 Nov (1,429 boxes) have no bill here
  because Zoho invoiced them (not linked). They were counted twice; now a delivered order without a bill counts only
  after the plant's last Zoho invoice date (no plant or date in code). After the fix, plant 001 up to 7 Nov: 500 ml 8,576
  and 250 ml 817 = the owner's 8 Nov list exactly, no shop above the list; 1 L 17,311 vs 19,553 because the list's 1 L
  column also holds Mr.Charge / Hemex 1-litre boxes (Drop counts Bluemins only, 18.5). Every live bill line has a product
  link; nothing lands in "Other" except 20 L, connection and empties. Due per brand = the account's due for both shops.
- Tests: `test/brand-due.test.ts` (8), `test/box-totals.test.ts` (4), `test/drop-home.test.ts` (7).

## 2026-11-09 — v0.51.0: Drop Phase 3 (points)
Owner 2026-11-09 (plan `docs/CUSTOMER_APP_PHASE_PLAN.md` Phase 3, "Points tab"). **Points are completely separate from
normal billing** (owner): nothing writes to orders, order lines or bills.
- **Migration `0013_drop_points.sql`** (approved): `points_settings` (dated history; start date, ₹ per point, late days,
  poll points, redeem months, rewards) and `points_redemptions` (free boxes asked; the order link and a staff
  cancellation each set once, trigger `points_redemptions_set_once`; UPDATE only on those columns). FORCE RLS, no DELETE.
  No existing table changed.
- **Rules** (`src/lib/points.ts`, pure): PlantOps bills from the start date (never Zoho), the main brand's value before
  GST after discounts (GST bills: `taxable`; others: line totals × (sub-total − discount) ÷ sub-total); each allocation of
  a payment earns allocation × value ÷ bill total ÷ ₹ per point (hundredths, shown rounded down); **no points when the
  payment's date is more than `late_days` (5) after the delivery** (owner: bills take 2–3 days; a bill without an order:
  its bill date); earned on the allocation date (₹ per point and points year of that day); cancelled payments / bills
  earn nothing. Points year 1 Feb – 31 Jan, the first to the first 31 Jan at least 6 months after the start (Nov 2026 →
  31 Jan 2028). Days before the first settings row use the first row. A request's state comes from its order: asked → on
  the way (order pending) → delivered (spent) | returned (order cancelled or staff cancel); undo delivered puts it back.
- **Staff:** Customers → **Drop points settings** `/customers/drop/points` (owner; support reads; history) and **Free
  boxes asked** `/customers/drop/rewards` (owner + Order desk: cancel with a reason). New order shows "🎁 Free box asked"
  with a tick (attached in the order's own transaction); the order page has "Add to this order"; the order page, list
  cards and WhatsApp copy (and its load totals) show "Points reward: … × 1 free"; never on Make bill or a bill. Balance
  and the open request on the Drop card. Access rows `drop_points_view`, `drop_points_settings`, `drop_rewards_view`,
  `drop_rewards`. Recent changes `drop.points_settings`, `drop.reward_add`, `drop.reward_cancel`.
- **App:** `GET /api/app/v1/points` (balance, ends on, rewards with can-use / why not, open request, monthly record:
  purchases, polls, each free box; never bills or amounts), `POST /api/app/v1/points/redeem` `{ reward, request_key }`
  (per-shop lock; repeated key = same request; 409 with a plain reason). Home gains `points { balance, next }` (null
  while off). Kind `order_capture.drop_redeem` (owners + ticked Order desk, push) in `packages/types`: **the platform
  needs deploying with this release.**
- Made while building: the screens live under Customers (next to Drop shops); error codes `not_offered` / `not_allowed`;
  the pending summary is unchanged (rewards have no value).
- Tests: `test/points-lib.test.ts` (10, a hand-worked year), `test/drop-points.test.ts` (7); guard lists updated. Sales
  989, platform 426. Checked on `pnpm dev` (plant 002, temporary shop with a paid ₹2,000 bill, all removed after):
  settings saved, 2,000 points, ask → 1,200 + the owner's bell, New order offered it, order saved at ₹300 with the
  reward beside it, order page / list / both staff pages, delivered = spent.

## 2026-11-09 — v0.52.0: Drop Phase 4 (polls)
Owner 2026-11-09 (plan `docs/CUSTOMER_APP_PHASE_PLAN.md` Phase 4, "Polls tab").
- **Migration `0014_drop_polls.sql`** (approved): `polls` (question, 2–6 choices, Other box, brands, open / close
  times; UPDATE only on the early close, set once by trigger `polls_closed_once`) and `poll_answers` (one per shop per
  poll, never changed; choice −1 = Other with its text; points and reason decided when saved). FORCE RLS, no DELETE.
- **Rules** (`src/lib/polls.ts`): open from opens_at to closes_at unless closed early; poll points = the settings' poll
  points only when points are on, it is the shop's first counted answer this week (Monday–Sunday, India) and the shop had
  an order delivered in the last 30 days; else 0 with `week_used` / `no_recent_order` / `points_off`. **Buying size**
  (owner, 2026-11-09): main-brand boxes in the 3 months before the poll opened, small < 10, medium 10–49, large 50+.
- **Owner:** Customers → **Drop polls** `/customers/drop/polls` (list, + New poll: opens on a day (today = now), closes at
  the end of a day, brands from Rates) and a poll's page (bars per choice, Other texts, by buying size, by place, Close
  now, CSV: one row per answer with the shop's real main-brand boxes per product). Support reads; Order desk none.
  Access rows `drop_polls_view`, `drop_polls`; Recent changes `drop.poll_add`, `drop.poll_close`, `export.poll_csv`.
- **App:** `GET /api/app/v1/polls` (points each, this week counted, open unanswered polls of the shop's brands, answered
  count / points; never results) and `POST /api/app/v1/polls/:id/answer` `{ choice, other? }` (per-shop lock; 201 with
  the points and a thank-you text). Poll points now count in the Points tab, Home and the Drop card.
- Shared: `src/server/drop/boxes.ts` (plant-wide boxes per shop like Home; `zohoUntil` now shared with Home).
- Tests: `test/polls-lib.test.ts` (5), `test/drop-polls.test.ts` (6); guard lists updated.
