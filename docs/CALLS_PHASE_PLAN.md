# Phone Calls in Order Capture: Phase Plan and Build Prompts

**Status:** Design, mock-ups and every open point agreed with the owner on 2026-11-04 (in chat). **Phases 1–4 built
2026-11-04** (one dated note per phase in `apps/order-capture/NOTES.md`); **Phase 5 (release v0.36.0, deploy,
MacroDroid) in progress.** Decided while building (owner, 2026-11-04): Delivery staff + Plant staff = Calls only; a new
caller's number is shown in the "Customer called" alert.
The mock-ups don't show the owner's "Not an order number" page and button; this plan's text is the source for those.

## Purpose

Customers order 20 L jars by **calling the plant's order number** (a normal SIM in an Android phone, not a business
calling service). **The order number is the owner's own number, and MacroDroid goes on the owner's own phone** (owner,
2026-11-04), so personal calls ring the same phone (kept out by the "Not an order number" list). Today nothing records those calls.
With this plan:

- **every ring to the order phone is recorded in Order Capture** (number, time, missed or not), so the owner can see how
  many calls came in, from how many people, and who rang several times
- a new **Delivery staff** person calls the customer back and taps **Attended**. For a **new number** they first type
  the **name and place**, which adds the caller to Order Capture's **customer list** (the plant's CRM grows from the
  calls)
- **orders stay as they are:** entered on New order by the owner or Order desk. A call is not linked to an order

**Mock-ups** (6 phone screens, 2026-11-04): https://claude.ai/artifact/DsMg36uuz6hgbMBEZUoY3o (private to the owner).
Screens follow them.

**How a call reaches PlantOps:** IFTTT can't do it (it removed Android call triggers in 2019; iPhones never allowed it).
**MacroDroid** (free, Android) on the order phone sends each incoming and missed call to an Order Capture address with a
key that can only add a call.

## Names used in this plan

| Thing | Value |
|---|---|
| New role | `delivery_staff` (label "Delivery staff"), Order Capture only |
| New address (order phone → Order Capture) | `POST /api/calls/v1` on `orders.bluemins.life` |
| Phone key | `occ_` + 32 random bytes base64url (43 chars), like the bot's `ocb_` |
| Server setting | `ORDER_CALL_KEYS` on `order-capture` (JSON list: `id`, `tenant_id`, `sha256`, `label`) |
| Key command | `pnpm --filter order-capture call:key` |
| Platform migration | `apps/platform/db/migrations/0021_delivery_staff.sql` |
| Order Capture migration | `apps/order-capture/db/migrations/0007_calls.sql` |
| Screens | Calls tab `/calls`, owner's numbers `/calls/numbers` |
| Release | v0.36.0 (one release for all phases) |

## Agreed design (owner, 2026-11-04)

### Who uses it
| Person | Calls tab | Mark Attended / save a new caller | Owner's numbers | Orders |
|---|---|---|---|---|
| **Owner** | ✅ | ✅ | ✅ | as today |
| **Order desk** | ✅ | ✅ | ❌ | as today |
| **Delivery staff** (new) | ✅ (the only tab they see) | ✅ | ❌ | ❌ none: no list, no amounts, no delivering |
| **Order viewer / Plant staff** | ❌ | ❌ | ❌ | view without amounts, as today |
| **PlantOps support** | read-only, page views logged | ❌ | read-only | as today |
| Anyone else | ❌ | ❌ | ❌ | ❌ |

- `delivery_staff` goes in `ROLE_MODULE` (→ `order_capture`), so `roleWorksIn` is true there and nowhere else. Plant
  staff are not affected (`PLANT_STAFF_MODULES` unchanged).
- Delivery staff can't rename a known customer from Calls. Names are fixed on Customers by the owner / Order desk, as today.
- A Delivery-staff-only user skips the launcher and lands on `/calls`.
- **Alerts:** Delivery staff get the "Customer called" alert automatically (section "Notifications"). The "Gets Order
  Capture alerts" tick box is not offered for them (`getsAlertsIn` false), because Order Capture's other alerts carry
  amounts.
- Order Capture's one access table (`src/server/access.ts`) gains `Who = "delivery"` and three actions: `calls_view`
  (owner, desk, delivery, support), `calls_attend` (owner, desk, delivery), `calls_numbers` (owner, support). Every other
  action leaves `delivery` out, so all order and customer routes refuse it (403) on the server.

### Recording a call (Order phone → Order Capture)
- MacroDroid on the **owner's own phone** (the order number). Triggers **Call incoming** and **Call missed**, "Any
  number" (personal numbers are dropped by the "Not an order number" list) → HTTP POST `/api/calls/v1`,
  `Authorization: Bearer occ_…`, body `{ "phone": "<caller number>", "event": "incoming" | "missed" }`.
- The plant comes from the key's entry in `ORDER_CALL_KEYS`, never from the request. Only the key's SHA-256 is stored.
  The key can only add call events: no reads, no customers, no orders.
- **One ring, never counted twice:**
  - `incoming` = a new ring.
  - `missed` = marks the newest `incoming` ring from the same number in the last 3 minutes as missed. With no such ring
    (MacroDroid lost the first one) it is its own ring, missed.
  - The same number + event within 60 s is a repeat send (MacroDroid retry) and is ignored. It answers 200 so the
    phone stops retrying.
- **Numbers:** an Indian mobile is stored normalised (`normalisePhone`, 10 digits). A landline is stored as its digits
  (≤ 15). A hidden / empty number is stored as `hidden`. Only Indian mobiles can be saved as customers.
- Limits: 30 events a minute per key (429 after). Unknown key 401 (and 10 failures a minute per address → 429). Plant
  without Order Capture → 403. Body ≤ 1 KB JSON. Errors are `{ error: { code, message } }`, like the bot API.
- The address sits outside the session proxy, like `/api/bot/v1/*`.
- Stored: number, event, time, key id. Never the call audio, contacts or anything else from the phone.

### Calls tab (mock-up screen 4)
- Top line: "Today so far: N calls from N numbers · N waiting".
- **Waiting:** one card per number with rings after its last Attended, oldest waiting first. Each card shows:
  - the customer's name / place if the number is in the customer list, else "New number"
  - every waiting ring (time, "missed" in red) and "rang N times"
  - the last delivered order's products and quantities (no amounts)
  - 📞 (a `tel:` link, also shown as text), and the action:
    - **known customer** (switched-on or off): **✓ Attended**
    - **new Indian mobile:** Name (2–80) + Place (2–200, required, as in the customer list) → **✓ Attended · save
      customer**, plus a small link **"Wrong number, don't save"** (attended without a customer)
    - **landline / hidden:** **✓ Attended** only
- **Attended today:** name / number, number of calls, who attended and when.
- Attended covers **all** of that number's rings up to that moment. A later ring shows as waiting again.
- Two people tapping at once: the second gets "Already attended by Raju at 10:33" (409 when the number has no waiting
  ring left). If a ring arrived meanwhile, the second tap covers it.
- Saving a new customer uses the customer list's own rules (one customer per phone per plant). If someone added that
  phone in the meantime, Attended still saves and links to the existing customer (no second customer).
- Refreshes every 30 s while open.

### "Not an order number" list (owner only; owner 2026-11-04)
The order number is the owner's own phone, so family, supplier and staff calls must be kept out.
- **Owner page** `/calls/ignored` (link from the Calls tab, owner only): the list (number, label such as "Brother", who
  added it and when), **+ Add number** (number + label ≤ 40), **Remove** per row.
- **On a call card** (owner only): **"Not a customer, never show again"** with a label box. It adds the number to the
  list and closes its waiting rings. Delivery staff and Order desk never see this button or the list (their way to
  close a stranger is "Wrong number, don't save"). The labels can be private, so the list is owner-only.
- **On arrival:** a call from a listed number is **not stored at all**: no ring, no count, no alert. MacroDroid gets
  200 `{ "ignored": true }` so it doesn't retry.
- **Rings stored before the number was added** are left out of the Calls tab, the numbers page and the tiles from then
  on, so a personal call doesn't stay in the counts. Removing the number from the list brings them back.
- A number that is also a customer can be added (the page warns "This is customer Ramesh Sahoo"). The customer
  itself isn't changed.
- Mobile numbers are matched in any spelling (`normalisePhone`); landlines by their digits. Hidden numbers can't be
  listed.
- Every add / remove is audited and shown in Recent changes ("Number 98xxx added to Not an order number by Sujata").
- Tests: listed number dropped on arrival (nothing stored, no alert), earlier rings hidden from Calls / numbers / tiles
  and shown again after Remove, owner-only page and button (Order desk, Delivery staff, support write refused; support
  reads), any spelling matches, audit rows, tenant isolation.

### Owner's numbers (mock-up screen 5, owner + support)
- Today / This week / a month / Pick dates (India dates).
- Definitions (shown on the page):
  - **Calls** = rings (a missed call is one ring)
  - **Missed** = rings marked missed
  - **Numbers** = different numbers that rang
  - **Attended** / **Waiting** = numbers handled / not handled yet, for that period (attended + waiting = numbers)
  - **New** = callers saved to the customer list from Calls
- By-day table, "Rang most" (top 10 numbers in the period), "Attended by" (person → numbers attended).
- Read live, nothing stored.

### Launcher tiles (`summaryFor`)
- **Owner:** "N pending" · "N pending over 2 days" · "N calls today · N waiting" (replaces "N new today", owner OK).
- **Delivery staff:** "N waiting" · "N calls today". The platform sends them the `desk` view: `delivery_staff` is added
  to `DESK_ROLES` for `order_capture`.
- **Order desk:** unchanged.
- Delivery staff tile text "Calls"; their landing path `/calls`.

### Notifications (N5+; owner 2026-11-04: Delivery staff must get them)
The order phone is the owner's own phone, so Delivery staff are usually elsewhere and need an alert to call back.
- **Kind** `order_capture.call`, label "Customer called", **phone + bell**, not urgent (each person can set Bell only / Off
  on `/notifications`). In `NOTIFICATION_KINDS` with `roles: ["delivery_staff"]` and `noOwners: true`, like
  `attendance_salary.scan`: owners never get it (their phone already rang).
- **Who:** every active Delivery staff person of the plant, automatically, no tick box (`also_user_ids` + `only_listed`,
  each re-checked by the platform). Order desk does not get it.
- **Text:** "Missed call: Ramesh Sahoo (Kuakhia)" / "Call: New number 70081 44562". A second alert for the same waiting
  number says "· rang 3 times". Link `/calls`. No amounts, no order details.
- **When (so 3 quick rings don't buzz 3 times):** when a number becomes waiting (its first ring after the last Attended),
  and again for the same waiting number only if 10 minutes have passed since its last alert. Dedupe key
  `call:<phone>:<first ring id>` / `…:<n>`.
- Sent after the answer to MacroDroid, never blocking it; through the existing `notification_outbox` and
  `kit.retryOutbox` when the platform is unreachable.
- Tests: recipients (Delivery staff only, not owners, not Order desk, not another plant), first-ring alert, the
  10-minute rule, a ring after Attended alerts again, text without amounts, outbox retry.

### Audit and Recent changes
- Each Attended is one audit row (`call.attended`, `call.attended_new_customer`, `call.wrong_number`). A new customer
  also writes the usual `customer.created` row, so it shows in Recent changes.
- Call events from the phone are their own record: no audit row each, no Recent changes line. Refused key attempts
  are logged to the server log only (no phone numbers).

### Not in v1
Linking calls to orders, "Make order" from a call, call alerts for owners / Order desk, renaming customers from Calls, call recording,
iPhone, business calling services (Exotel etc.).

## Decided before building (all confirmed by the owner, 2026-11-04)
1. ✅ **"Wrong number, don't save"** link on a new number (owner OK, 2026-11-04).
2. ✅ **Owner's tile:** the calls badge replaces "N new today" (owner OK, 2026-11-04).
3. ✅ **Delivery staff get notifications** (owner, 2026-11-04): alert on the first ring of a waiting number, again after
   10 minutes if still waiting; owners and Order desk not alerted (design in "Notifications").
4. ✅ **Personal calls on the owner's phone:** option **B**, a "Not an order number" list in PlantOps (owner,
   2026-11-04). MacroDroid sends every call ("Any number"), and customers can stay saved in the phone's contacts.
   Design in "Not an order number list" below. (Option A, MacroDroid's "Non-contacts" filter, was not chosen: it would
   skip customers saved as contacts.)

## Database (agreed in principle; each migration shown to the owner before it runs)

**Platform `0021_delivery_staff.sql`:** `insert into platform.roles (id, module_id, label) values ('delivery_staff',
'order_capture', 'Delivery staff')`. No new table, no grant change.

**Order Capture `0007_calls.sql`:** three new tables. Both have `tenant_id` and the `tenant_isolation` policy with FORCE
RLS. `order_app` gets SELECT + INSERT only (no UPDATE / DELETE: append-only). No existing table is changed.
- `call_events`: `id`, `tenant_id`, `key_id` (uuid of the key entry), `phone` (text: 10-digit mobile, landline digits or
  `hidden`), `event` (`incoming` / `missed`, check), `ring_id` (for `missed`: the ring it marks, else null), `created_at`.
  Index `(tenant_id, phone, created_at)` and `(tenant_id, created_at)`.
- `call_attended`: `id`, `tenant_id`, `phone`, `upto` (covers that number's events with `created_at <= upto`),
  `outcome` (`known` / `new_customer` / `wrong_number`, check), `customer_id` (null for wrong number / landline),
  `attended_by`, `attended_by_name`, `created_at`. Index `(tenant_id, phone, created_at)`.
- `ignored_number_changes` ("Not an order number" list, kept as a history so nothing is ever deleted): `id`,
  `tenant_id`, `phone`, `action` (`add` / `remove`, check), `label` (≤ 40, required for `add`), `changed_by`,
  `changed_by_name`, `created_at`. A number is on the list when its newest row is `add`. Index `(tenant_id, phone,
  created_at)`.
- Customer rows are added to the existing `customers` table with the existing grants and checks.

## Phases

| Phase | What | Release |
|---|---|---|
| 0 | Design and mock-ups | done 2026-11-04 |
| 1 | Platform: the Delivery staff role | v0.36.0 |
| 2 | Order Capture: database, phone key, recording calls | v0.36.0 |
| 3 | Order Capture: Calls tab and Attended | v0.36.0 |
| 4 | Order Capture: owner's numbers, tiles, support | v0.36.0 |
| 5 | Release, deploy, MacroDroid on the order phone | v0.36.0 |

### Phase 0: Design and mock-ups (done 2026-11-04)
Design agreed in chat; mock-ups linked above; all four points in "Decided before building" confirmed.

### Phase 1: Platform, the Delivery staff role
- Migration `0021_delivery_staff.sql` (show first; dev + test databases).
- `packages/types`: `ROLE_IDS`, `ROLE_MODULE` (`delivery_staff → order_capture`), `DESK_ROLES.order_capture =
  ["delivery_staff"]`; `getsAlertsIn("delivery_staff", "order_capture")` false; `NOTIFICATION_KINDS`
  `order_capture.call` (`roles: ["delivery_staff"]`, `noOwners: true`), so it shows in Delivery staff's settings only.
- Platform: role label, role button text "Order Capture · Calls only", Permissions screen "Delivery staff · Calls
  only" (no 🔔), no "Gets alerts" tick box for it (form and API refuse it), launcher tile text "Calls" for a
  Delivery-staff-only person, landing straight in Order Capture.
- Tests: `roleWorksIn` / `viewOnlyIn` / `getsAlertsIn` for the role; the tick box refused; Permissions grid; launcher
  tile and single-module landing; the summary request carries `view: "desk"` for Delivery staff.

### Phase 2: Order Capture, database, phone key, recording calls
- Migration `0007_calls.sql` (show first; dev + test).
- `ORDER_CALL_KEYS` parsing like `botKeys()` (a broken value turns the call address off, logged and listed under
  `/health` warnings, never half on); `db/new-call-key.ts` + `call:key` script printing the key once and the JSON entry
  to paste (the **complete** `ORDER_CALL_KEYS` value, per the config rule in `docs/STABILITY_PLAN.md` section 6 item 5).
- `src/server/calls.ts`: record an event with the ring rules above; `POST /api/calls/v1` outside the session proxy;
  the "Customer called" alert after the answer (section "Notifications"), through the outbox; a number on the
  "Not an order number" list is dropped before anything is stored.
- `access.ts`: `Who = "delivery"` and the three actions; `session.ts` maps the role; check every existing route
  refuses `delivery`.
- Tests: key missing / wrong / removed (401), auth-failure limit, plant without Order Capture (403), tenant isolation
  (key of plant A can't write or be read by plant B; FORCE RLS guard counts the new tables), incoming / missed join,
  lone missed, 60 s repeat ignored, 30 / minute limit, number forms (mobile with +91 / 0, landline, empty → hidden),
  body too big / not JSON, append-only refusals for `order_app`, every order / customer route refuses Delivery staff.

### Phase 3: Order Capture, Calls tab and Attended
- `/calls` page and `POST /api/calls/attend` (`{ phone, upto, name?, place?, wrong_number? }`, server re-reads the
  waiting rings; `upto` from the page to detect a stale tap).
- Header tabs: Delivery staff see only Calls. The owner / Order desk see Calls next to the existing tabs.
- The "Not an order number" list: owner page `/calls/ignored`, the owner's "Not a customer, never show again" button,
  rings of listed numbers left out everywhere (section "Not an order number list", with its tests).
- New customer through the customer list's own create rule (same checks, one per phone), inside the same transaction
  as the Attended row.
- Tests: waiting / attended grouping, a ring after Attended is waiting again, known / new / wrong number / landline
  paths, name and place rules, phone already added meanwhile, two taps at once (409), Delivery staff can't rename, last
  order shown without amounts, Order viewer / Plant staff refused, support read-only (POST refused, view logged).

### Phase 4: Order Capture, owner's numbers, tiles, support
- `/calls/numbers` with the definitions above; Today / week / month / dates (India dates).
- `summaryFor`: the owner's calls badge (replacing "N new today"); the `desk` view for Delivery staff.
- Support view of Calls and numbers: read-only, page views on the owner's Support access page.
- Tests: the numbers on a worked example (the mock-up's day: 12 calls, 5 missed, 8 numbers, 7 attended, 1 waiting, 2
  new), period boundaries at India midnight, tile badges for owner / Delivery staff / Order desk, numbers page refused
  for Order desk and Delivery staff.

### Phase 5: Release, deploy, MacroDroid
- Release notes, `apps/order-capture/NOTES.md` dated note, CLAUDE.md status note, `docs/HANDBOOK.md` section "Order
  Capture: phone calls" with the **MacroDroid steps**:
  1. install MacroDroid
  2. allow phone and call log
  3. battery saving off
  4. macro with the two triggers ("Any number") + the HTTP action (address, header, body with `[call_number]`), retry
     on failure
  5. a test call from another phone
- Deploy: migrations platform `0021` and Order Capture `0007`; `ORDER_CALL_KEYS` on `order-capture` (complete value);
  deploy platform + order-capture; checks: `/health`, `/api/calls/v1` 401 without a key, a test call from the owner's
  phone appears on Calls. Record in `docs/deployments/shared.md`. No new Railway service.
- Owner's checklist at plant 001: give one person Delivery staff, set up MacroDroid on the order phone, ring it (answer
  once, miss once), check Delivery staff got the alert, attend a known and a new number, add a family number to "Not an
  order number" and ring again (nothing appears), check the numbers page and both tiles.

## Build prompts

### Shared header (each phase prompt's first line points here; no need to paste it)
```text
We are adding phone calls to Order Capture with a new Delivery staff role. The agreed design is
docs/CALLS_PHASE_PLAN.md (owner, 2026-11-04): read it fully, plus CLAUDE.md and apps/order-capture/NOTES.md, before
anything else. The screens follow the mock-ups linked at the top of the plan. Reuse what exists: the bot API's key
handling and error shape (apps/order-capture/src/server/bot.ts), the one access table (src/server/access.ts), the
customer list's create rule (src/server/customers.ts), normalisePhone (packages/module-kit/src/phone.ts). Apps import
shared code only from packages/*.

Rules: start in plan mode and wait for my approval; show every migration before running it; ask before any change to
schema, permissions, tenant isolation or the SSO token that is not already in the plan; the plant comes from the key or
the session, never from the request; enforce access on the server; no secrets in code, docs or tests. Write tests with
the feature (real Postgres test database). Explain each change in plain language; I am not a full-time developer. At
the end of the phase run the tests of every touched app, typecheck and build, and add a short dated note to
apps/order-capture/NOTES.md. Don't commit until I say so.

Keep it minimal: a call = number, event, time; Attended = who, when, which customer. Calls are not linked to orders.
One alert kind, order_capture.call, to Delivery staff only (plan section "Notifications").
```

### Phase 1 prompt
```text
Before anything else, read the "Shared header" in docs/CALLS_PHASE_PLAN.md (Build prompts section) and follow it for
this whole session.

Build Phase 1 (Platform, the Delivery staff role) of docs/CALLS_PHASE_PLAN.md:
- platform migration 0021_delivery_staff.sql adding role delivery_staff for order_capture (show it first; dev + test)
- packages/types: ROLE_IDS, ROLE_MODULE (delivery_staff → order_capture), DESK_ROLES.order_capture = ["delivery_staff"],
  getsAlertsIn false for it; plant staff rules unchanged
- platform: role label and button text, Permissions screen line without 🔔, no "Gets alerts" tick box (form and API),
  launcher tile text "Calls" and single-module landing for a Delivery-staff-only person
Tests: as listed under Phase 1 in the plan. Then verify on pnpm dev with plant 002 (temporary user, removed after).
```

### Phase 2 prompt
```text
Before anything else, read the "Shared header" in docs/CALLS_PHASE_PLAN.md (Build prompts section) and follow it for
this whole session.

Build Phase 2 (Order Capture: database, phone key, recording calls) of docs/CALLS_PHASE_PLAN.md:
- Order Capture migration 0007_calls.sql exactly as in the plan's Database section (show it first; dev + test)
- ORDER_CALL_KEYS parsing like botKeys(), /health warning when broken, db/new-call-key.ts + "call:key" script that prints
  the key once and the complete ORDER_CALL_KEYS value
- src/server/calls.ts with the ring rules (incoming = ring, missed joins the newest incoming within 3 minutes, 60 s
  repeats ignored, number forms, limits) and POST /api/calls/v1 outside the session proxy
- access.ts: Who "delivery" + calls_view / calls_attend / calls_numbers; session.ts maps delivery_staff; every existing
  order and customer route refuses delivery
Tests: as listed under Phase 2 in the plan. Then verify on pnpm dev with curl and a test key (removed after).
```

### Phase 3 prompt
```text
Before anything else, read the "Shared header" in docs/CALLS_PHASE_PLAN.md (Build prompts section) and follow it for
this whole session.

Build Phase 3 (Order Capture: Calls tab and Attended) of docs/CALLS_PHASE_PLAN.md:
- /calls page per mock-up screen 4: waiting cards (rings, rang N times, known customer or New number, last delivered
  order without amounts, call link), Attended today, 30 s refresh
- POST /api/calls/attend: known / new customer (name + place, through the customer list's create rule, same
  transaction) / wrong number / landline-hidden; stale tap 409 "Already attended by …"
- header tabs: Delivery staff see only Calls
- the owner-only "Not an order number" list: /calls/ignored, the card button, listed numbers left out everywhere
Tests: as listed under Phase 3 and "Not an order number list" in the plan. Then verify on pnpm dev at 390 px in headless Chromium with plant 002
(temporary users, test calls sent with curl; all removed after).
```

### Phase 4 prompt
```text
Before anything else, read the "Shared header" in docs/CALLS_PHASE_PLAN.md (Build prompts section) and follow it for
this whole session.

Build Phase 4 (Order Capture: owner's numbers, tiles, support) of docs/CALLS_PHASE_PLAN.md:
- /calls/numbers per mock-up screen 5 with the plan's definitions (owner + support only)
- summaryFor: owner badges (calls badge replaces "N new today"), desk view for Delivery staff, Order desk unchanged
- support view of Calls and numbers, read-only and logged
Tests: as listed under Phase 4 in the plan, including the mock-up's worked day. Then verify on pnpm dev (tiles through
the platform, numbers page at 390 and 1280 px; test data removed after).
```

### Phase 5 prompt
```text
Before anything else, read the "Shared header" in docs/CALLS_PHASE_PLAN.md (Build prompts section) and follow it for
this whole session.

Do Phase 5 (Release, deploy, MacroDroid) of docs/CALLS_PHASE_PLAN.md:
- release v0.36.0: NOTES.md, CLAUDE.md status note, docs/HANDBOOK.md "Order Capture: phone calls" with the MacroDroid
  steps, deploy record
- give me the deploy steps one at a time and wait for each: migrations platform 0021 and Order Capture 0007, the
  complete ORDER_CALL_KEYS value, deploy platform + order-capture (production only after I say so), live checks
- then walk me through the MacroDroid setup and a test call, and the owner's checklist in the plan
```
