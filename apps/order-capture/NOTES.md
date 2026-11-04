

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
