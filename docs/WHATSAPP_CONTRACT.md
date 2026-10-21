# WhatsApp bot ↔ Order Capture — current state, owner checklist, contract, texts

**Step 0 of `docs/WHATSAPP_BUILD_PLAN.md`. Status (2026-10-21): signed off by the owner (contract section 3); Step 0
done.**
Written from the code only: bot `~/projects/order_handoff` at `main` `f8a127b` (same code as `production` `d17d983`;
only docs differ), PlantOps `main`. No live service was called and no secret was read.

How to review: section 2 has a question per row with my recommendation; write your answer in the "Owner answer"
column (or tell me and I record it). Sections 3 and 4 are drafts to approve or change. Section 5 lists every approval.

**Owner decisions so far (2026-10-20):**
- **No price in the bot.** The bot never shows a rate or total; once the order is in Order Capture, staff call the
  customer and agree the price (then Change the order if needed).
- **Feedback flow: later phase.** Left as it is today (incl. `Tool_Catalog` links); not part of Steps 1–4.
- **"Not great" feedback alerts the order taker and the owner** by app notification (bell + phone).
- **`Message_Logs` keeps full messages until deleted** by hand; no automatic removal.
- **Support contact** (number + hours the bot gives) is set by the owner in **Business details** (platform), not in
  the bot, as **separate fields for the WhatsApp chatbot** ("WhatsApp bot support number", "WhatsApp bot support
  hours"), apart from the plant's own phone. Needs a platform schema change (`tenant_profiles`; migration shown before
  it is written).
- **English only for now; the English texts in section 4 are approved** (2026-10-20). Odia added later in the same
  place, from the approved English.
- **Area list:** the owner and the Order desk edit it; a customer who picks "Other" (village not listed) goes to staff,
  never refused automatically.
- **Rate on a bot order:** the default rate in Order Capture → Rates, else ₹0; staff agree the price by phone.
- **Order limit:** 200 boxes per product per WhatsApp order; larger orders (incl. the estimator) go to staff.
- **Opt-in:** asked once by the bot right after a confirmed order; consent stored in Order Capture (schema change,
  Step 4). **Retention:** consent forever; `Message_Logs` and feedback comments until deleted by hand.
- **Step 1 clean-up approved:** delete `data/faq.json`, rewrite `README.md` from the real code, remove `uuid`.
- **Unknown numbers** stay a lead in the Sheet; staff call back. **Bot orders** show "Entered by: WhatsApp" (no
  `source` column). **After Step 3** the bot stops writing `Orders` for matched customers; `Customers` stays as
  read-only history.
- **"Talk to a person" also alerts the owner and the order taker**, like "Not great" (3.11).
- **One Twilio number** sends the thank-you and runs the bot; its inbound webhook points at the bot (owner checked).
- **Products:** only Bluemins 1L / 500ml / 250ml (`PV_BM_1`, `PV_BM_500`, `PV_BM_250`; already set in PlantOps,
  12 / 24 / 35 per case). Mr.Charge, Hemex and empty bottles are never sold through the bot.
- **Plant 001 only** (tenant id `950ea907-0a74-48f6-aaaa-5308424049b4`, read-only lookup 2026-10-20).
- **Bot key in a Railway variable** (`ORDER_BOT_KEYS` hash on `order-capture`), no table.
- **Area list in Order Capture** (schema change; migration shown before it is written).

---

## 1. Current-state map

### 1.1 The bot (`src/server.js`, `src/feedback-flow.js`)

**Webhook:** `POST /whatsapp/inbound` (form body from Twilio). **No Twilio signature check.** Order of work per
message: MessageSid dedupe → read session → log to `Message_Logs` (not awaited) → stage branch. Any error → HTTP 500
(Twilio then retries, but the MessageSid is already claimed, so the retry is dropped and the customer gets nothing).
Other routes: `GET /health`, static `/estimate.html` and `/tds-and-water.html`.

**Entry words** (only when there is no session; all regex prefix matches, case-insensitive):

| Customer sends | What happens |
|---|---|
| `feedback` (exact) | feedback flow |
| starts with `estimator` | `Leads` row `estimator_inquiry`; estimator template sent |
| the estimator page's pre-filled text (`SKU:` + `Boxes:`) | cart = that size × boxes → checkout |
| starts with `hi` / `hello` / `hey` | `Sessions_Log` "intro"; intro template (buttons). No stage is set |
| starts with `Order` | stage `picking_sku`; product-picker template |
| anything else | "Say 'Hi' to start placing an order." |

The intro template's buttons presumably send `Order` / `feedback` / `estimator` as text (the code has no intro stage);
**to confirm in the Twilio Content Template.**

**Open (owner, 2026-10-20): the owner shares the six live Twilio Content Templates at the start of the next session**
(name, type, body, each button's text **and ID**, from the edit view): `CONTENT_SID_INTRO`, `_SKU_PICKER`,
`_ADD_MORE`, `_ESTIMATOR`, `_FEEDBACK_RATING`, `_FEEDBACK_INTEREST`. Record them here and check the IDs against the
code (`PV_BM_1/500/250`, `add_more` / `order_done`, `great` / `okay` / `not_great`, the intro buttons).

**Owner (2026-10-21): only the ordering templates for now;** `_FEEDBACK_RATING` and `_FEEDBACK_INTEREST` are left for
later. `_ESTIMATOR`: as used in the bot code (sent on "estimator"; the calculator's message is parsed by
`parseEstimatorHandoff`).

**Templates received (2026-10-21):**

| Variable | Name | SID | Type / category | Status | Body | Buttons (text → ID) |
|---|---|---|---|---|---|---|
| `CONTENT_SID_INTRO` | `greetings_bluemins` (language set to English (EN)) | `HXb163de4948654960767097319a0bc683` | Text / Utility | Approved (updated 2026-09-24) | Odia welcome to Bluemins (250 ml, 500 ml, 1 L boxes); type "Order" to order; type "Feedback" to give feedback; the rest is scrolled off in the screenshot | **none** (Text type) |
| `CONTENT_SID_SKU_PICKER` | `copy_skupicker_odia` (language set to English (EN)) | `HX11c124d15e01ed552e058c1f4872cd80` | Quick reply / Marketing | Approved (updated 2026-09-24) | ଆଜ୍ଞା କୁହାର... ଆପଣଙ୍କୁ କେଉଁ ଟା ଦରକାର ଅଛେ ଯେ ବାଛି ଦଉନ ବଟ୍‌ନ ଛି ନଉନ ଅଡର କରବାର ଲାଗିର୍ ‖ (copied from the screenshot, check against the Console) | "1L - ବକ୍ସ (12) ଟା" → `PV_BM_1`; "500ml ବକ୍ସ ( 24 ଟା)" → `PV_BM_500`; "250ml ବକ୍ସ ( 35 ଟା)" → `PV_BM_250` |
| `CONTENT_SID_ADD_MORE` | `add_more_odia` (language set to English (EN)) | `HX9fffd021393694b6cd9ea4e08965368f` | Quick reply / Marketing | Approved (updated 2026-09-24) | ଆଉ କିଛି ଲାଗବା କାଲେ....? କି ଅପଣଂକର ସବୁ ହେଇଗଲା! (copied from the screenshot) | "ଆଉ ଲାଗବା" → `add_more`; "ଆଉ ନାହିଁ ଲାଗେ କିଛି" → `order_done` |

- **Intro has no buttons** (answers the "to confirm" above): the customer **types** "Order" or "Feedback", matched by
  the bot's text rules. There is no `estimator` choice in the intro.
- **The IDs must be `PV_BM_1` / `PV_BM_500` / `PV_BM_250`** (bot `src/server.js:608`). Otherwise the bot falls back to
  the button **text**, and its English-only aliases don't match the Odia labels, so every tap would be refused. IDs to be
  read from the template's Details tab. **Owner (2026-10-21): the IDs are the ones the bot code uses**; Step 1's live
  check confirms one real tap of each button.
- **Same for Add more:** the IDs must be `add_more` / `order_done` (bot `src/server.js:651`); the text fallback
  (`resolveAddMoreIntent`) knows English words only.
- Category **Marketing**: a marketing template sent to the customer as a reply. It works inside the 24 h window; check
  in Step 1 whether a Utility category or a plain in-session quick-reply message fits better (cost, opt-in).

**Order stages:**

| Stage | Accepts | Reply |
|---|---|---|
| `picking_sku` | button `PV_BM_1` / `PV_BM_500` / `PV_BM_250`, or typed `1`/`2`/`3`, `1l`, `500 ml`, `half litre`… | Odia "<size> chosen, how many boxes?"; unknown → English "Sorry, I didn't recognize that size…" |
| `awaiting_quantity` | any positive whole number (no upper limit) | add-more template; else "Please reply with a valid number of boxes" |
| `awaiting_more` | button `add_more` / `order_done`, or words (`add`, `more`, `yes`… → more; `done`, `no`, `confirm`… → checkout) | picker again, or checkout |
| checkout | — | known phone (Sheet `Customers`) → summary, stage `confirming`; new phone → Odia "first order, your name?", stage `awaiting_name` |
| `awaiting_name` | any text | Odia "where should it be delivered?" |
| `awaiting_address` | any text | **new customer: `Customers` row appended here, before confirming**; summary, stage `confirming` |
| `confirming` | `YES` words (`y`, `yes`, `yeah`, `yep`, `ok`, `okay`, 👍, ✅, ✔️, 👌, `ହଁ`, `ହ`) | order written; Odia "order written in our book, our sales staff will talk to you about delivery…" |
| `confirming` | `change` | back to `awaiting_name` (update flow) |
| `confirming` | `cancel` | "Order cancelled. Say 'Hi' anytime…" |
| `confirming` | anything else | "Please reply YES to confirm, CHANGE to update details, or CANCEL to stop." |

The summary shows name, address and lines like `1L Box (12 pcs) x 5`. **No price, rate or total is shown anywhere.**
Mixed languages: summaries / confirmations in (Sambalpuri-style) Odia, re-prompts and errors in English.

**Feedback stages:** `feedback_awaiting_rating` (button `great` / `okay` / `not_great` or words; `not_great` →
"A member of our team will personally follow up with you shortly", flow ends) → `feedback_awaiting_comment` (any
text) → `feedback_awaiting_interest` (list-picker: `health`, `money`, `fun`, `science`, `eco`, `surprise`) → a link
from the Sheet tab `Tool_Catalog` ("Here's something for you: <title>: <url>").

**Google Sheet tabs** (one Sheet, `GOOGLE_SHEET_ID`):

| Tab | Written when | Columns |
|---|---|---|
| `Message_Logs` | every inbound message, also duplicates | time, phone (`whatsapp:+91…`), type (text / button / media), **full body**, button id, media URLs, stage before, MessageSid, `duplicate_retry` |
| `Leads` | `estimator…` message | time, phone, `estimator_inquiry`, body, MessageSid |
| `Sessions_Log` | intro, order start, estimator handoff, order confirmed | session id `SES-…`, phone, time, stage, outcome (`in_progress` / `converted`), order id, time |
| `Customers` | new customer at the address step; updated in place on each confirmed order | phone, name, address, `consent_marketing` (always empty), `tags` (always empty), created, updated, last order id |
| `Orders` | `YES` in `confirming` | order id `ORD-YYYYMMDD-NNNN`, phone, name, address, cart JSON (`[{sku, qty}]`), `pending_confirmation`, time, 6 empty columns |
| `Feedback` | each feedback step | feedback id `FB-…`, phone, time, rating, comment, interest, tool slug, status (`STARTED` / `RATED` / `COMMENTED` / `COMPLETE` / `ESCALATED`) |
| `Tool_Catalog` | read only (5-minute cache in memory) | category, title, slug, URL, active |

**Redis keys:**

| Key | Holds | TTL |
|---|---|---|
| `session:<From>` (From = `whatsapp:+91…`) | stage, cart, pending size, customer, session id, feedback | 30 min, renewed on each save |
| `msgsid:<MessageSid>` | dedupe claim (`SET NX`) | 24 h |
| `customer:<From>` | the Sheet's `Customers` row + row number | 7 days |
| `counter:<SES\|ORD\|FB>:<YYYYMMDD>` | daily id counter (**UTC date**, so 00:00–05:29 IST counts as the day before) | 2 days |
| `tool_rotation:<category>` | feedback link rotation | none |

**Twilio (names only):** one sender `TWILIO_WHATSAPP_FROM`. Plain replies go back as TwiML; templates are sent with
the REST API: `CONTENT_SID_INTRO`, `CONTENT_SID_SKU_PICKER`, `CONTENT_SID_ADD_MORE`, `CONTENT_SID_ESTIMATOR`,
`CONTENT_SID_FEEDBACK_RATING`, `CONTENT_SID_FEEDBACK_INTEREST`. All are replies inside the customer's 24-hour window;
the bot sends nothing proactive today.

### 1.2 Order Capture (PlantOps)

**Customers** (`order_capture.customers`): name (2–100), `phone` = normalised Indian mobile (10 digits, 6–9 first;
**unique per plant**, never changed), `phone_typed`, **`place`** (2–200, one free-text field, not an address),
active on / off (never deleted). One customer per phone per plant.

**Products:** the plant's **active PlantOps products** (Business details → Products: name, `sku_code`, `volume_ml`,
`units_per_pack`, `pack_type`), read through the platform (`kit.products`). Shown as `productLabel`, e.g.
"Bluemins 1L (1 L × 12)".

**Rates** (`product_rates`): per product a unit (default "box" when a pack holds several) and an optional **default
rate**; only the owner sets them. **The rate a customer gets** on the order form = this customer's rate on their
latest **non-cancelled** order that had the product (`lastRates`), else the default rate, else typed by staff.

**Orders:** `ref_no` (shown `O-0001`, one series per plant, `max + 1` under a per-plant advisory lock),
**`request_key`** (8–64 chars `[A-Za-z0-9_-]`, **unique per plant**), copies of customer name / phone / place,
status `pending` / `delivered` / `cancelled`, `version` + versioned `order_lines` (product name / unit copies,
quantity 1–100,000, rate, line total), `total`, `entered_by` (uuid) / `entered_by_name`, `order_note` (≤ 300, fixed),
delivery fields, history in `order_events` (created / changed / delivered / undelivered / cancelled / note).
No DELETE anywhere; FORCE RLS on every table.

**How an order is created:** `createOrder(user, input)` in `src/server/orders.ts`, called by `POST /api/orders` with
a staff module session.
1. Access table `enter` (owner, Order desk).
2. Input (zod): `request_key`, `customer {phone, name?, place?}`, `lines [{sku_id, quantity, rate}]` (1–50, each
   product once, whole quantity, rate ≤ 2 decimals **typed by the person**), `note?`. Unknown fields dropped.
3. Products must be active; none loadable → 503.
4. One transaction under `pg_advisory_xact_lock(order_capture.order, tenant)`: **same `request_key` → the same order
   back (`created: false`)**; next reference; customer found by phone (switched off → 409) or created (name + place
   required); lines version 1; `created` event.
5. After the answer: "New order O-0042: ₹510" notification (push) to owners + ticked people, minus whoever saved it.

**So idempotency already exists**: the bot's key can be the `request_key`; no new storage is needed for it.

**Thank-you on delivery** (`src/server/thanks.ts`): staff tick "Send a WhatsApp thank-you" in Mark delivered →
`customer_messages` row `pending` in the delivery transaction → sent after the answer through Twilio with the plant's
entry in **`TWILIO_WHATSAPP_SENDERS`** (`{"<plant id>": {"from": "whatsapp:+91…" or "MG…" (Messaging Service),
"content_sid": "HX…"}}`), template variable `{{1}}` = customer name, to `whatsapp:+91<phone>`. One per order ever;
4xx = failed, 5xx / unreachable retried by the daily job (3 tries, 24 h). Same Twilio account as the bot
(`TWILIO_ACCOUNT_SID` / `TWILIO_AUTH_TOKEN` on `order-capture`). **The customer's reply goes to whatever webhook that
sender has in Twilio.**

**Existing ways in:** browser routes with a staff session only; `POST /api/cron/daily` (`x-cron-secret`);
`/api/plantops/summary` (platform ticket). **No server-to-server API for anything outside PlantOps.**

### 1.3 The rest of the bot repo

- **`data/faq.json` is not used by any code** (nothing reads it), but it holds wrong prices (1L ₹100, 500ml ₹150,
  250ml ₹160) and unapproved claims: "Non-GMO", "natural flavoring, vitamins & minerals", "free delivery above ₹300",
  "1-2 business days", "SMS tracking", "7-day satisfaction guarantee", code `WELCOME10`, "₹50 referral credit",
  `support@bluemins.com`, "WhatsApp 24/7". Approved (2026-10-20): deleted in Step 1.
- **`README.md` describes a different, older bot** (`router.js`, `orderFlow.js`, `sheets.js` via Apps Script,
  `bizHours.js`, signature validation, prices, an `assets/` diagram): none of it exists. It even says signatures are
  validated. Approved (2026-10-20): rewritten in Step 1 from the real code.
- **`package.json`:** `uuid` is a dependency but never used; no `test` script; version 2.0.0 (the old repo reached
  3.0.0).
- **`public/estimate.html`** (wedding / function estimator): sizes 250 ml / 35, 500 ml / 24, 1 litre / 12 per box
  (match PlantOps); opens `wa.me/<the business number>` with the pre-filled text the bot parses (`SKU:` / `Boxes:`);
  no prices. The number is hard-coded in the page: it must stay the bot's Twilio number. Any box count is accepted, so
  the order limit (checklist 13) applies to estimator orders too.
- **`public/tds-and-water.html`:** a TDS explainer with a "Health" section citing BIS IS 10500 and WHO; written
  cautiously (no product claims). Part of the feedback-phase review, not the pilot.
- `.gitignore` blocks `.env*` and service-account files; a local `src/service-account-key.json` exists, ignored, not
  read for this document.

### 1.4 Where the code differs from the commerce plan

**Bot:**
1. No Twilio signature check (plan 3.1, 6). Step 1.
2. Two quick `YES` messages can create two orders (Sheet writes awaited before `clearSession`). Step 1.
3. New customer's `Customers` row is written before confirming → duplicates on CHANGE / cancel / retry. Step 1.
4. No numbered menu: an intro template, entry by prefix regex (`^(hi|hello|hey)` also matches "history"; `^Order`
   also matches "Orders are late"). No "talk to our team", no 20 L jar lane, no "check an order" (plan 3.1–3.2).
5. No global help / cancel / STOP / handoff; cancel works only in `confirming`; no "two wrong answers → a person".
6. `YES` accepts `ok`, 👍, ✅, 👌: the plan wants a button or an exact configured word. In `awaiting_more`, "yes"
   means "add more" and "confirm" / "no" mean "go to checkout" (nothing is submitted there, but the words are
   confusing next to the `confirming` stage).
7. Products and labels hard-coded (`SKU_LABELS`), only one brand (BM); **no rate or total shown** before confirming.
8. Address is free text; **no serviceability (area) check**.
9. The order goes to a Sheet with status `pending_confirmation`, yet the customer is told it is "written in our
   book" and gets no reference. After Step 3 the reference must come from Order Capture.
10. No "repeat last order".
11. `Message_Logs` keeps every full message body with no retention period (plan section 5).
12. Feedback: the comment is required (plan: optional); after the rating the bot sends a link from `Tool_Catalog`,
    including a **"health"** category. That content was not reviewed against "no health claims" (plan 6).
13. "Not great" promises a personal follow-up, but nothing alerts staff (only a `Feedback` row).
14. No consent is collected; `consent_marketing` is always empty and must not be read as consent.
15. A webhook error after some side effects returns 500; Twilio's retry is then deduped, so the customer gets no reply.
16. Phones are stored as `whatsapp:+91…` (Twilio's format), not normalised.
17. Daily ids use the UTC date and Redis counters (ids could repeat if Redis lost its data the same day).

**Order Capture:**
18. No bot-facing API (expected; Steps 2–3).
19. `createOrder` needs a staff user (`entered_by` uuid + name) and **a rate typed by the person**; the bot must not
    send rates. The bot path must take rates from the server (contract 3.3).
20. "Last basket" in the plan = last **delivered** order; the order form's `lastRates` uses the last
    **non-cancelled** order (pending included). The contract uses delivered for the basket, and keeps the form's rule
    for the rate so the bot quotes exactly what staff would.
21. Customers have one **`place`** field, the bot asks for an **address**. Contract: `place` stays the customer's
    place; the bot's delivery address/landmark goes into the order note.
22. No `source` on orders (plan wants "marked as from WhatsApp"). Can be done without a schema change (3.3), or with
    one column (ask).
23. Only Indian mobiles can be customers; a WhatsApp number from another country can never match.
24. The thank-you is sent per plant from `TWILIO_WHATSAPP_SENDERS`; if that sender is the bot's number, replies to
    the thank-you already reach the bot, which answers "Say 'Hi' to start…". Nothing tells the bot a thank-you was
    sent (comes with the delivered event, Step 4).
25. The daily job is the only retry runner (07:00 IST); a delivered-event outbox needs a faster retry (3.5).

---

## 2. Owner checklist

| # | Question | Facts / options | My recommendation | Owner answer |
|---|---|---|---|---|
| 1 | **Area list:** which villages / areas do we deliver packaged water to, and who keeps the list? | Needed for "not serviceable" (plan 3.1, insight A3). Options: (a) a list in Order Capture that the owner / Order desk edit (**schema change**); (b) a Sheet tab `Areas` the bot reads (no PlantOps change, but a second place to keep up to date); (c) owner sends a list, coded into a bot variable. | (a) in Order Capture, with an "Areas" screen for owner + Order desk; the bot reads it through the context call. Until it exists, the bot asks the village and staff confirm (no automatic refusal). | In Order Capture; owner + Order desk edit it (2026-10-20). |
| 2 | **Is the area checked by village name only?** | Customers type freely; spelling varies. | Bot shows the list as numbered choices + "Other"; "Other" goes to staff, never refused automatically. | Numbered list + "Other" → staff (2026-10-20). |
| 3 | **Opt-in wording and channels** | Draft in 4.8. Channels: (a) asked once by the bot after a confirmed order (inside the chat the customer started); (b) staff tick "agreed on the phone" in Order Capture (needs its own screen + approval); (c) a paper / QR form. Never a WhatsApp message just to ask. | (a) only for the pilot; wording version `optin-v1`. | Bot asks once after a confirmed order, `optin-v1` (2026-10-20). |
| 4 | **Where consent is stored** | (a) Order Capture, behind the bot API: one append-only table (customer, scope, wording version, source, time, withdrawn) (**schema + grant change**); (b) a small Postgres for the bot (one more Railway service, more cost); (c) the Sheet (no history, not recommended). | (a): durable, audited, tied to the Order Capture customer, backed up nightly, no new service. Designed in Step 4. | In Order Capture (schema change, designed in Step 4) (2026-10-20). |
| 5 | **Human support:** who answers when a customer asks for a person, on which number, which hours? | The bot's Twilio number has no staff inbox. | A staff mobile on WhatsApp / phone (e.g. the Order desk) + hours (e.g. 9:00–19:00, Mon–Sat). The bot gives the number; Step 1 logs each handoff, and an Order Capture bell for handoffs can follow (ask). | Owner sets number + hours in Business details (2026-10-20). Fields added in v0.28.1 (2026-10-21: "Customer support phone", "Support hours", free text with days); plant 001: 7090443303, 10 am – 6 pm (days to be filled by the owner). Step 1 uses the bot's own `SUPPORT_PHONE` / `SUPPORT_HOURS`. |
| 6 | **Pilot size, budget, holdout, duration, stop rules** | Plan section 9. | Plant 001 (read-only count, 2026-10-20): Order Capture live since 13 Oct; 356 active customers, 28 delivered orders to 24 customers in 30 days, 3 customers with 2+ deliveries. | **Approved 2026-10-20:** every opted-in delivered order from the start date, until 100 eligible customers or 8 weeks; **30 % no message / 70 % reminder** (random, by customer); one reminder 15 days after delivery, max one per customer per 14 days; budget cap **₹500** of Twilio cost (price checked before start); **stop at once** if a message reaches someone not eligible, Twilio rejects the template or lowers the number's quality, or 2 complaints about the messages; **pause and review** if opt-outs > 5 % of reminders (after 20 sent); weekly report to the owner. Results are a pointer, not proof (small numbers). | As recommended (2026-10-20). Consent channels: bot after an order **and** staff tick "Agreed to WhatsApp reminders" (phone). |
| 7 | **Twilio sender(s)** | Bot: `TWILIO_WHATSAPP_FROM`. Order Capture thank-you: plant 001's entry in `TWILIO_WHATSAPP_SENDERS`. Not visible from the code whether they are the same number. | One number for both, with its "A message comes in" webhook = the bot's `/whatsapp/inbound`. Owner checks both in Twilio Console and writes down the number (not a secret). | Same number; webhook → bot (owner, 2026-10-20). |
| 8 | **Products the bot shows vs Order Capture** | Bot: `1L Box (12 pcs)`, `500ml Box (24 pcs)`, `250ml Box (35 pcs)` (keys `PV_BM_1/500/250`). Order Capture: plant 001's active PlantOps products (there is also a DM brand). PlantOps products have a **`sku_code`**. | Owner sets `sku_code` = `PV_BM_1`, `PV_BM_500`, `PV_BM_250` on the three Bluemins products in PlantOps (no code or schema change); the bot shows only products with a `PV_` code, named as Order Capture names them. Owner confirms DM is not sold through the bot. Units per pack in PlantOps must be 12 / 24 / 35. | Codes already set; 12 / 24 / 35; only Bluemins via the bot (2026-10-20). |
| 9 | **How a bot customer matches an Order Capture customer** | Twilio `From` = `whatsapp:+919876543210`; strip `whatsapp:`, then `normalisePhone` (`packages/module-kit/src/phone.ts`) → `9876543210`; one customer per phone per plant (unique), so 0 or 1 match. | Exact phone match only; never by name. Switched-off customer = "not found" for ordering (handoff). Non-Indian numbers never match. | |
| 10 | **Unknown phone (not an Order Capture customer)** | Plan: initial bot submission for existing customers only. | Pilot: unknown numbers keep today's Sheet flow (name + address → staff call back), clearly as a **lead**, not an order. Adding new customers from the bot = later decision. | Lead in the Sheet, staff call back (2026-10-20). |
| 11 | **Which plant the bot serves** | Plant code **001** (Bluemins). The plant's tenant id is set server-side in Order Capture's bot-key config, never by the bot. | Plant 001 only. Owner (or I, read-only, with your OK) reads the tenant id from super_admin → Plants. | Plant 001 only, `950ea907-…49b4` (2026-10-20). |
| 12 | **Which rate is saved on a bot order** (the bot shows none; staff agree it by phone) | Every Order Capture line needs a rate (it can't be empty); the "New order" alert, totals and CSV use it. Owner, 2026-10-20: "take it from Business details". **But Business details → Products has no price today**; the owner's default rate per product lives in **Order Capture → Rates**. | Use the **default rate in Order Capture → Rates** (already there, no change; not the customer's last rate); ₹0 if none is set; the note says "Price to agree by phone". The alternative, a price field on Business details → Products, is a platform schema change and a second place for the same price. | Default rate in Order Capture → Rates, else ₹0; staff agree the price by phone (2026-10-20). |
| 13 | **Order limits** | Order Capture: 1–100,000 per line. Bot: no limit. | Bot max 200 boxes per product per WhatsApp order (above → "a person will call you"). | 200 boxes per product per WhatsApp order; more (incl. estimator) → staff (2026-10-20). |
| 14 | **Bot orders shown how in Order Capture** | "Entered by" name, request key prefix, or a new `source` column. | "Entered by: **WhatsApp**" + note "Ordered on WhatsApp…" (no schema change). A `source` column only if you want a filter / report (ask). | "Entered by: WhatsApp", no column (2026-10-20). |
| 15 | **Sheet tabs after Step 3** | `Orders`, `Customers`: plan says one ledger. | `Orders`: stop writing for matched customers (Order Capture is the truth); keep for leads (unknown phones) labelled "lead". `Customers`: read-only history. | As recommended (2026-10-20). |
| 16 | **Retention** | `Message_Logs` full bodies; feedback comments; consent records. | Consent records forever (proof). | `Message_Logs` and feedback comments: kept until deleted by hand. Consent: forever (2026-10-20). |
| 17 | **Language** | Plan: Odia + English. Today: Sambalpuri-style Odia + English mixed. | Each message in both (Odia first, then English) for the pilot; no language setting to keep. Owner / staff adjust the Odia to the words customers use. | English only for now; Odia later (2026-10-20). |
| 18 | **Feedback links (`Tool_Catalog`)** | "health" category may carry health claims. | Owner reviews the active rows; keep only reviewed ones. | Feedback flow is a later phase (2026-10-20). |
| 19 | **"Not great" feedback** | Promises a personal follow-up, no alert. | — | Alert the order taker + owner by notification (2026-10-20). How: 3.11. |
| 20 | **Customer type (insight C4)** | Not captured. | Decide later (schema change). Not for the pilot. | |

---

## 3. Draft contract

### 3.1 Shape

- Base: `https://orders.bluemins.life/api/bot/v1/…` (new routes in Order Capture; JSON only; TLS).
- Calls from the bot to Order Capture: **context** (3.2), **create order** (3.3), **order by key** (3.4).
- Call from Order Capture to the bot: **delivered / undone event** (3.5), `POST <bot>/plantops/v1/events`.
- The plant is **never** in a request: it comes from the bot key (3.6). A plant id, price, customer id or address
  inside a WhatsApp message is never used as authority.
- Every error has the same body: `{ "error": { "code": "<code>", "message": "<plain English>" } }` (table 3.7).

### 3.1a One meaning for "item" and "count" (owner, 2026-10-20)

The bot and Order Capture must mean exactly the same thing by an item and a quantity. Rules, for every step:

| | Rule |
|---|---|
| **Item** | Identified by the PlantOps product's **`sku_code`** (`PV_BM_1`, `PV_BM_500`, `PV_BM_250`) on the bot side and its **`sku_id`** in every API call. Never by a name or label, which can change. The bot's keys `PV_BM_1/500/250` are the same codes (already set in PlantOps). |
| **Count** | **1 = one pack (box)** of the product: 12 × 1 L, 24 × 500 ml, 35 × 250 ml, from the PlantOps product's `units_per_pack`. Never bottles. Whole numbers 1–200 per product per WhatsApp order. |
| **Unit word** | The unit from **Order Capture → Rates** (`unit` in the context answer), shown by the bot as-is ("5 box"). Live check 2026-10-20: all three are "box"; PlantOps' pack type says "case", which the bot never shows. If the owner renames the unit in Rates, the bot follows. |
| **Label** | The bot shows Order Capture's label ("Bluemins 1L (1 L × 12)") from the context answer, so the customer sees the pack size the order will carry. `SKU_LABELS` in the bot is used only when Order Capture is unreachable (Step 2 fallback). |
| **Estimator** | `public/estimate.html` speaks in boxes with the same pack sizes (12 / 24 / 35); its "Boxes: N" becomes quantity N of that product. Over 200 → staff. |
| **Reminder template** | `{{2}}` is built from the same lines: "5 box Bluemins 1L, 2 box Bluemins 500ml" (quantity + Rates unit + product name). |
| **Mismatch guard** | Order Capture refuses a bot order whose `sku_id` is not one of the key's listed codes or not active (409 `product_unavailable`). The bot refuses to start if a listed code is missing from the context answer, and falls back to staff, never guessing. |

Tests that must exist (Steps 2–3): code ↔ id mapping for all three products; "5" stays 5 boxes end to end (bot cart → API → order line → CSV → notification → reminder text); a unit renamed in Rates shows up in the bot; a product switched off or not on the list is refused; the estimator's boxes land as the same quantity; a pack size changed in PlantOps (e.g. 24 → 20) is shown from Order Capture, not from the bot's old label.

### 3.2 (a) Customer + product context by phone

`POST /api/bot/v1/context` (POST so the phone is not in URLs or access logs)

```json
{ "phone": "9876543210" }
```
The bot sends the 10-digit normalised number (from `From` with `whatsapp:` removed, then the same rule as
`normalisePhone`); the server normalises again and refuses anything else (400 `bad_phone`).

**200, customer found and switched on:**
```json
{
  "customer": { "id": "3f1c…uuid", "name": "Sri Ram Hotel", "place": "Bijepur" },
  "products": [
    { "sku_id": "a1b2…uuid", "code": "PV_BM_1", "label": "Bluemins 1L (1 L × 12)", "unit": "box" },
    { "sku_id": "c3d4…uuid", "code": "PV_BM_500", "label": "Bluemins 500ml (500 ml × 24)", "unit": "box" },
    { "sku_id": "e5f6…uuid", "code": "PV_BM_250", "label": "Bluemins 250ml (250 ml × 35)", "unit": "box" }
  ],
  "last_delivered": {
    "ref": "O-0042",
    "delivered_on": "2026-10-12",
    "lines": [ { "sku_id": "a1b2…uuid", "quantity": 5 } ]
  },
  "has_pending_order": false,
  "areas": null
}
```
- `products`: active PlantOps products whose `sku_code` is in the key's own list (`"products": ["PV_BM_1",
  "PV_BM_500", "PV_BM_250"]` in its `ORDER_BOT_KEYS` entry; a prefix would also catch `PV_DM_*` / `PV_EM_*`), in
  PlantOps order.
- `support`: `{ "phone": "…", "hours": "…" }` from the plant's Business details (`support_phone` / `support_hours`,
  v0.28.1; `null` until the owner fills them);
  the bot uses it in the handoff text.
  **No rates** (owner, 2026-10-20: no price in the bot).
- `last_delivered`: the newest **delivered** order's current lines, quantities only, products still active; `null`
  if none. No amounts, no older orders, no notes, no staff names.
- `has_pending_order`: so the bot can say "you already have an order waiting" (and the reminder re-check, Step 4).
- `areas`: `null` until the area list exists (checklist 1); then `[{ "id": "…", "name": "Bijepur" }, …]`.

**200, not usable:** `{ "customer": null, "reason": "not_found" }` or `{ "customer": null, "reason": "switched_off" }`.
Nothing else is returned for an unknown phone (no products, no "did you mean").

### 3.3 (b) Create a confirmed order

`POST /api/bot/v1/orders`

```json
{
  "idempotency_key": "wa_8f14e45fceea167a5a36dedd4bea2543",
  "phone": "9876543210",
  "customer_id": "3f1c…uuid",
  "lines": [ { "sku_id": "a1b2…uuid", "quantity": 5 }, { "sku_id": "c3d4…uuid", "quantity": 2 } ],
  "delivery_note": "Near the Shiv temple, back gate",
  "area_id": null,
  "confirmed_at": "2026-10-20T10:42:13+05:30",
  "confirmation": { "message_sid": "SMxxxxxxxx", "word": "YES" }
}
```
- `idempotency_key`: made by the bot once per draft, `wa_` + 32 hex; stored as Order Capture's `request_key`
  (format already allowed). Same key → the same order, also for two calls at the same moment (existing lock).
- **No rates in the request, none shown to the customer.** The server fills each line's starting rate as checklist
  12 decides (proposed: the default rate in Order Capture → Rates, else ₹0); staff agree the price by phone and
  Change the order.
- `phone` + `customer_id` must belong together in this plant, customer switched on; else 409 `customer_mismatch` /
  `customer_off`. **Existing customers only**: no customer is created here.
- `delivery_note`: optional, ≤ 200 characters, what the customer typed as address / landmark. Saved in the order note
  as `WhatsApp order. Price to agree by phone. Deliver to: <text>` (the note limit is 300; the existing note column,
  no schema change).
- `area_id`: required once the area list exists; checked on the server (409 `area_not_served`).
- `confirmation`: kept in the audit row (which message confirmed it).
- Server reuses `createOrder` (one set of rules) with a bot actor: `entered_by` = the key's fixed id (uuid in the key
  config), `entered_by_name` = `WhatsApp`. The usual "New order" notification goes to owners + ticked people.
  Lines limit, product active, quantity 1–200 (checklist 13), each product once: same checks as staff orders.
- Module switched off for the plant, or bot ordering switched off (`ORDER_BOT_ORDERS=off`) → 403 `ordering_off`.

**201 created** (or **200** with `"created": false` for a repeated key):
```json
{
  "created": true,
  "order": {
    "ref": "O-0057",
    "status": "pending",
    "lines": [
      { "sku_id": "a1b2…uuid", "label": "Bluemins 1L (1 L × 12)", "unit": "box", "quantity": 5 },
      { "sku_id": "c3d4…uuid", "label": "Bluemins 500ml (500 ml × 24)", "unit": "box", "quantity": 2 }
    ]
  }
}
```
No rates or totals in the answer, so the bot cannot show them by mistake.
The bot gives the customer `ref` **only** after this answer.

### 3.4 Order by key (after a timeout)

`GET /api/bot/v1/orders/by-key/wa_8f14e45fceea167a5a36dedd4bea2543` → 200 with the same body as 3.3
(`created: false`), or 404 `not_found` (then the create can be sent again **with the same key**). Only orders
created by this bot key can be read this way.

### 3.5 (c) Order Capture → bot: delivered event

`POST <BOT_PUBLIC_URL>/plantops/v1/events` (new bot route; Step 4)

Headers: `Content-Type: application/json`, `X-PlantOps-Event: <event_id>`,
`X-PlantOps-Signature: t=<unix seconds>,v1=<hex HMAC-SHA256 of "<t>.<raw body>" with the event secret>`.

```json
{
  "event_id": "9b2e…uuid",
  "type": "order.delivered",
  "plant": "001",
  "occurred_at": "2026-10-20T16:05:00+05:30",
  "order": { "ref": "O-0057", "id": "7d1a…uuid", "via_whatsapp": true },
  "customer": { "id": "3f1c…uuid", "phone": "9876543210" },
  "lines": [ { "sku_id": "a1b2…uuid", "quantity": 5 }, { "sku_id": "c3d4…uuid", "quantity": 2 } ],
  "thank_you": "queued"
}
```
- Types: `order.delivered`, and `order.delivery_undone` (owner's Undo; the bot drops a scheduled reminder for that
  order). Sent for **every** delivered order of the plant (staff and bot orders), so reminders work for both.
- No amounts, names, notes or staff names. `thank_you`: `queued` / `none`, so the bot knows a reply may come.
- Not a message to the customer. The bot only records it (and in Step 4 schedules a reminder if eligible).
- **Bot answers:** 2xx within 5 s = done (also for an event id it has already seen: Redis `plantops_event:<id>`,
  30 days); 401 bad / old signature (> 5 min); 400 bad body. The bot re-checks everything at send time through the
  context call; the event is never trusted as consent.
- **Order Capture side:** an outbox row written in the same transaction as Delivered / Undo (**schema change**);
  sent after the answer; retried on timeout / 5xx / 429 at 1 min, 5 min, 30 min, 2 h, 6 h (needs a runner more often
  than the daily job: an extra cron-job.org call `POST /api/cron/events` every 15 min, no new Railway service); given
  up after 48 h with the failure shown to the owner; 4xx other than 408 / 429 = failed at once.

### 3.6 Authentication, plant binding, rotation

**Bot key (bot → Order Capture):**
- Format `ocb_<32 random bytes, base64url>`; sent as `Authorization: Bearer <key>`.
- Order Capture stores **only its SHA-256**, in a new Railway variable on `order-capture`:
  `ORDER_BOT_KEYS = [{"id":"<uuid>","tenant_id":"<plant 001 uuid>","sha256":"<hex>","label":"Bluemins WhatsApp bot"}]`.
  The entry fixes the plant; the key id is also the `entered_by` uuid. Generic: any plant could get an entry.
- **No schema or grant change** for the key (a **credential change**: ask). A table + screen can come later if keys
  ever need to be managed by the owner.
- Bot holds the key in its Railway variable `ORDER_CAPTURE_BOT_KEY` (+ `ORDER_CAPTURE_URL`). Never in git, never logged.
- **Rotation:** a script prints a new key once and its hash → add the hash as a second entry (both work) → set the
  new key on `whatsappbot` → check → remove the old entry. Leak = remove its entry: refused at once.
- **Off switches:** `ORDER_BOT_ORDERS=off` on `order-capture` (create refused, reads still work); the bot's own off
  switch (Step 3) falls back to "a person will call you".
- Every request also checks: the plant exists, Order Capture is switched on in its plan (`kit.plan`).

**Event secret (Order Capture → bot):** a separate random secret `PLANTOPS_EVENT_SECRET`, set on both services, used
only for the HMAC in 3.5. Rotation: the bot accepts two secrets during a change.

**Rate limits** (per key, in memory, `rateLimit` from module-kit; Order Capture runs one instance):

| Call | Limit | Over → |
|---|---|---|
| context | 60 / min per key, 10 / min per phone | 429 `rate_limited` + `Retry-After` |
| create | 20 / min per key, 3 / min per phone | 429 |
| by-key | 60 / min per key | 429 |
| failed auth | 10 / min per IP | 429 |

Request body ≤ 8 KB; JSON only; unknown fields refused (strict).

### 3.7 Error codes

| HTTP | `code` | When | Bot does |
|---|---|---|---|
| 400 | `bad_request` / `bad_phone` / `bad_lines` | schema, phone, lines invalid | log; handoff (a bug, not the customer's fault) |
| 401 | `unauthorized` | no / unknown / removed key | log loudly; handoff; no retry |
| 403 | `ordering_off` / `module_off` | switch off, module off for the plant | "a person will call you" |
| 404 | `not_found` | by-key: no such order | create again with the same key |
| 409 | `customer_mismatch` / `customer_off` | phone and id don't match / switched off | handoff |
| 409 | `product_unavailable` | product switched off meanwhile | re-fetch context, show the summary again |
| 409 | `area_not_served` | area not on the list | not-served text + handoff |
| 429 | `rate_limited` | over a limit | wait `Retry-After`, then as a timeout |
| 503 | `unavailable` | products / platform / database unreachable | as a timeout |

### 3.8 Retry and timeout (bot side)

- Context: 5 s timeout, 1 retry. Still failing → today's flow (Step 2) / "a person will call you" (Step 3).
- Create: 10 s timeout. Timeout, 5xx or connection error → **never** tell the customer it worked; `GET by-key` after
  2 s, 5 s, 15 s: found → success text with the reference; 404 → create again with the **same key** (at most 2
  creates); still unknown → "We couldn't confirm your order just now; our team will call you" + handoff log, draft
  kept 24 h in Redis for staff.
- One draft = one key; a new key only after the customer changes the basket and confirms again.

### 3.9 What is logged

- **Order Capture `audit_log`** (existing table, existing insert grant, no schema change): one row per bot call,
  actor `whatsapp-bot:<key id>`, action `bot.context` / `bot.order` / `bot.by_key`, target = customer / order id,
  details = result code, number of lines, the confirming MessageSid. **No phone number, message text or key.** Shown
  in Recent changes for orders only (context reads stay out of the screen, they would flood it).
- **Order Capture event outbox** (Step 4): event id, type, attempts, last error, sent / given up.
- **Bot:** structured lines (stage, MessageSid, outcome, Order Capture `code`, ref); `Message_Logs` as decided in
  checklist 16. Never the key, the event secret, Twilio or Google credentials.

### 3.11 "Not great" feedback → notification (owner, 2026-10-20)

The bot can't reach the platform (it has no module secret), so it asks Order Capture, which sends the notification
with `kit.notify` like every other Order Capture event.

`POST /api/bot/v1/alerts`
```json
{ "kind": "feedback_not_great", "phone": "9876543210", "feedback_id": "FB-20261020-0007", "comment": null }
```
- Order Capture finds the customer by phone (this plant only) and the **order taker** = `entered_by` of their newest
  non-cancelled order. Notification: new kind `order_capture.feedback_low` (phone + bell), "Unhappy customer:
  <name>, <place>", body "Rated 'Not great' on WhatsApp. Last order O-0042." Link: that order's page. Recipients =
  owners (always) + the order taker (`also_user_ids`, re-checked as usual: active, works in Order Capture). If the
  last order came from the bot, or the phone is not a customer: owners only, title "Unhappy customer on WhatsApp",
  the body shows the last 4 digits of the number only. Dedupe key `feedback:<feedback_id>`.
- Answer `202 { "sent": true }`; the bot never waits on it for its reply to the customer, and keeps it to retry once
  later if Order Capture was down. Audited (`bot.alert`). Rate limit 10 / min per key.
- Needs: the bot key (Step 2), a new `NOTIFICATION_KINDS` entry in `packages/types` (no schema change), this route.
  **So it can come with Step 2 at the earliest**; until then a "Not great" rating is only a `Feedback` row.
- **Approved (2026-10-20):** the same call carries `kind: "handoff"` ("talk to a person", also after two
  unrecognised replies or an Order Capture failure): kind `order_capture.handoff`, same recipients, dedupe one per
  customer per hour.

### 3.10 Which parts need a schema / grant / credential change

| Part | Step | Change | Ask |
|---|---|---|---|
| Context, create, by-key routes | 2–3 | new code only | the design |
| Bot key (`ORDER_BOT_KEYS`, `ORDER_CAPTURE_BOT_KEY`) | 2 | **credential** (Railway variables) | yes |
| Idempotency | 3 | none: existing `request_key` | — |
| Support contact in Business details | 1–2 | **platform schema** (`tenant_profiles`: support phone, hours) + branding / context answer | approved in principle; migration first |
| "Not great" alert (3.11) | 2 | new notification kind + route, no schema | the design |
| "From WhatsApp" marking | 3 | none (name `WhatsApp` + note); **schema** only if you want a `source` column | if column |
| `sku_code` on three products | 2 | PlantOps data entry by the owner | — |
| Area list | 2–3 | **schema + grant** (new table + screen in Order Capture) | yes |
| Delivered-event outbox | 4 | **schema + grant** (new table, insert + retry-column update) | yes |
| Event secret (`PLANTOPS_EVENT_SECRET`) | 4 | **credential** on both services | yes |
| Consent + campaign log | 4 | **schema + grant** (append-only table(s) in Order Capture) + **consent** design | yes |
| Twilio webhook / sender, reminder template | 1 / 4 | **Twilio production** settings, Meta template approval | yes |
| Extra cron-job.org job (`/api/cron/events`) | 4 | scheduler job, no Railway service | yes |

---

## 4. Draft texts (Odia + English) for owner review

**Owner, 2026-10-20: English only for now.** The English below is what gets approved and built; the Odia lines are
kept only as a starting point for the later local-language version.
Rules used: no new claims about price (prices only from Order Capture), delivery time or health. Placeholders in
`{…}` are filled by the bot. The Odia is a **standard-Odia draft**; the live bot speaks Sambalpuri-style Odia
("ଅଜ୍ଞ୍ୟା", "ଦଉନ"), so please have the Odia read and adjusted by someone who talks to the customers. Proposed: each
message shows Odia first, then English (checklist 17).

### 4.1 Menu
> Bluemins କୁ ସ୍ୱାଗତ। ଗୋଟିଏ ନମ୍ବର ଲେଖି ପଠାନ୍ତୁ:
> 1 ପାଣି ଅର୍ଡର (1 L / 500 ml / 250 ml)
> 2 ଆଗ ଅର୍ଡର ପୁଣି ଦିଅନ୍ତୁ
> 3 ମତାମତ
> 4 ଆମ ଟିମ୍ ସହ କଥା ହେବେ
> 5 20 L ଜାର୍ (ବିଜେପୁର ଅଞ୍ଚଳ)
> ସାହାଯ୍ୟ ପାଇଁ ଯେକୌଣସି ସମୟରେ HELP ଲେଖନ୍ତୁ।
>
> Welcome to Bluemins. Reply with a number:
> 1 Order water (1 L / 500 ml / 250 ml)
> 2 Repeat my last order
> 3 Feedback
> 4 Talk to our team
> 5 20 L jar (Bijepur area)
> Send HELP at any time.

(Option 2 shown only to matched customers with a delivered order. The plan's "Check an order" is left out until an
order-status call is agreed; asking for it goes to option 4.)

### 4.2 Help
> ଏମିତି ବ୍ୟବହାର କରନ୍ତୁ: ମେନୁରୁ ଗୋଟିଏ ନମ୍ବର ଲେଖନ୍ତୁ।
> MENU = ପୁଣି ଆରମ୍ଭ · CANCEL = ଏହି ଅର୍ଡର ବାତିଲ୍ (କିଛି ସେଭ୍ ହେବ ନାହିଁ) · PERSON = ଆମ ଟିମ୍ · STOP = ଆଉ ରିମାଇଣ୍ଡର ନାହିଁ
>
> How to use: reply with a number from the menu.
> MENU = start again · CANCEL = drop this order (nothing is saved) · PERSON = our team · STOP = no more reminders

### 4.3 Cancel (a draft, before confirming)
> ଠିକ୍ ଅଛି, ଏହି ଅର୍ଡର ବାତିଲ୍ କରାଗଲା। କିଛି ସେଭ୍ ହୋଇନାହିଁ। ପୁଣି ଆରମ୍ଭ ପାଇଁ MENU ଲେଖନ୍ତୁ।
>
> Okay, this order is cancelled. Nothing was saved. Send MENU to start again.

After an order is placed, CANCEL answers: "To change or cancel order {ref}, please talk to our team: {SUPPORT_PHONE}
({SUPPORT_HOURS})." (same in Odia: "ଅର୍ଡର {ref} ବଦଳାଇବା କିମ୍ବା ବାତିଲ୍ ପାଇଁ ଆମ ଟିମ୍ ସହ କଥା ହୁଅନ୍ତୁ: {SUPPORT_PHONE}
({SUPPORT_HOURS})।")

### 4.4 STOP / opt-out
> ଆପଣଙ୍କୁ Bluemins ରୁ ଆଉ ରିମାଇଣ୍ଡର ମେସେଜ ଆସିବ ନାହିଁ। ଅର୍ଡର ପାଇଁ ଆପଣ ଯେବେ ବି ଆମକୁ ମେସେଜ କରିପାରିବେ। ପୁଣି ରିମାଇଣ୍ଡର ପାଇବାକୁ START ଲେଖନ୍ତୁ।
>
> You will not get reminder messages from Bluemins any more. You can still message us to order at any time. To get
> reminders again, send START.

Words that mean STOP: `STOP`, `UNSUBSCRIBE`, `ବନ୍ଦ` (exact, any case). Recorded with time and source; honoured
before every proactive send.

### 4.5 Human handoff
> ଆପଣଙ୍କ କଥା ଆମ ଟିମ୍ ପାଖକୁ ପଠାଗଲା। ଜରୁରୀ ହେଲେ {SUPPORT_PHONE} କୁ ଫୋନ୍ କରନ୍ତୁ ({SUPPORT_HOURS})।
>
> We have passed your message to our team. If it is urgent, please call {SUPPORT_PHONE} ({SUPPORT_HOURS}).

Also used after two replies the bot could not understand, and after any Order Capture failure.

### 4.6 Order summary (before confirming)
> ଦୟାକରି ଆପଣଙ୍କ ଅର୍ଡର ଦେଖନ୍ତୁ:
> {name}, {place}
> {label}: {qty} {unit}   (one line per product)
> ଠିକଣା / ଚିହ୍ନ: {delivery_note}
> ଦାମ୍ ବିଷୟରେ ଆମ ଟିମ୍ ଆପଣଙ୍କୁ ଫୋନ୍ କରିବେ।
> ଅର୍ଡର ଦେବାକୁ YES ଲେଖନ୍ତୁ। ବଦଳାଇବାକୁ EDIT, ବାତିଲ୍ ପାଇଁ CANCEL।
>
> Please check your order:
> {name}, {place}
> {label}: {qty} {unit}
> Address / landmark: {delivery_note}
> Our team will call you about the price.
> Reply YES to place this order, EDIT to change it, or CANCEL.

Only in this stage do `YES` / `ହଁ` (exact) or the Confirm button submit.

### 4.7 Order confirmed (only after Order Capture answered 201 / 200)
> ଧନ୍ୟବାଦ। ଆପଣଙ୍କ ଅର୍ଡର {ref} ନିଆଗଲା। ଦାମ୍ ଏବଂ ଡେଲିଭରି ବିଷୟରେ ଆମ ଟିମ୍ ଆପଣଙ୍କୁ ଫୋନ୍ କରିବେ।
>
> Thank you. Your order {ref} is placed. Our team will call you about the price and delivery.

If it could not be confirmed (3.8):
> ଏବେ ଆପଣଙ୍କ ଅର୍ଡର ନିଶ୍ଚିତ କରିପାରିଲୁ ନାହିଁ। ଆମ ଟିମ୍ ଆପଣଙ୍କୁ ଫୋନ୍ କରିବେ।
>
> We couldn't confirm your order just now. Our team will call you.

### 4.8 Opt-in question (version `optin-v1`)
Asked once, right after a confirmed order, inside the chat the customer started; never sent on its own.
> ପୁଣି ଅର୍ଡର କରିବା ସମୟ ହେଲେ Bluemins ଆପଣଙ୍କୁ WhatsApp ରେ ଗୋଟିଏ ରିମାଇଣ୍ଡର ପଠାଇବ କି?
> ହଁ ପାଇଁ 1, ନା ପାଇଁ 2 ଲେଖନ୍ତୁ। ଯେକୌଣସି ସମୟରେ STOP ଲେଖି ବନ୍ଦ କରିପାରିବେ।
>
> Would you like Bluemins to send you a WhatsApp reminder when it may be time to order again?
> Reply 1 for Yes, 2 for No. You can send STOP at any time.

Answers: `1` / button `optin_yes` = consent recorded (scope `reorder_reminder`, wording `optin-v1`, source
`bot_after_order`, time); `2` / `optin_no` = recorded as declined, not asked again for 90 days; anything else = not
answered (no consent).

A second consent channel (owner, 2026-10-20): staff ask on the phone and tick **"Agreed to WhatsApp reminders"** on the
customer in Order Capture; recorded with source `staff_phone`, who ticked it and when, wording `optin-v1` read out.

### 4.9 Reorder reminder template (for Twilio / Meta approval; Step 4)

**Submitted to Twilio by the owner on 2026-10-20** (Meta approval pending; record the template's `HX…` SID and the result here). The owner submitted it in Twilio Console → Content Template Builder. Approval does not allow sending: nothing is sent
before the Step 4 build, the tests and the owner's go-live.

| Field | Value |
|---|---|
| Template name | `bluemins_reorder_reminder_v1` |
| Category | Marketing (a reorder reminder is marketing for Meta, not utility) |
| Language | English (`en`) |
| Type | Quick reply (text body + 3 buttons) |
| Variables | `{{1}}` = customer name, `{{2}}` = last order's products |
| Sample values (Meta asks for them) | `{{1}}` = `Sri Ram Hotel`, `{{2}}` = `5 box Bluemins 1L, 2 box Bluemins 500ml` |

**Body:**
> Hello {{1}}, this is a reminder from Bluemins. Your last order was {{2}}. Would you like to order again?

**Footer:** none. Twilio's quick-reply type has no footer field (owner, 2026-10-20); the **Stop reminders** button is
the opt-out, and the bot also honours a typed STOP. If a written line is wanted later, resubmit as `_v2` with "Tap
\"Stop reminders\" or reply STOP to stop these messages." at the end of the body.

**Buttons (quick reply), with the id the bot reads:**

| Button text | Id |
|---|---|
| Repeat last order | `reorder_repeat` |
| Change the order | `reorder_edit` |
| Stop reminders | `optout_stop` |

No price, no discount, no delivery time, no health claim, and no fixed "15 days" (the delay may change in the
pilot). "Repeat last order" only starts the normal flow: summary → `YES` → order; nothing is ordered by the tap alone.

---

## 5. Approvals needed (Step 0 exit)

1. **The owner checklist answers** (section 2, items 1–20), recorded in the table.
2. **The contract** (section 3): the calls and their JSON (incl. the "Not great" alert, 3.11), existing customers
   only, no prices in the bot, delivery address into the order note, the error codes, retries and logging.
3. **Credentials:** a bot key kept as a hash in `ORDER_BOT_KEYS` on `order-capture` (no table) and
   `ORDER_CAPTURE_BOT_KEY` / `ORDER_CAPTURE_URL` on `whatsappbot` (Step 2); the event secret `PLANTOPS_EVENT_SECRET` on
   both (Step 4).
4. **Schema / grant changes, in principle** (each migration still shown before it is written): area list (Step 2 or 3),
   delivered-event outbox (Step 4), consent + campaign log in Order Capture (Step 4), and a `source` column only if
   wanted (Step 3).
5. **Twilio:** which number is the bot's and Order Capture's sender, and that its inbound webhook is the bot (check
   only, no change in Step 0); later the reminder template for Meta approval (Step 4).
6. **The texts** (section 4) in Odia and English, after the Odia is adjusted to customers' wording, and opt-in
   wording `optin-v1`.
7. **Retention:** feedback comments and consent records (checklist 16; `Message_Logs` decided).
8. **Pilot controls:** size, holdout, budget, duration, stop rules (checklist 6) — can wait until Step 4, but before
   any reminder is sent.
9. **An extra cron-job.org job** for the event outbox (Step 4).

**State on 2026-10-20:** items 1–8 answered by the owner and recorded above (checklist rows 9 and 20 stay as
recommended / later). **2026-10-21: the owner signed off the contract (section 3); Step 0 is closed.**
Step 4's infrastructure (item 4's Step 4 tables, the event secret, the cron job) is confirmed again when Step 4 starts.
The approved bot clean-up (delete `faq.json`, rewrite README, drop `uuid`) is the first part of Step 1.
