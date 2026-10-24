# PlantOps — TODO

The one list of future work and ideas. The owner keeps it; Claude adds to it when asked ("add this to the TODO").
Each item links to its plan once it has one. Bugs and live checks stay in `docs/STABILITY_PLAN.md` (B-numbers);
WhatsApp step details in `docs/WHATSAPP_BUILD_PLAN.md`.

**Status words:** idea · planned · in progress · waiting (on what) · done (date) · dropped.

## Next (in this order)

| # | Work | Where | Status | Notes |
|---|---|---|---|---|
| 1 | **Customer insights page** (owner only): delivery time by area, new vs repeat, reorder interval per product, orders per village (+ cancellations, pack mix, lapsed list) | Order Capture | idea → plan next | Group-level only, no scores of individuals; report only, no schema. Ideas listed in `WHATSAPP_BUILD_PLAN.md` section 11 (B3, B4, C1, C3, C5) |
| 2 | **Chatbot: more engaging, fix customer interaction** (wording, menus, Odia / English, where customers get stuck, misunderstood replies) | Bot (`~/projects/order_handoff`) | idea | Start from real conversations (Sheet `Message_Logs`, `Sessions_Log`). Rules-first, no AI. Must not disturb the reminder pilot (to 2026-12-19) |
| 3 | **Field day log** for Field staff (start / end km + photo, shop visits from Order Capture customers, GPS at each, shop location on the customer) | Attendance & Salary (+ Order Capture) | planned | `docs/FIELD_DAY_PHASE_PLAN.md`; mock-ups to approve before building. Claims untouched |

## Open owner tasks

| Task | Status | Notes |
|---|---|---|
| Twilio Monitor → Errors: any 11200 between 20:11 and 21:59 IST on 2026-10-24 (bot stopped); call those customers back | open | |
| Sheet **Leads** tab: customer orders 19:34–22:21 on 2026-10-24 → enter in Order Capture by hand | open | bot was still in pilot mode then |
| Staff ask customers about reminders and tick "Agreed to WhatsApp reminders" | open | first reminders 2026-11-09 |
| Cancel test orders O-0069 and O-0072 | open | |
| Bot tests left from Step 3: "ok" instead of YES, 201 boxes, a non-customer number | open | can fold into #2 |
| iPhone phone notifications (iOS 16.4+, add to Home Screen, then "Send a test") | open | |
| A user with **only** Plant staff tried on screen | open | |
| Floor Stock day page + "Copy as WhatsApp message"; 5 decisions to confirm (`apps/floor-stock/NOTES.md`) | deferred (2026-10-13) | |
| Job applications pending list (`docs/deployments/shared.md`) | open | Turnstile, plant 001 checklist |
| Rotate R2 keys and `CRON_SECRET` (HANDBOOK section 8) | deferred | |

## Waiting

| Work | Waiting for | Notes |
|---|---|---|
| WhatsApp Step 5: learn from the reminder pilot | pilot end 2026-12-19 | `WHATSAPP_BUILD_PLAN.md` section 10 |
| Area list (villages served) for the bot | bot taking new customers | |
| Lab Records WhatsApp alerts | Meta approval | |

## Later (features)

| Work | Where | Status | Notes |
|---|---|---|---|
| Demo plant set-up script (fake users, products, sample data) | Platform | idea | helps selling; demo plant 999 exists |
| Hindi / Odia screens, staff modules first | All | idea | |
| Fewer, better alerts: daily summary option | Platform | idea | most alerts go unread |
| Floor Stock dispatch entries with the Lab Records batch check | Floor Stock + Lab | idea | token / module-to-module design: ask first |
| Weekly-off rules, holiday lists, leave requests | Attendance | idea | day marks cover it for now |
| Customer type (shop / household / office / institution) | Order Capture | idea | schema change: ask first |
| Bot demand vs Floor Stock "Can make" | Order Capture + Floor Stock | idea | through module APIs only |
| Phase 6 Preventive Management | new module | idea | new Railway service = cost |
| Phase 7 AMC, Phase 9 Marketing Contacts, Phase 10 website / provisioning | new modules | idea | |

Parked, no date: Document Store real S3; Floor Stock purchases, party list, returnable holders, history paging, godown
stock; India hosting.

## New ideas

Add new ideas here (one line each, with the date). They move up to "Next" or "Later" when decided.

| Date | Idea | Notes |
|---|---|---|

## Done

| Date | Work |
|---|---|
| 2026-10-24 | WhatsApp Steps 3–4 live; reminder pilot on from 2026-10-25; `BOT_ORDERS=on` deployed |
| 2026-10-19 | Day marks (weekly off by hand), v0.26.0 |
