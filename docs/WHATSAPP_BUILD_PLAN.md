# WhatsApp bot + Order Capture — build plan from today (2026-10-20)

**What this is:** the one document to work from, in order, from the current state. It merges
`docs/WHATSAPP_CUSTOMER_COMMERCE_PLAN.md` (the design: rules, flows, API boundary, consent, ROI) and the bot repo's
`docs/REPO_MOVE_PLAN.md` (the repo move and secret clean-up), and gives one build prompt per step.

**How to use it:** do the steps top to bottom. For each step, paste its prompt into a new Claude Code session opened
from `plantops_platform` (the bot repo is reachable from there). Each step ends with an exit check; tick it in the
status table (section 2) and add a line to the done log (section 12) before starting the next. What the bot and
Order Capture can tell us beyond buying activity, and what each insight needs: section 11. The changes each repo needs
are also listed in that repo's CLAUDE.md, so every session works toward the same goal.

**What wins if documents disagree:** the commerce plan for *what* to build and the rules; this plan for *order, status
and prompts*; CLAUDE.md (PlantOps) and the bot's CLAUDE.md for working rules.

**Links:**

| Repo | Live code (deploys) | Work branch (never deploys) | Local clone |
|---|---|---|---|
| Bot | https://github.com/bluemins/order_handoff/tree/production | https://github.com/bluemins/order_handoff/tree/main | `~/projects/order_handoff` |
| PlantOps | https://github.com/bluemins/plantops_platform/tree/production | https://github.com/bluemins/plantops_platform/tree/main | `~/projects/plantops_platform` |

Both repos open together in VS Code with `~/projects/bluemins.code-workspace`.

---

## 0. Handover: start the next session here (2026-10-24)

**Where it stopped:** Steps R, 0, 1 and 2 are **done and live**. **Step 3 is built** on `main` in both repos (Order
Capture v0.30.0, bot 3.3.0), **not deployed**. Next: the release and the staff-number pilot (section 8, "Release and
pilot").

| Item | State on 2026-10-24 |
|---|---|
| Bot (`whatsappbot`, project `bluemins-whatsapp-bot`) | Live: `production` = `4b0de3e` (tag `3.2.0`, Step 2), signature `enforce`. Built, not live: Step 3 on `main` (release 3.3.0). New variables `BOT_ORDERS` (off / pilot / on; **not set = off**, so deploying changes nothing until it is set) and `BOT_ORDERS_PILOT_PHONES`. |
| PlantOps (shared copy) | Live: `production` = `0293b1f` (v0.29.0 Step 2) and later releases (v0.29.3 now). Built, not live: v0.30.0 on `main` (bot create + by-key; no migration). New optional variable `ORDER_BOT_ORDERS=off` on `order-capture`. |
| Bot key | Only in Railway (`whatsappbot`) and the owner's password manager. The same key works for Step 3. Rotation: `docs/DEPLOY.md` "WhatsApp bot key". |
| Alerts | Both live and confirmed (2026-10-24): "Unhappy customer: …", "Wants to talk: …". |
| Plant 001 Business details | Support phone 7090443303, hours "10 am to 6 pm (MON - SAT )" (stray space before ")": owner may tidy). |
| Repo note | `docs/HANDBOOK.md` change in `c7be459` kept (owner, 2026-10-24). `scripts/rotate-railway-secrets.sh` is still uncommitted (owner's). |

**Next session, in this order:**
1. Owner says **"release"** → section 8 "Release and pilot" steps 1–3: Order Capture v0.30.0 live first, then bot 3.3.0
   with `BOT_ORDERS=pilot` and the staff numbers.
2. Owner: the pilot checklist (step 4) from staff phones; then `BOT_ORDERS=on` (step 5).
3. After the pilot: the area list (schema change: table + Areas screen in Order Capture, ask first), then Step 4.

**Rules learnt:** give a recommendation with every question (owner); never push a bot release before its Railway
variables exist; keys are written to private scratch files, never printed into the chat; stage only named files when
committing (the owner keeps uncommitted work in the tree).

## 1. Where things stood (2026-10-20)

| Area | State |
|---|---|
| Bot repo | `github.com/bluemins/order_handoff` (private), local `~/projects/order_handoff`. Branches: `main` (work, never deploys) and `production` (deploys). `production` = `d17d983`, `main` = `f3de58f` (docs only ahead). |
| Bot hosting | Railway project **`bluemins-whatsapp-bot`** (separate from PlantOps, Singapore): service `whatsappbot` (`https://whatsappbot-production-70de.up.railway.app`, auto-deploys `production`) + `Redis` (volume). Live order → Google Sheet confirmed 2026-10-20. |
| Bot code | Node/Express, ~1,100 lines: `src/server.js` (webhook `POST /whatsapp/inbound`, stages `picking_sku → awaiting_quantity → awaiting_more → awaiting_name → awaiting_address → confirming`, 30-min session TTL, 24 h MessageSid dedupe, 7-day customer cache), `src/feedback-flow.js`. Writes Sheet tabs `Message_Logs`, `Leads`, `Sessions_Log`, `Customers`, `Orders`, `Feedback`. **No tests, no Twilio signature check.** |
| Old repo | Kept by the owner; not tracked in this plan. Nothing deploys from it. Its history holds old, not-live secrets (switched off in step R). |
| Secrets | The live Railway secrets were **never committed**. The leaked old ones (Google key `…f32e`, an Anthropic key, the Sheets Apps Script URL) are switched off and the unused Railway variables deleted (owner, 2026-10-20, step R). |
| PlantOps side | Order Capture live (v0.27.0 era): staff-entered orders, Twilio delivery thank-you (`apps/order-capture/src/server/thanks.ts`, `TWILIO_WHATSAPP_SENDERS`). No bot-facing API yet. |
| Design decisions | Owner decisions of 2026-10-20 in the commerce plan (jar app separate; Order Capture = order ledger; Order Capture keeps the thank-you; 15-day reminder pilot with holdout; opt-in required; Odia + English; staff-kept area list). |

## 2. Steps and status

| # | Step | Repo(s) | Needs owner approval for | Status |
|---|---|---|---|---|
| R | Finish the repo move (old keys off, local copies removed) | both | deleting local folders | **done** (2026-10-20) |
| 0 | Confirm rules and the integration contract | read-only | the contract, wording, templates | **done** (2026-10-21, contract signed off) |
| 1 | Harden the bot (signature, help / cancel / STOP, handoff, tests) | bot | the plan; any new dependency; production push | **done** (2026-10-23; `e9e52a2`, tag `3.1.0`, signature `enforce`) |
| 2 | Read-only Order Capture adapter + bot reads it | both | the API design; credential setup; production pushes | **done** (2026-10-23; v0.29.0 + bot 3.2.0 live) |
| 3 | Confirmed-order write; Sheets stops being an order ledger | both | endpoint + transaction design; any schema / grant change; go-live | **built** (2026-10-24; v0.30.0 + bot 3.3.0 on `main`, not live) |
| 4 | Delivered event, opt-in, 15-day pilot | both | schema / consent design; templates; pilot start | open |
| 5 | Learn from the pilot | analysis first | any live change | open |

One step at a time; a step starts only when the one before has passed its exit check.

## 3. Rules for every step

From PlantOps CLAUDE.md, the commerce plan and the bot's CLAUDE.md:
- **Plan first, then wait.** Each prompt starts read-only and ends with a proposal; no edits until the owner approves.
- **Ask first** before any change to: database schema or grants, permissions / roles, tenant isolation, the SSO token,
  module credentials, Twilio production settings, consent records, or a message to real customers.
- **No AI** in the bot: menus, exact numbers, reviewed aliases, fixed stage changes. No LLM dependency.
- **The bot never** connects to a PlantOps database, holds a PlantOps module secret, or reuses a staff session. It uses
  one narrow, rotatable bot credential (from step 2).
- **Order Capture is the order ledger** once step 3 is live; the Sheet is at most a labelled export.
- **Never trust the WhatsApp message** for tenant, price, customer id or destination; those come from server config.
- **Secrets:** never committed, never printed; `.env` locally (git-ignored), Railway Variables live.
- **Small, explained changes**; tests with every feature (role access, tenant isolation, idempotency, append-only).

### Deploying
- **Bot:** commit on `main` and push (deploys nothing). Going live = move `production` to a tested `main` commit and
  push it, **only when the owner says so** (`git push origin main:production`). Then: `/health`, "hi" on WhatsApp, a
  test order. Undo = push the previous commit to `production`.
- **PlantOps:** the usual release flow (`docs/HANDBOOK.md`, `docs/DEPLOY.md`): tag a version, migrations first,
  `production` branch, checks, deploy record in `docs/deployments/shared.md`, status note in CLAUDE.md.
- **Order of deploys when both change:** the Order Capture side first (works with the old bot), then the bot.

### Writing it down
- Bot repo: a dated note per step in `docs/` (or `NOTES.md`), the done log in this file.
- PlantOps: `apps/order-capture/NOTES.md` per change; CLAUDE.md status note per release.
- Commit messages: `WA Step N: …` in both repos.

---

## 4. Step R — finish the repo move

**Goal:** the bot repo is the only place work happens; no old key still works; no stray local copies. The old GitHub
repo is the owner's own business and is not part of this plan (owner, 2026-10-20).

Owner, by hand (any time):
1. Google Cloud → project `whatsapp-order-bot-507010` → Service accounts → `whatsapp-bot-sheets-writer` → Keys:
   delete key `…f32e` if listed (the live key ends `…097c`, keep it).
2. console.anthropic.com → API keys: delete the key from the old `.env`.
3. The Apps Script behind the old Sheets URL: Deploy → Manage deployments → archive it.
4. Twilio Console → API keys & tokens: no **secondary** auth token should exist.

**Prompt R:**

> Finish step R of `docs/WHATSAPP_BUILD_PLAN.md`. Leave the old GitHub repo alone (not part of this plan). Show me
> what is in `~/projects/whatsappbot-main` and `~/projects/whatsappbot-download-old` (names only, no file contents);
> both are local copies of the old repo, which GitHub still keeps. Wait for my "go" before
> deleting both and removing `whatsappbot-main` from `.claude/settings.local.json` `additionalDirectories`. Afterwards list the Railway
> variables the bot code never reads (names only, from `~/projects/order_handoff/.env` vs `src/`) so I can delete them
> in Railway, update `docs/REPO_MOVE_PLAN.md` (status + done log) and this plan's status table, commit on `main` in both
> repos and push. Do not touch `production`.

**Exit:** both local folders deleted, items 1–4 ticked by the owner, unused Railway variables removed.

---

## 5. Step 0 — confirm rules and the integration contract (no code)

**Goal:** a written, owner-approved contract and the answers to every open input, before any code.

**Prompt 0:**
> Step 0 of `docs/WHATSAPP_BUILD_PLAN.md`. Read it, `docs/WHATSAPP_CUSTOMER_COMMERCE_PLAN.md`, the bot repo
> `~/projects/order_handoff` (CLAUDE.md, `src/server.js`, `src/feedback-flow.js`, `docs/`) and Order Capture
> (`apps/order-capture/NOTES.md`, `src/server/{orders,customers,rates,thanks,access}.ts`, its migrations). Do not edit
> code, do not call live services, do not print secrets.
>
> Produce, in a new file `docs/WHATSAPP_CONTRACT.md` (PlantOps repo):
> 1. **Current-state map:** the bot's stages and replies, what each Sheet tab receives, the Twilio sender(s) and
>    templates in use (names only), the session / dedupe / cache keys and TTLs; Order Capture's customer, product,
>    rate and order fields, how an order is created (function, validation, reference numbering, idempotency), and how
>    the thank-you is sent (which sender, per plant). List every place the code differs from the commerce plan.
> 2. **The owner checklist** from commerce plan section 10 (area list + who keeps it, opt-in wording and channels,
>    human support contact and hours, pilot size / budget / holdout / stop rules, which Twilio sender the bot and
>    Order Capture use) plus: product names the bot shows vs Order Capture products, how a bot customer is matched to
>    an Order Capture customer (phone rule from `packages/module-kit/src/phone.ts`), and which plant id the bot serves.
> 3. **The draft contract:** exact request / response JSON for (a) customer + product context by phone, (b) create a
>    confirmed order with an idempotency key, (c) Order Capture → bot delivered event; authentication (one bot
>    credential, how it is stored and rotated, how the plant is fixed server-side), rate limits, error codes, retry
>    and timeout behaviour, what is logged. Mark which parts need a schema / grant / credential change.
> 4. **The draft Odia + English texts** for the menu, help, cancel, STOP / opt-out, human handoff, order summary,
>    order confirmed, and the opt-in question, for owner review (no new claims about price, delivery or health).
>
> End with the list of approvals needed and stop.

**Exit:** owner signs off the contract, the texts and the checklist answers (recorded in `WHATSAPP_CONTRACT.md`).

---

## 6. Step 1 — harden the bot (bot repo only)

**Goal:** the live bot is safe against fake and repeated webhooks, has help / cancel / STOP / human handoff, and has
tests. Ordering behaviour and the Sheet stay as they are.

**Prompt 1:**
> Step 1 of `docs/WHATSAPP_BUILD_PLAN.md` (commerce plan Phase 1), in `~/projects/order_handoff` only. Read the bot's
> CLAUDE.md, `docs/WHATSAPP_CONTRACT.md` (approved texts) and the code. Propose a plan and wait for my approval.
>
> Then:
> - **Twilio signature check** on `POST /whatsapp/inbound` with the official `twilio.validateRequest` against the
>   public URL (from a new variable, e.g. `PUBLIC_BASE_URL`, not from request headers) and the form body; reject with
>   403 before any Redis, Sheets or Twilio call. Keep `/health` and the static pages open.
> - Keep the MessageSid dedupe; make sure a duplicate causes no Sheet row, no reply and no stage change.
> - Fix the two bugs listed in the bot's CLAUDE.md ("Changes this repo needs", Step 1): a second quick "yes" creating
>   a second order, and duplicate `Customers` rows written before confirmation.
> - Global commands in every stage, from the approved texts: help, cancel / back, STOP (record the opt-out in Redis
>   with time and source and honour it before any proactive send; a reply to an inbound message is still allowed),
>   "talk to a person" (handoff: reply with the approved contact; log it).
> - "Yes" / confirm words work only in `confirming`; two unrecognised replies → offer a person.
> - Structured logs (stage, MessageSid, outcome), no secrets, no full message bodies beyond what `Message_Logs`
>   already keeps.
> - **Tests** with Node's built-in runner (`node --test`, no new dependency unless I approve one, e.g. a Redis fake):
>   valid / invalid / missing signature, duplicate webhook, out-of-stage "yes", invalid input twice, STOP, handoff,
>   expired session, Redis down, Sheets down, no double order on retry. Add `npm test`.
> - No AI, no PlantOps calls, no change to products, prices or Sheet columns.
>
> Commit on `main` (`WA Step 1: …`) and push; do **not** move `production`. Tell me exactly what to set in Railway
> (the new variable) before going live, and the live checks.

**Go-live (owner says "deploy"):** set `PUBLIC_BASE_URL` in Railway → push `main` to `production` → `/health`, "hi",
a test order, a request without a signature gets 403, STOP then "hi".
**Exit:** tests pass; live checks pass; nothing creates an order twice or on ambiguous input.

---

## 7. Step 2 — read-only Order Capture adapter

**Goal:** the bot shows real products, rates and the customer's last delivered basket from Order Capture, but still
writes orders only to the Sheet.

**Corrections from the approved plan (2026-10-21; they win over the prompt below):** no rates anywhere (contract:
no price in the bot); the context call (contract 3.2) carries the products, so no separate product endpoint; add the
alerts route (contract 3.11: `handoff` + `feedback_not_great`, owners + ticked people + the last order's taker); bot
"REPEAT" of the last delivered order; `support` in the context answer from Business details through the branding
answer; area list moved to Step 3.

**Prompt 2:**
> Step 2 of `docs/WHATSAPP_BUILD_PLAN.md` (commerce plan Phase 2). Read the approved contract
> (`docs/WHATSAPP_CONTRACT.md`) and Order Capture's server code, access table, module-kit patterns and tests. Propose
> the exact design and wait for approval, in particular **how the bot credential is created, stored and rotated** and
> whether it needs a schema / grant change (ask first).
>
> Order Capture (PlantOps repo): a server-to-server, read-only endpoint pair for the one plant the credential is bound
> to: (a) customer context by normalised phone (match, place, active products with unit and the rate this customer
> would get, last delivered basket) and (b) product list. Plant from the credential only, never from the request. No
> general customer search, no order history beyond the last delivered basket, nothing for unknown phones beyond
> "not found". Rate limit; audit each call. Tests: auth missing / wrong / rotated, tenant isolation (plant B's
> customer never visible), unknown / switched-off customer, inactive product, response contains only the agreed
> fields, Order Capture down.
>
> Bot (`order_handoff`): a small client with timeout and retry-safe GETs; the order flow shows products / rates /
> "repeat last order" from Order Capture for matched customers and falls back to today's behaviour if Order Capture
> is unreachable. Still writes to the Sheet only. Tests with a fake Order Capture.
>
> Commit on `main` in both repos; do not deploy. List the release steps (PlantOps version, Railway variables on
> `order-capture` and `whatsappbot`, order of deploys).

**Exit:** the owner compares bot answers with Order Capture for a few real customers; wrong-plant and unknown-phone
tests pass; nothing is written to Order Capture.

---

## 8. Step 3 — confirmed orders go to Order Capture

**Goal:** an explicitly confirmed bot order becomes an Order Capture order exactly once; the Sheet stops being an
order ledger.

**Design proposed 2026-10-23** (decisions: owner checklist 12–15 of 2026-10-20 + two answers of 2026-10-23; the
design itself waits for the owner's "build"). **No schema, grant or SSO change; the same bot key.**
- **Order Capture** `POST /api/bot/v1/orders` (contract 3.3) through the **same save code as staff orders**
  (`createOrder` split into the access check + one shared save): existing switched-on customers only (phone and id
  must match), products on the key's list and active, 1–200 boxes per product, rate = Rates default else ₹0, note
  "WhatsApp order. Price to agree by phone. Deliver to: …", `entered_by` = key id, "Entered by: WhatsApp". Idempotency
  via the existing `request_key` + per-plant lock; reference only after commit. `GET /api/bot/v1/orders/by-key/<key>`
  (own orders only). Normal list, "New order" alert ("by WhatsApp"), CSV, tile; one "WhatsApp order O-00xx" line in
  Recent changes. Off switch `ORDER_BOT_ORDERS=off` (403 `ordering_off`, reads keep working).
- **Bot:** Order Capture customers: Order → sizes / REPEAT → boxes → done → **landmark question once ("Where should we
  deliver? Type a landmark, or SKIP")** → summary 4.6 → exact YES → create. One attempt within the webhook (8 s); if
  it doesn't answer, reply "Saving your order…" and finish in the background (by-key 2 / 5 / 15 s, at most 2 creates
  with the same key), result sent as a message; "placed" only after Order Capture confirmed, else 4.7's failure text +
  staff alert. No Sheet `Orders` row for them. Unknown / switched-off numbers, and either off switch: today's flow,
  Sheet row marked `lead`, reply "Our team will call you to confirm". Over 200 boxes → a person + alert. A waiting
  order is mentioned, ordering still allowed. Bot off switch `BOT_ORDERS=off`.
- **Area list: after the pilot** (owner, 2026-10-23): staff confirm the village when they call about the price; the
  list (table + Areas screen, schema change) is a small step after the pilot.
- **Release:** Order Capture v0.30.0 first (no migration), then bot 3.3.0; pilot with staff numbers only, then
  customers.

**Built 2026-10-24** (no schema, grant or SSO change; details `apps/order-capture/NOTES.md` and the bot's
`CLAUDE.md` Step 3). Differences from the design above: the bot's switch has **three values** (`BOT_ORDERS` = `off` by
default, `pilot` with `BOT_ORDERS_PILOT_PHONES`, `on`) so the pilot can be limited to staff numbers; a product switched
off between "Order" and YES hands off (no second summary); Sheet orders from unknown numbers are marked `lead` and get
"Thank you. We have noted your order. Our team will call you to confirm it." instead of the old Odia "order written"
text. Tests: Order Capture 320 (+14), bot 68 (+19).

**Release and pilot** (owner says "release"; Order Capture first, it works with the old bot):
1. **Order Capture v0.30.0:** tag, `production` (no migration), the usual checks; then `POST
   https://orders.bluemins.life/api/bot/v1/orders` without a key → 401, and `GET …/by-key/wa_000…` without a key →
   401. Deploy record + CLAUDE.md "Live".
2. **Pilot customers:** each staff phone used for the pilot must be an Order Capture customer, switched on (Customers →
   add, e.g. "Rocky (test)", place "Test"). Their test orders are cancelled afterwards (reason "WhatsApp pilot test").
3. **Bot 3.3.0:** on `whatsappbot` set `BOT_ORDERS=pilot` and `BOT_ORDERS_PILOT_PHONES=<staff numbers, comma-separated>`
   **first**, then `git push origin main:production` and tag `3.3.0`. Deploy Logs show "Orders into Order Capture: pilot
   (N numbers)"; `/health` OK; "hi" answers.
4. **Pilot checklist** (from a pilot phone):
   - Order → REPEAT (or sizes) → done → landmark asked → type one → summary (name, place, lines, landmark, "Our team will
     call you about the price") → YES → "Your order O-00xx is placed".
   - Order Capture: the order in Pending, "by WhatsApp", the note "WhatsApp order. Price to agree by phone. Deliver to:
     …", rates = the Rates default; owner's bell "New order O-00xx … (by WhatsApp)"; Recent changes "WhatsApp order
     O-00xx: …"; the CSV row.
   - Again with SKIP; EDIT on the summary; CANCEL on the summary (nothing saved); "ok" instead of YES (asked again);
     201 boxes (a person + "Wants to talk" alert); PERSON (Business details hours).
   - A phone not on the pilot list: today's flow, a `lead` row in the Sheet, "Our team will call you to confirm it".
   - Mark one test order Delivered with the thank-you ticked: one thank-you arrives (from Order Capture only).
   - Cancel the test orders.
5. **Customers:** owner OK → `BOT_ORDERS=on` (Railway restarts the bot). Watch the first real orders; undo = `BOT_ORDERS=off`
   (or `ORDER_BOT_ORDERS=off` on `order-capture`), orders become Sheet leads again.

**Prompt 3:**
> Step 3 of `docs/WHATSAPP_BUILD_PLAN.md` (commerce plan Phase 3), only after step 2's exit check. Read the contract
> and Order Capture's order creation (`src/server/orders.ts`) and its tests. Propose the endpoint and transaction design
> and wait for approval; **ask before any schema or grant change** (e.g. storing the idempotency key or a `source`
> of "whatsapp").
>
> Order Capture: an authenticated create endpoint for matched existing customers only, reusing the existing creation
> logic (no second set of rules): idempotency key required (same key → same order, also under concurrent calls),
> revalidate plant, customer, area, products, quantities and rates on the server, return the reference only after
> commit. The order shows in the normal list, notifications ("New order"), CSV and tile like any other, marked as
> from WhatsApp. Tests: auth, isolation, replay, two simultaneous calls with one key, bad customer / product / rate /
> quantity, unserviceable area, database error, reconciliation with the list and CSV.
>
> Bot: summary screen → explicit confirm (button or exact word) → create call; on timeout look the key up before any
> retry; tell the customer the reference only on success, otherwise apologise and hand off. Sheet `Orders` writes
> stop (or become an export with a clear "copy" label, as I decide); no silent double writing. Tests.
>
> Add an **off switch** for bot ordering (a Railway variable) that falls back to "a person will call you". Commit on
> `main` in both repos; do not deploy; give the pilot checklist (staff / test customers only first).

**Exit:** retries and duplicate webhooks give one order; every bot order reconciles with Order Capture; pilot with
staff numbers passes before customers.

---

## 9. Step 4 — delivered event, opt-in, 15-day pilot

**Goal:** one opted-in reorder reminder 15 days after delivery, with a no-message holdout, and nothing sent to anyone
without consent.

**Prompt 4:**
> Step 4 of `docs/WHATSAPP_BUILD_PLAN.md` (commerce plan Phase 4), only after step 3 is proven. Propose, and wait for
> approval of: the delivered-event design (Order Capture outbox → signed call to the bot, retries, dedupe by event id),
> where consent lives and its fields (scope, wording version, source, time, withdrawal), the exact WhatsApp template
> for the reminder, the suppression rules, cohort / holdout / stop thresholds, and every schema / grant / credential /
> Twilio change.
>
> Order Capture keeps sending its thank-you; the delivered event is not a second message. The bot records opt-in only
> from an approved channel, schedules one reminder per delivered order 15 days later, and re-checks at send time:
> opt-in present, not opted out, no newer order, no open complaint known, area still served, kill switch off. Random
> holdout; daily outcome report. Tests for duplicate / late / out-of-order events, retries, changed eligibility,
> opt-out race, template rejection, Twilio failure, no consent, new order before send.
>
> No campaign message before template approval and my explicit go-live.

**Exit:** zero messages to unconsented or ineligible people; STOP suppresses; no duplicate thank-you; the report
reconciles with Order Capture.

---

## 10. Step 5 — learn from the pilot

**Prompt 5:**
> Step 5 of `docs/WHATSAPP_BUILD_PLAN.md` (commerce plan Phase 5), after the pilot window I approve. Aggregate data
> only, no customer contact, no live change. Compare reminder vs holdout: confirmed reorder rate, incremental
> contribution (commerce plan section 9), opt-outs, complaints, staff work; give sample sizes and uncertainty. If the
> data supports it, propose one simple rule change with a holdout and a stop rule, and wait.

**Exit:** a recommendation backed by pilot numbers; nothing live changes without approval.

---

## 11. Insights (beyond buying activity)

**Rules:** only what the flow needs; consent where needed; a retention period set in Step 0; **group-level reports,
no scores or profiles of individuals** (commerce plan section 11); show counts and sample sizes, not only percentages.
Reports are read-only views; none of them contacts a customer.

"Now" = possible from today's data (the Sheet), as a report or a short analysis, without code changes to the flow.

| # | Insight | Data source | When | Change needed in |
|---|---|---|---|---|
| **A. Demand that never became an order** |||||
| A1 | Drop-off funnel: started → product → quantity → name / address → confirmed | `Sessions_Log` (stage, outcome) | now; better after Step 1 logs every stage | bot (Step 1: log each stage change) |
| A2 | Bulk / event demand (weddings, functions, offices) as a call list for staff | `Leads` (`estimator_inquiry`, `estimator_handoff`) | now | — (later: a "call back" status, bot) |
| A3 | Villages asking but not served (expansion map); 20 L requests outside Bijepur | "not serviceable" outcome | after Step 0 (area list) + Step 1 | bot (log the outcome + village); where the area list lives: decided in Step 0 |
| A4 | What the menu is missing: messages the bot could not understand | `Message_Logs` (body, stage) | now (manual read); grouped after Step 1 | bot (Step 1: log "unrecognised" with the stage) |
| A5 | When customers write (hour × weekday) | `Message_Logs` timestamps | now | — |
| **B. Experience** |||||
| B1 | Ratings, comments, interest topics | `Feedback` | now | — |
| B2 | Why people ask for a person | handoff log | after Step 1 | bot (Step 1: handoff reason) |
| B3 | Order → delivered time, by area | Order Capture order events | after Step 3 (bot orders in Order Capture) | PlantOps: report only, no schema |
| B4 | Cancellations with reasons; complaints by product / batch | Order Capture, Complaint Box | now for staff orders; bot orders after Step 3 | PlantOps: report only |
| **C. Customer base** |||||
| C1 | New vs repeat; reorder interval per product | Order Capture (and the Sheet until Step 3) | rough now; reliable after Step 3 | PlantOps: report only |
| C2 | Lapsed customers (ordered before, not for N days); contact only with opt-in | Order Capture + consent | list after Step 3; contact after Step 4 | PlantOps: report; bot: consent (Step 4) |
| C3 | Pack-size mix (1 L / 500 ml / 250 ml) by area | Order Capture lines + place | after Step 3 | PlantOps: report only |
| C4 | Customer type (shop / household / office / institution) | **not captured** (`Customers.tags` empty) | after a decision in Step 0 | PlantOps: customer type field on Order Capture customers (**schema change, ask first**); bot: one optional question or staff tagging |
| C5 | Orders per village, for route planning | Order Capture place | after Step 3 | PlantOps: report only |
| **D. Planning** |||||
| D1 | Seasonality (summer, festivals) | Order Capture history | needs months of data | — |
| D2 | Pending bot orders vs Floor Stock "Can make" (warn before a product runs out) | Order Capture + Floor Stock **through their APIs** | after Step 3 | PlantOps: a module-to-module read (design + approval; never another schema) |
| **E. Messaging results (Step 4 pilot)** |||||
| E1 | Opt-in / opt-out rates, by wording version | consent records | Step 4 | bot or Order Capture (where consent lives: Step 0) |
| E2 | Extra orders vs the no-message holdout; cost per extra order | campaign log + Order Capture | Step 4–5 | bot (campaign log) |
| E3 | "How did you hear about us?" (optional question) | bot | only if the owner approves | bot |

**Suggested order:** A2, A5, B1 now (a weekly read of the Sheet, no code); A1, A4, B2 with Step 1; B3, B4, C1, C3, C5
as one Order Capture "Customer insights" page after Step 3; C2 and E with Step 4; C4 and D2 only after an approved
design.

---

## 12. Done log

| Date | Step | What |
|---|---|---|
| 2026-10-20 | R (part) | Bot moved to `bluemins/order_handoff` (clean import, no secrets); Railway project `bluemins-whatsapp-bot` deploys `production`; live order → Sheet OK; live secrets checked (never committed). Details: bot `docs/REPO_MOVE_PLAN.md`. |
| 2026-10-20 | R (part) | Both `~/projects` copies of the old repo were already gone; `whatsappbot-main` removed from `additionalDirectories`; copies outside `~/projects` left alone (owner). Unused Railway variables listed in bot `docs/REPO_MOVE_PLAN.md` step 2 (keep `RAILPACK_INSTALL_CMD`). Left for the owner: items 1–4, deleting those variables. |
| 2026-10-20 | R | Owner: items 1–4 done and the unused Railway variables deleted (owner-confirmed); bot `/health` OK. **Step R done.** Next: step 0. |
| 2026-10-20 | 0 (part) | `docs/WHATSAPP_CONTRACT.md` written: current-state map (whole bot repo read), owner checklist answered (no price in the bot, Rates default rate, 200-box limit, area list in Order Capture, support contact in Business details, English first, consent in Order Capture via bot + staff tick, pilot 70/30 ₹500 cap), draft API, English texts approved, reminder template wording. Left: formal contract sign-off. |
| 2026-10-21 | 0 | Ordering templates recorded (intro = Text with no buttons; product picker and add more: button IDs as in the bot code, owner); feedback templates left for later. Support phone + hours added to Business details (v0.28.1, migration `0019`). **Owner signed off the contract (section 3). Step 0 done.** Next: Step 1. |
| 2026-10-21 | 1 | Plan approved (BACK = CANCEL; today's yes words until Step 3; signature report mode for go-live). Built on bot `main` `e9e52a2`: signature check, order lock, customer row on yes, HELP / MENU / CANCEL / STOP / START / PERSON, two misses → handoff, logs, 33 tests, no new dependency. Next: Railway variables, push `production`, live checks, then `enforce`. |
| 2026-10-21 | 2 (plan) | Approved: context endpoint (no rates, contract wins over this prompt), REPEAT last delivered order ("Your last order (12 Oct): … Reply REPEAT to order the same again, or tap a size below."), handoff + "Not great" alerts via Order Capture (owners + ticked + last order's taker), support from Business details via branding, bot key in `ORDER_BOT_KEYS` (credential approved), area list moved to Step 3. Build waits for Step 1 live. |
| 2026-10-21 | 1 (go-live) | Owner set the bot's Railway variables; Twilio webhook checked. Pushed `e9e52a2` (tag `3.1.0`) and PlantOps v0.28.1 (`3fd9a0c`, migration `0019` applied live) to `production`; a Railway outage paused builds, both still on old code after an hour. Handover in section 0. |
| 2026-10-23 | 1 (go-live) | Railway back. Bot runs Step 1 (unsigned HELP from `+910000000001` answers "How to use…", report mode). PlantOps v0.28.1 built after "Deploy latest commit" (deployment `d5b20e3f`); checks OK. Left: section 0 items 3–5 (owner's phone checks, `signature: valid` in the logs → `enforce`, support fields in Business details). |
| 2026-10-23 | 1 | Owner's phone checks and Deploy Logs (`"signature":"valid"`) OK; `TWILIO_SIGNATURE_MODE=enforce`: unsigned and fake-signed POSTs 403, `/health` OK, the owner's "hi" answers. Plant 001's support phone + hours saved in Business details. **Step 1 done.** Next: build Step 2. |
| 2026-10-23 | 2 | Built on `main` in both repos: Order Capture bot API (context + alerts, key by hash, plant from the key, limits, audit, 22 tests), platform branding + two kinds, bot client + REPEAT + alerts (16 tests). Not deployed; release steps in section 0. |
| 2026-10-23 | 2 (go-live) | v0.29.0 (`0293b1f`) and bot 3.2.0 (`4b0de3e`) live; bot key made (only its hash on `order-capture`, the key on `whatsappbot`; scratch copies deleted). Live API checks: no / wrong key 401, unknown number "not found", Basanta cafe's answer matched the database. Owner: "Step 2 works". Order Capture logged 3 context calls, no alerts yet (PERSON / "not great" not confirmed). **Step 2 done.** |
| 2026-10-23 | 3 (plan) | Design proposed (section 8). Owner: area list after the pilot; ask the landmark once with SKIP. |
| 2026-10-24 | 2 | Owner's live checks: "not great" and PERSON both raise the bell alert. HANDBOOK change in `c7be459` kept. |
| 2026-10-24 | 3 | Built on `main` in both repos (owner "build"): Order Capture v0.30.0 (create through the staff save, by key, off switch, 14 tests) and bot 3.3.0 (landmark → summary → YES → Order Capture, background finish by key, leads, 200-box limit, `BOT_ORDERS` off / pilot / on, PERSON support hours, 19 tests). Not deployed; release and pilot steps in section 8. |
| 2026-10-20 | — | This plan written. |
