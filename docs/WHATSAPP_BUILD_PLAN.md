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

## 0. Handover: start the next session here (2026-10-21, end of day)

**Where it stopped:** Step 1 is built and pushed to the bot's `production` branch, but **not live**. A Railway outage
("Dashboard and API unavailable, builds paused", 2026-10-21 ~17:40 IST) stopped every build. After an hour of checks
both services still ran their old code. During the outage the bot's Redis refused connections for a while (17:40);
it answered normally again afterwards.

| Item | State on 2026-10-21 |
|---|---|
| Bot `production` branch | `e9e52a2` (tag `3.1.0`, Step 1) — **pushed, not built**. Live service still runs deployment `eb94237f` (2026-10-20 13:20, old code). |
| Bot Railway variables (`whatsappbot`) | **Set by the owner:** `PUBLIC_BASE_URL=https://whatsappbot-production-70de.up.railway.app`, `TWILIO_SIGNATURE_MODE=report`, `SUPPORT_PHONE=7090443303`, `SUPPORT_HOURS`. Twilio webhook checked: exactly `…/whatsapp/inbound`, HTTP POST. |
| PlantOps v0.28.1 (support phone + hours on Business details) | Migration `0019` **applied on the shared copy** (columns checked); `production` = `3fd9a0c` (tag `v0.28.1`) — **pushed, not built**. Old code works with the new columns. |
| Step 2 | **Plan approved** (done log, 2026-10-21); build only after Step 1 passes its live checks (owner). |
| Test rows | About 20 `Message_Logs` rows from the made-up number `whatsapp:+910000000001` (deploy checks): safe to delete. |

**Update 2026-10-23:** items 1 and 2 done. Both are live: the bot runs `e9e52a2` (report mode) and the platform
v0.28.1 (deployment `d5b20e3f`). Item 5 done too (plant 001: 7090443303, "10 am to 6 pm (MON - SAT )"). Continue
from item 3.

**Update 2026-10-23 (later):** items 3 and 4 done. The owner checked the phone flow and the logs (`"signature":"valid"`), set
`TWILIO_SIGNATURE_MODE=enforce`; unsigned and fake-signed messages get 403, the owner's "hi" still answers. **Step 1
done.** Next: item 6, build Step 2.

**Next session, in this order:**
1. Railway banner gone? If the new deployments did not start by themselves, open each service, **Ctrl+K → "Deploy
   latest commit"** (not "Redeploy", which rebuilds the old commit): `whatsappbot` must show `e9e52a2`, `platform`
   (project `plantops-shared`) `3fd9a0c`. Source branch must be `production`.
2. Quick check from the terminal: an unsigned `POST /whatsapp/inbound` with `Body=help` from `+910000000001` answers
   "How to use…" (new code, report mode) instead of "Say 'Hi'…" (old code). Platform: the page build id is no longer
   `f6Xv-By4unn9reuc3CjmQ`.
3. **Step 1 live checks (owner's phone):** HELP → "How to use…"; a full order tapping every Odia button (sizes,
   "ଆଉ ଲାଗବା", "ଆଉ ନାହିଁ ଲାଗେ କିଛି"), `yes` → exactly one `Orders` row and, for a new number, one `Customers` row;
   PERSON → 7090443303 + hours; STOP then START; MENU → welcome template.
4. Owner sends the new deployment's Deploy Logs: every inbound line must show `"signature":"valid"`. Then the owner
   sets `TWILIO_SIGNATURE_MODE=enforce`, and an unsigned test message must get 403. Tick Step 1 done (status + done log).
5. PlantOps: owner fills **Customer support phone** (7090443303) and **Support hours** (with days) in Business details;
   update `docs/deployments/shared.md` and the v0.28.1 status note in CLAUDE.md ("live").
6. Then build **Step 2** from the approved plan (done log 2026-10-21; section 7 prompt with the corrections noted
   there).

**Known gap until Step 2:** the handoff text says "We have passed your message to our team", but in Step 1 nothing
reaches staff; handoffs are only `handoff_…` rows in `Sessions_Log`. Step 2's alerts fix this.

**Rules learnt this session:** give a recommendation with every question (owner); never push a bot release before its
Railway variables exist (enforce mode with no `PUBLIC_BASE_URL` refuses every message).

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
| 2 | Read-only Order Capture adapter + bot reads it | both | the API design; credential setup; production pushes | **plan approved** (2026-10-21); **building** (from 2026-10-23) |
| 3 | Confirmed-order write; Sheets stops being an order ledger | both | endpoint + transaction design; any schema / grant change; go-live | open |
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
| 2026-10-20 | — | This plan written. |
