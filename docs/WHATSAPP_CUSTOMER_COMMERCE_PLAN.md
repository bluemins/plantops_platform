# Bluemins WhatsApp customer commerce — rules-first plan

**Build order, current status and the prompt for each step: `docs/WHATSAPP_BUILD_PLAN.md`** (work from that file;
this one stays the design reference).

**Status:** Architecture decisions reviewed with the owner on 2026-10-20. This is a finalized planning baseline for
implementation planning, not authorization to run migrations, change permissions, start production campaigns, change
Twilio configuration, or share customer data.

### Owner decisions recorded (2026-10-20)

| Decision | Agreed direction |
|---|---|
| Jar app | Remains separate; handles 20 L jar deliveries, returns, balances and payment status in its approximately 10 km Bijepur service area |
| Packaged-water flow | Uses the existing chatbot for customer conversation and Order Capture as the packaged-order source of truth across its 50 km+ area |
| Delivery thank-you | Order Capture keeps sending the existing delivery thank-you. The chatbot handles inbound replies and later reorder follow-ups |
| First reminder pilot | Existing Order Capture customers with a delivered order, recorded WhatsApp opt-in and other eligibility checks; test a 15-day delay against a no-message holdout |
| Reorder submission | After explicit customer confirmation, the bot submits directly to Order Capture; initial bot submission is for existing Order Capture customers |
| Serviceability | Use a staff-maintained list of approved packaged-water villages/areas |
| First interaction languages | Odia and English, with prompts reviewed in both |
| Reorder consent | Explicit WhatsApp opt-in recorded by the chatbot; honor opt-out before sending |

The first campaign must not message customers who lack recorded opt-in. Do not send a WhatsApp message merely to ask
an unconsented customer to opt in. Consent can be captured when the customer initiates an eligible chat or through
another owner-approved collection channel, with source and time recorded.

## 1. Goal and boundaries

Build a low-cost, predictable WhatsApp customer interaction and repeat-order flow for Bluemins packaged water
(1 L, 500 ml and 250 ml) across its 50 km+ distribution area. The existing 20 L jar delivery, return, balance and
payment app remains separate and serves its current approximately 10 km Bijepur area.

The system is **rules-first, not AI-intent-driven**. It will use approved message templates, explicit menus, numeric
replies, carefully defined keyword aliases and deterministic state transitions. No LLM is needed to classify a
message, quote a price, confirm an order, decide eligibility, or write business records.

Responsibilities:

| System | Responsibility |
|---|---|
| Twilio | WhatsApp transport: deliver inbound messages to one configured webhook and send replies/templates |
| Existing WhatsApp chatbot | Customer conversation, deterministic flow/session state, message deduplication, reply orchestration |
| PlantOps Order Capture | Authoritative packaged-water customers, products/rates, confirmed orders and delivery status |
| 20 L jar app | Authoritative 20 L jar deliveries, returns, balances and payment status within its local service area |
| Human staff | Exceptions, complaints, ambiguous requests, serviceability decisions and operational overrides |

Do not move the jar app into Order Capture or make Order Capture the WhatsApp conversation engine. Do not let the bot's
Google Sheet become a second source of truth for packaged-water orders after Order Capture integration.

## 2. Current-state facts to account for

- Order Capture already supports staff-entered orders and marks them pending, delivered or cancelled. Delivery can
  trigger a Twilio thank-you, but replies currently go to Twilio outside PlantOps. See
  [`apps/order-capture/src/server/thanks.ts`](../apps/order-capture/src/server/thanks.ts) and
  [`apps/order-capture/src/app/api/orders/[id]/deliver/route.ts`](../apps/order-capture/src/app/api/orders/%5Bid%5D/deliver/route.ts).
- Order Capture is not currently a public, bot-facing order API. Its interactive routes use PlantOps module sessions
  and the Order Capture access table. Do not expose those routes or a module credential directly to the public bot.
- The chatbot already has an inbound Twilio route, Redis conversation state and message-SID deduplication in
  `src/server.js` of the bot repo (`github.com/bluemins/order_handoff`, private; local clone
  `~/projects/order_handoff`; deployed on Railway from that repo, owner 2026-10-20); its feedback flow is deterministic in `src/feedback-flow.js`.
- The chatbot's README describes AI capabilities, but its current package manifest does not include an AI SDK.
  Preserve the deployed deterministic behavior; this plan does not add AI dependencies.
- The current chatbot writes order and customer data to Google Sheets. Before any live Order Capture integration,
  decide which existing writes are retained as a transition/audit export and which become read-only. There must be
  one authoritative confirmed-order ledger.
- The owner decision is that Order Capture sends the delivery thank-you; the chatbot receives replies and sends
  later opted-in reorder follow-ups. The Twilio sender must have one inbound webhook, routed to the chatbot.

## 3. Deterministic interaction design

### 3.1 Entry and routing

Use one inbound webhook for the WhatsApp sender/Messaging Service. Validate Twilio's request signature before
business logic and deduplicate every inbound `MessageSid` before mutating state or calling an API.

Resolve the product lane using an explicit menu or known product selection:

1. Packaged products: 1 L, 500 ml or 250 ml → packaged-water flow.
2. 20 L jar request → reply that jar service is local to its supported Bijepur area and route to the jar app's
   approved contact/process only when the customer is in its service area.
3. Mixed or unclear request → ask a fixed clarification question; never infer the service lane from the phone number.
4. Unsupported/ambiguous response after a bounded number of attempts → human handoff.

Ask for village/landmark or use a previously confirmed service address to check the packaged-water service area.
Do not promise delivery based only on a district, pin code or approximate phone location. The serviceability rule
must be configured and maintained by Bluemins staff.

### 3.2 Intent-free menu and order flow

Example menu:

> Welcome to Bluemins. Reply with a number:
> 1. Place/repeat a packaged-water order
> 2. Check an order
> 3. Share feedback
> 4. Talk to our team
> 5. 20 L jar service (Bijepur area)

Use button payloads where supported; otherwise parse exact numeric choices and a short, reviewed alias list. Normalize
case, whitespace and common spelling variants, but do not use fuzzy semantic matching. If input is not recognized,
repeat the current question with examples; after two failed attempts offer a person.

Packaged-water order state machine:

`START → SELECT_PRODUCTS → ENTER_QUANTITIES → CONFIRM_ADDRESS → SHOW_SUMMARY → CONFIRM_ORDER → SUBMITTING → COMPLETE`

- A repeat-order option can load the customer's last delivered basket from Order Capture, then ask whether to repeat
  or edit it.
- Product choices, active status, unit, price/rate and serviceability come from the authoritative integration/API,
  not hard-coded FAQ text or an AI-generated answer.
- Validate whole-number quantities and configured product/order limits in the bot for a good prompt, and again in
  the Order Capture API as the authoritative validation.
- Show customer, delivery area, products, quantities and applicable confirmed rate before confirmation.
- Only a clear explicit confirmation (button/payload or an exact configured confirmation word) submits the order.
  "Yes" outside the confirmation stage must not submit anything.
- A changed response returns to the relevant stage. Cancel/back/help commands work in every stage.
- A timeout, API failure or ambiguous result must never be reported as a successful order. Give the customer a
  reference only after Order Capture confirms the write.
- Store a short-lived order draft in Redis. After a timeout, query by idempotency key before retrying a create call.

Feedback state machine:

`FEEDBACK_START → RATING → OPTIONAL_COMMENT → COMPLETE`

Offer a small fixed rating scale, capture optional free text without classification, and route low ratings or explicit
requests for help to staff. No automated resolution or AI sentiment score is required for the first release.

### 3.3 Reorder follow-up

Initial pilot rule, subject to approved consent and WhatsApp template:

```text
eligible =
  order status is delivered
  AND customer has recorded opt-in for reorder/marketing messages
  AND no newer pending or delivered order exists
  AND no open complaint/service issue is known
  AND customer has not opted out
  AND customer is within the configured service area
```

- Start by testing one reminder 15 days after delivery as a hypothesis, not a universal prediction.
- Make the delay and campaign template configurable by an authorized operator; do not build an opaque model.
- Send one reminder per eligible delivered order/customer in the pilot. Prevent duplicates using a stable campaign
  event key.
- Message asks whether the customer wants to repeat or edit the prior packaged-water order; it does not create an
  order until the customer completes the confirmation flow.
- A customer who replies later can still use the menu; state expiry should return them to a safe start, not submit a
  stale draft.
- Suppress reminders after opt-out, a new order, unresolved issue or staff suppression.

WhatsApp proactive messaging requires current policy compliance, approved templates where required, opt-in and
honored opt-outs. A transactional delivery thank-you is not consent to marketing. Record the consent wording/source,
time and scope. Provide STOP/opt-out instructions and apply the suppression before any future send. Verify current
Meta/Twilio rules and pricing before the pilot.

## 4. Proposed API boundary

The bot must not connect to PlantOps databases, reuse a staff session cookie, or hold a broad platform/module secret.
Build a narrow server-to-server interface, authenticated with a dedicated rotatable credential and strict request
validation. Prefer the chatbot backend to call a bot-facing adapter in Order Capture; do not make the adapter public
without authentication.

Proposed minimal operations (exact paths and schema are design work, not yet approved):

1. `GET` customer/product context by normalized phone and plant/sender mapping:
   - customer identity/status and saved delivery address/place;
   - active packaged products, unit labels and permitted customer rates;
   - last delivered order summary for repeat-order convenience;
   - no cross-tenant discovery and no unnecessary order history.
2. `POST` confirmed packaged order:
   - idempotency key, customer identifier/validated contact, confirmed delivery place, selected product IDs,
     integer quantities, confirmation time and channel/source;
   - server revalidates tenant, product activity, price/rate rules, order limits and customer/serviceability;
   - returns the Order Capture reference and status.
3. Delivery event from Order Capture to the bot:
   - order event ID, order reference, delivered timestamp, customer contact, approved minimal basket/context;
   - signed/authenticated, retried safely, deduplicated by event ID.
4. Optional template send request:
   - the bot uses its configured sender for the opted-in reorder reminder only. The existing Order Capture sender
     continues to send the delivery thank-you; coordinate configuration to prevent duplicate messages.

The plant/sender mapping must come from server-controlled configuration. Never trust a tenant ID, product price,
customer ID or destination supplied by a WhatsApp message. Limit returned data to the specific customer/order and
operation; log event IDs and outcomes without logging credentials or unnecessary message contents.

### Selected event ownership

- Order Capture remains responsible for its existing delivery thank-you.
- Twilio's inbound webhook routes customer replies to the existing chatbot.
- Order Capture must also notify the chatbot of a delivered event so the bot can schedule and later re-check
  reorder eligibility. This event is not itself a second thank-you message.
- The chatbot alone sends the later opted-in reorder reminder and handles that conversation.
- Verify the sender's Twilio configuration so there is one inbound webhook and no duplicate outbound thank-you.

## 5. Data, consent and customer insights

Capture only what is needed to run and measure the flow:

- Stable Order Capture customer ID (phone is a contact attribute, not the preferred primary key).
- Consent scope (transactional vs reorder/marketing), wording/version, source, timestamp and withdrawal timestamp.
- Bot conversation stage and expiry; inbound Twilio MessageSid; outbound message/template ID and status.
- Related order ID/reference, delivered time, reminder eligibility/result, customer confirmation and resulting order ID.
- Fixed interaction outcomes: placed order, asked for human, feedback rating, opted out, not serviceable, no response.

Define retention and access before rollout. Do not store payment information or copy jar-app balances into the
packaged-water bot. Keep free-text feedback only as long as needed under the approved retention policy. Use PlantOps
tenant isolation and audit patterns; obtain owner approval before any database, permission, or consent-schema change.

Useful insight reports:

- Eligible customers → delivered reminder → response → confirmed order funnel.
- Incremental confirmed orders and contribution versus a randomly selected no-reminder holdout.
- Reorder interval by product/customer type/service area, with minimum cohort sizes to avoid misleading conclusions.
- Opt-out, complaint and human-handoff rates.
- Orders lost due to serviceability, product unavailability or failed delivery.

Do not treat sends, reads, bot replies or gross revenue as proof of incremental sales.

## 6. Reliability and safeguards

- Twilio signature validation before processing; inbound `MessageSid` idempotency.
- API authentication, TLS, request-size limits, strict schemas, rate limits, secret rotation and least privilege.
- API create idempotency key; retries must not duplicate an order.
- Delivery webhook retries with persistent outbox, bounded retry and dead-letter/visible failure state.
- Redis session expiry and recovery; store only conversation state, not the authoritative customer/order ledger.
- Human handoff on explicit request, complaint, ambiguous route, repeated invalid input or API failure.
- Never use generated AI to set prices, promise availability/delivery, decide service area, submit orders or make
  quality/health claims.
- Alert staff on failed handoffs, repeated API errors, Twilio rejection and unusually high opt-out/complaint rates.
- Provide a kill switch for reorder campaigns and an independent way to disable bot order creation.

## 7. Rollout phases and acceptance criteria

### Phase 0 — Confirm rules and ownership

- Confirm packaged-water product catalogue, rate authority, delivery-zone rule, order limits, customer identity match,
  consent wording, retention and support contact. Delivery-thank-you ownership is already decided: Order Capture
  sends it; the chatbot handles replies and later reorder follow-ups.
- Review current chatbot behavior, Twilio webhook configuration and existing Google Sheets writes.
- Verify Twilio request-signature validation in the deployed route before production exposure.
- No schema/API/permission changes in this phase.

**Exit:** owner approves a written flow, consent language, message templates and one outbound-message owner.

### Phase 1 — Harden the existing deterministic bot

- Preserve current stable menu/order behavior.
- Confirm signature validation, deduplication and state timeout/reset behavior.
- Add explicit global help, cancel, opt-out and human-handoff behavior.
- Add structured operational logging without secrets or unnecessary personal data.
- Test invalid replies, duplicate webhooks, Redis outage, retries and session expiry.

**Exit:** test checklist passes against Twilio sandbox/test sender; no order is created twice or on ambiguous input.

### Phase 2 — Read-only Order Capture integration

- Build authenticated read operations for product/rate context and a customer's last delivered basket.
- Bot shows current data and can prepare a draft; it cannot write orders yet.
- Test customer matching, wrong-tenant refusal, inactive product, missing data and API outage.

**Exit:** owners/staff verify product, rate and repeat-basket answers against Order Capture.

### Phase 3 — Confirmed-order write

- Add the authenticated, idempotent confirmed-order API and bot confirmation screen.
- Keep Order Capture validation authoritative; return a reference only on committed success.
- Pilot with staff/test customers before enabling production orders.
- Stop bot Google Sheets from acting as a second order ledger; preserve any required transition export separately.

**Exit:** duplicate deliveries/webhooks/retries do not create duplicate orders; all bot-confirmed orders reconcile to
Order Capture.

### Phase 4 — Delivery handoff and reorder pilot

- Emit delivered events to the bot, with retry/deduplication; keep the existing Order Capture thank-you sender.
- Add consent capture and suppression before any marketing/reorder send. This may require an approved schema change.
- Submit/verify the relevant WhatsApp template; run a small 15-day test with a no-message holdout.
- Human review of exceptions and daily campaign outcome report.

**Exit:** no messages sent without eligible consent; opt-outs suppress future sends; no duplicate messages/orders;
pilot results are measured for incremental contribution and customer harm signals.

### Phase 5 — Improve using observed outcomes

- Compare fixed 15 days with other simple rule-based timings (for example, a customer-specific prior reorder interval
  bucket) only when enough reliable data exists.
- Change one factor at a time; retain a holdout.
- Add language variants and retailer/institutional branches only after the base flow works.
- Do not introduce AI intent classification unless the owner later requests a cost/benefit evaluation.

## 8. Build prompts (use one phase at a time)

These prompts are implementation briefs, not blanket approval to change code or production systems. Start each phase by
reading the relevant code and proposing a specific implementation plan. Wait for owner approval before editing. Ask
before any database schema, permissions, tenant isolation, SSO, Twilio production configuration, or customer consent
data changes. Never implement a later phase before its prerequisite phase has passed its exit checks.

### Prompt 0 — Confirm rules and integration contract

> Read `docs/WHATSAPP_CUSTOMER_COMMERCE_PLAN.md`, the existing chatbot repository at
> `/home/rocky/projects/order_handoff` (and its `docs/REPO_MOVE_PLAN.md`, which must be finished first), and the relevant Order Capture code and notes. Do not edit files or contact
> production services. Produce a concise current-state map of the inbound Twilio webhook, outbound thank-you, bot
> state/deduplication, Google Sheets writes, customer/order fields, available Order Capture APIs and deployment
> configuration. Compare the actual code with this plan and list discrepancies.
>
> Turn the remaining decisions in section 10 into a short owner checklist. Draft the proposed API request/response
> shapes and event sequence, including authentication, idempotency, retries and failure behavior, but do not create
> endpoints yet. Identify all proposed schema, permission, consent, or Twilio configuration changes that require
> explicit approval. Return a phase plan and wait for approval before implementation.

**Deliverable/exit:** verified code map, resolved owner inputs, reviewed interaction and API contract; no code or
production changes.

### Prompt 1 — Harden the deterministic chatbot

> Implement only Phase 1 from `docs/WHATSAPP_CUSTOMER_COMMERCE_PLAN.md` in the chatbot repository. First inspect
> existing behavior and tests, then propose a scoped plan and wait for approval before editing.
>
> Preserve the current deterministic ordering and feedback flows. Verify the Twilio signature against the canonical
> request URL and body using the official Twilio library/configuration, and reject invalid signatures before any
> Redis, Sheets or message side effect. Retain/strengthen `MessageSid` deduplication. Implement global help, cancel,
> opt-out suppression and human handoff only as agreed in the approved prompt wording; do not invent consent or
> customer-facing claims. Keep logs useful but do not log credentials or unnecessary customer message content.
>
> Add focused tests for valid/invalid signatures, duplicate webhook delivery, out-of-stage confirmation, invalid
> input, opt-out, human handoff, expired state, Redis/Sheets failure and duplicate side-effect prevention. Do not add
> AI/LLM dependencies, change product/pricing claims, alter production Twilio settings, or connect to PlantOps.

**Acceptance:** invalid requests cause no side effects; retries cannot repeat an order or reply side effect; only
explicit state-appropriate actions proceed; existing approved flows remain intact.

### Prompt 2 — Read-only Order Capture adapter

> Implement only Phase 2 from `docs/WHATSAPP_CUSTOMER_COMMERCE_PLAN.md`. Inspect the Order Capture app's existing
> server patterns, tenant handling, validation, access control, tests and module credentials. Propose an API design
> and wait for owner approval before editing.
>
> Add a narrow server-to-server, authenticated, read-only bot interface for the approved Bluemins packaged-water
> use case. It may return only the minimum needed for a matched existing customer: identity needed to confirm the
> match, approved delivery place, active packaged products and permitted current rates, and the last delivered
> basket. Do not expose general customer search, full order history, unrelated modules, or plant-staff-hidden amounts.
> Resolve tenant from trusted server-side configuration/credentials; never accept a tenant ID as authority from the
> WhatsApp user. Validate and normalize phone input using existing shared helpers where appropriate.
>
> No bot-originated writes in this phase. Do not expose browser/session routes, database access, broad module
> credentials or public unauthenticated endpoints. Add tests for authentication, tenant isolation, unknown/multiple
> customer matches, inactive products, missing context, minimized response data and upstream failures. Ask before
> schema or grant changes.

**Acceptance:** chatbot can prepare but cannot submit an order; negative tests prove the endpoint cannot read another
tenant's customer/order data.

### Prompt 3 — Explicitly confirmed order submission

> Implement only Phase 3 after Phase 2 has passed its exit checks. Read the approved API contract and Order Capture
> order creation rules. Propose the endpoint and transaction design; wait for approval before editing, especially
> before any schema or permission change.
>
> Add a narrowly authenticated bot order-create operation for existing matched customers only. Require a unique
> idempotency key and explicit confirmation metadata; revalidate tenant, customer, approved service area, active
> products, quantities, rates and all existing Order Capture constraints on the server. Use Order Capture's existing
> order-creation logic where possible; do not duplicate business rules in a parallel write path. The bot must display
> a complete summary and require a state-appropriate explicit confirmation before calling this endpoint. On
> timeout, resolve by idempotency key before retrying. Return a reference only after committed success.
>
> Keep staff-created orders working. Define how legacy Google Sheets order writes are disabled or retained as a
> non-authoritative export; do not dual-write silently. Add tests for auth, tenant isolation, replay, concurrent
> duplicate calls, invalid customer/product/rate/quantity, unserviceable location, transaction failure and successful
> reconciliation. Do not enable production bot ordering in this phase.

**Acceptance:** only explicit confirmed orders are created; duplicate/retried requests result in one Order Capture
order; all bot-created orders reconcile to its normal order/history views and downstream jobs.

### Prompt 4 — Delivered event, opt-in and controlled 15-day pilot

> Implement only Phase 4 after Phase 3 is proven in a non-production test. Follow the owner decision: Order Capture
> retains its existing delivery thank-you; the chatbot receives the inbound reply, records the delivered-order
> handoff, and sends the later opt-in reorder reminder. Do not send a second thank-you.
>
> First propose the event and consent storage design, retry/outbox and dedupe behavior, exact approved WhatsApp
> templates, suppression rules, campaign cohort/holdout and stop thresholds. Wait for owner approval before changing
> database schema/permissions, consent records, module credentials, Twilio configuration or sending messages.
>
> The delivered event must be authenticated, minimally scoped, retried and idempotent. The chatbot schedules one
> 15-day reminder only for an existing customer with explicit recorded reorder/marketing opt-in, a delivered order,
> a serviceable area, no newer order, no unresolved issue and no opt-out. Re-check eligibility at send time.
> Transactional thank-you status must not imply marketing consent. Capture consent source, wording/version and time;
> apply STOP/opt-out before every campaign send. Keep a randomized no-message holdout and report incremental
> contribution, opt-outs, complaints and failures. No campaign starts until template approval and owner go-live
> approval.
>
> Test duplicate delivery events, late/out-of-order events, retries, changed eligibility, opt-out race, template
> rejection, Twilio failure, webhook outage, no consent, new order before send and message/order deduplication.

**Acceptance:** zero campaign messages to ineligible/unconsented customers; opt-outs suppress subsequent sends;
delivery thank-you is not duplicated; holdout and outcome reporting reconcile to Order Capture.

### Prompt 5 — Rule-based learning and pilot optimization

> Implement only Phase 5 after the pilot has enough reliable observations and the owner approves the evaluation
> window. Begin with an analysis using aggregate data; do not change campaign rules or contact customers yet.
>
> Compare the 15-day treatment and randomized holdout on incremental contribution, confirmed reorder rate,
> opt-outs, complaints and staff workload. Report sample sizes, absolute counts, uncertainty and data limitations.
> Check for seasonality, route/area and product mix before recommending a timing change. If evidence supports it,
> propose one simple deterministic alternative (for example, reorder-interval buckets) with an ongoing holdout and
> explicit stop rule. Do not use AI intent classification, generative messages, individual opaque scores, or
> automatic price/credit decisions.
>
> Present findings and a recommendation to the owner. Wait for approval before changing any live campaign,
> segmentation rule, message template or customer eligibility.

**Acceptance:** optimization recommendation is backed by pilot outcomes and does not conflate attribution with
incremental lift; no live behavior changes occur without owner approval.

## 9. ROI measurement

For each randomized group, measure over a defined period:

```text
incremental contribution =
  (reorder rate in reminder group - reorder rate in holdout group)
  × eligible customer count
  × contribution per confirmed order

net campaign contribution =
  incremental contribution
  - Twilio/template cost
  - discount cost
  - incremental delivery/handling cost
  - staff follow-up cost
```

Report absolute counts and uncertainty, not only a percentage. Separate:

- gross bot-attributed orders from incremental orders;
- repeat orders that would likely have occurred anyway from lift over holdout;
- revenue from contribution after variable costs;
- successful order submissions from abandoned drafts and API failures.

Set a pilot stop rule with the owner before sending (for example, a maximum budget and unacceptable opt-out/complaint
threshold). Do not claim an ROI forecast until Bluemins supplies baseline rates, contribution per order, messaging
costs and pilot results.

## 10. Remaining operational inputs

1. **Serviceability data:** supply the approved village/area list and name who maintains it.
2. **Consent operation:** approve the exact opt-in wording and identify the permitted collection channels. An
   inbound chatbot opt-in can be recorded in the bot; any sync into Order Capture needs a separately reviewed
   interface and data/permission design.
3. **Human support:** name the escalation destination and staffed response window.
4. **Pilot controls:** set the cohort size, campaign budget, test duration, holdout allocation and stop thresholds for
   opt-outs/complaints before sending.
5. **Twilio setup:** confirm which WhatsApp sender is used by Order Capture and the bot, and verify the single
   inbound webhook points to the bot before rollout.

## 11. Out of scope for this plan

- AI/LLM intent classification or generative customer responses.
- Integrating the 20 L jar app or importing its payment/balance records into Order Capture.
- Automatic credit decisions, dynamic prices/discounts, or unreviewed customer scoring.
- Automated delivery promises or route assignment from a customer chat.
- Schema migrations, permission changes, production credentials, Twilio configuration changes or live customer
  campaigns. Each requires a separate reviewed implementation step and the applicable owner approval.
