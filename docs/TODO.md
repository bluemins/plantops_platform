# PlantOps — TODO

The one list of future work and ideas. The owner keeps it; Claude adds to it when asked ("add this to the TODO").
Each item links to its plan once it has one. Bugs and issues in what is already built: `docs/BUGS.md` (B-numbers,
with priority). WhatsApp step details: `docs/WHATSAPP_BUILD_PLAN.md`.

**Status words:** idea · planned · in progress · waiting (on what) · done (date) · dropped.

Filled on 2026-10-24 from CLAUDE.md, every `apps/*/NOTES.md`, the plan docs ("Not in this version" sections),
`docs/deployments/shared.md`, `docs/STABILITY_PLAN.md` and Claude's notes.

## Next (in this order)

| # | Work | Where | Status | Notes |
|---|---|---|---|---|
| 1 | **Chatbot: more engaging, fix customer interaction** (wording, menus, Odia / English, where customers get stuck, misunderstood replies) | Bot (`~/projects/order_handoff`) | planned — **live before 2026-11-09** (first reminders lead into this flow); plan `docs/WHATSAPP_CHAT_PLAN.md`; owner's 7 decisions given 2026-10-25; **Phase 1 (English) live 2026-10-25, bot 3.5.3**: owner's phone test open; Phase 2 Odia next (handover: build plan section 0); Phase 2 = Odia text + 7 `_od` templates | Moved to #1 by the owner 2026-10-24. No Order Capture change. Rules-first, no AI; don't disturb the reminder pilot (to 2026-12-19). **Found in the Sheet logs (13 Sep–24 Oct, read 2026-10-24; to confirm in the code):** (a) a real customer (…155459, 20 Sep) lost mid-order: typed "500ml", then "500 ml / 1 l" in one message, then "1", "10" — never converted; (b) another (…018508, 9 Oct) typed "Rate", "Hindi", "Majalgaon", "??" and got nowhere: no price answer, no Hindi, outside the area; (c) 5 customers pressed the delivery thank-you buttons ("Okay" / "Great"), one logged as "unrecognised"; (d) "Repeat" right after an order and "Not great" outside the feedback flow: "unrecognised"; (e) mixed Odia / English within one order; (f) many "Hi"-only sessions that stop at the intro. Plus the Step 3 leftovers ("ok" instead of YES, 201 boxes, non-customer number) |
| 2 | **Customer insights page** (owner only): delivery time by area, new vs repeat, reorder interval per product, orders per village (+ cancellations, pack mix, lapsed list) | Order Capture | idea | Group-level only, no scores of individuals; report only, no schema. Ideas in `WHATSAPP_BUILD_PLAN.md` section 11 (B3, B4, C1, C3, C5) |
| 3 | **Field day log** for Field staff (start / end km + photo, shop visits from Order Capture customers, GPS at each, shop location on the customer) | Attendance & Salary (+ Order Capture) | planned | `docs/FIELD_DAY_PHASE_PLAN.md`; mock-ups (https://claude.ai/artifact/EutRdTDJaBw7tHpHLXcUCq) to approve, with the additions listed at the top of the plan. Shop location now comes first through the customer page (#4); the visit later saves into the same record |
| 4 | **Customer page** like Zoho (Customers card on the owner's dashboard; Overview / Transactions / Comments / Statement; owner edits all fields; shop location "📍 Save my location here") | Sales (+ platform card) | Part 1 live v0.44.0, Part 2 + GST details live v0.45.0 (2026-11-07); **next: Part 3** (Zoho Contacts fill) | `docs/CUSTOMER_PAGE_PHASE_PLAN.md`; mock-up https://claude.ai/artifact/NcJtuLX74cmspbpZU5vgzx. Still open: the 📍 Map link on the order page and in "Copy as WhatsApp message"; confirm Zoho takes the billing columns; try 📍 on a real phone |

## Before the October salary month end (31 Oct) — owner, Attendance at plant 001

Owner, 2026-10-24: steps understood. Open rows: OFF days (Anmol), unmarked days (Gaja 21–23 …), Plant staff on the 3
accounts, then 31 Oct ("See as worker" for each person before marking paid).

| Task | Status | Notes |
|---|---|---|
| Salary type per person from October | done (checked 2026-10-24) | Fixed: Kedar, Dillip, Prakash, dirju, maheswar. Per day: reeta, Damayanti, joshobanti, Mohan, sushil. Monthly: Ramu (0 leave), bindu / Gaja / Anmol (2) |
| 8 h work + 1 h lunch from October | done (checked 2026-10-24) | reeta, Damayanti, joshobanti, Ramu, bindu, Gaja, Anmol. Mohan and sushil stay 9 h with no lunch on purpose (owner, 2026-10-24) |
| Tick **Field staff** on Dillip and Kedar | done (checked 2026-10-24) | both with TA ₹2 / km, DA ₹100 / day |
| Permanent / Temporary | done (checked 2026-10-24) | Temporary: Damayanti, Mohan, sushil, joshobanti; reeta is Permanent (per day) |
| Review October OFF days, now unpaid | open | Only **Anmol** (6 OFF: 7–9, 21–23; 2 covered by leave, 4 cut at salary ÷ 30) changes pay. Ramu moved to per day ₹1,000 on 2026-10-24 23:21 (matches the owner's September sheet: present days × ₹1,000 + OT ₹125 / h), so his 4 OFF days are simply unpaid days. Per-day people get ₹0 for an OFF day either way (same as absent); fixed people are paid in full; Gaja's 1 is covered by leave. Damayanti's 1–5 Oct makes no pay difference (per day) |
| Days with no IN / OUT and no ON / OFF mark (1–23 Oct, checked 2026-10-24): really absent, or forgot to mark? | open | Matters for monthly staff: **Gaja 21, 22, 23** (absent beyond her 2 leave → cut) and **bindu 5** (covered by leave). Per day (unpaid if not marked): Damayanti 23, reeta 20, joshobanti 1–5 + 21–23 (she started 6 Oct?). Mohan (1 day) and sushil (3 days) look like occasional workers. Fix with Mark days (ON) or Fix (add the times) |
| This month's advances entered | done (owner, 2026-10-24) | On record (checked 2026-10-24): Anmol ₹5,000 (6th ₹2,000 + 20th ₹3,000), dirju ₹5,000, maheswar ₹3,000, Damayanti ₹1,500 (₹1,000 on the 20th corrected once), Ramu ₹1,000. Add any others before 31 Oct |
| Plant staff without a salary: `bluemins` (owner), `bluemins_lab_lead`, `bluemins_lab` (disabled) | open | They count as employees with "No salary set". Remove Plant staff from them unless they are paid staff |
| 31 Oct 07:00: "salary review" notification arrives → fix no-exit days → check two people with the checking panel → mark paid → one slip with "Can see own salary" | waiting (owner on 31 Oct) | `docs/deployments/shared.md` v0.20.0 checklist |
| Plant 001 attendance circle to 300 m standing outside (still 2,000 m) | deferred | bug B-04 |

## Open owner tasks — WhatsApp

| Task | Status | Notes |
|---|---|---|
| Sheet **Leads** tab: customer orders 19:34–22:21 on 2026-10-24 → enter in Order Capture by hand | done (owner, 2026-10-24) | bot was still in pilot mode then (B-20) |
| Staff ask customers about reminders and tick "Agreed to WhatsApp reminders" | open | first reminders 2026-11-09 |
| Cancel test orders O-0069 and O-0072 | open | |
| Twilio Debugger: click a 93101 entry, note the webhook URL | open | bug B-21 |

## Owner checks on the live copy (built, never tried on screen)

| Module | Check | Status |
|---|---|---|
| Platform | iPhone phone notifications (iOS 16.4+, add to Home Screen, "Send a test"); does a tapped notification ask for login again (B-24) | open |
| Platform | A user with **only** Plant staff: refused by Floor Stock, lands in Order Capture view | open |
| Floor Stock | Day page + "Copy as WhatsApp message"; the 5 "Decisions to confirm" (`apps/floor-stock/NOTES.md`) | deferred (2026-10-13) |
| Floor Stock | "Made from" on the five Empty Bottle items (v0.19.0) | open |
| View roles (v0.27.0) | Stock viewer + Who sees what + phone login + their bell; Document viewer read-only (`docs/VIEW_ROLES_PHASE_PLAN.md` checklist) | open |
| Attendance | Office staff / Supervisor checklist (deploy record v0.23.0 row): mark for someone, fix, advance, morning alert, Supervisor fixes Office staff (v0.26.1) | open |
| Attendance | Field duty with DA unticked (v0.24.0); claims with a bill photo from a phone; photo survives a redeploy; photo in the nightly backup | open |
| Attendance | "Mark days" several days at once (v0.28.0); Salary tab + ON / OFF on a phone (v0.26.0) | open |
| Attendance | Marking on Android / iPhone after the GPS change (B-04) | open |
| Order Capture | Search a customer by name on New order (v0.26.2); "Copy as WhatsApp message" with rates (v0.20.1); note added after saving + its bell (v0.16.0) | open |
| Document Store | Expiry phone notification reaches the responsible person (demo plant); add / renew with a phone photo | open |
| Complaint Box | iPhone HEIC photos and Safari video | open |
| Job applications | Plant 001 checklist (deploy record "Pending: Job applications"): openings complete, QR poster, HR desk, test sends from Android + iPhone, status / note / CSV, Remove now | open |
| Lab Records | Approve / hold / release on the live copy | low (module not in use) |

## Housekeeping and security

| Task | Status | Notes |
|---|---|---|
| **Rotate Railway secrets** (after Railway's 2026-10-21 incident): `scripts/rotate-railway-secrets.sh shared` makes new database passwords (incl. postgres and the backup login), SSO signing key, module session and client secrets, `CRON_SECRET` and `DROP_CODE_SECRET`; step 1 writes `.env.railway.shared.rotate` to stage in Railway without deploying, step 2 (type ROTATE) changes the database, then deploy. Steps: HANDBOOK section 8 "Changing a secret" | deferred | **Status 2026-11-10:** script updated and committed (`daea6e3`), never run; nothing rotated yet. Afterwards everyone logs in again and the Attendance QR is printed again. Not covered by the script: R2 keys (4 services; pasted into a chat on 2026-10-17), `CRON_SECRET` in GitHub + the 13 cron-job.org jobs, Twilio, Drop push key (`FCM_SERVICE_ACCOUNT`), bot key (`ORDER_BOT_KEYS`) and calls key (`ORDER_CALL_KEYS`, MacroDroid). `CRON_SECRET` appeared in a screenshot on 2026-11-09: change at least that one soon. Do at night (23:05–06:55 IST) |
| **Change `CRON_SECRET` on its own** (seen in a screenshot 2026-11-09; do before the full rotation, ~20 min, 23:05–06:55 IST): (1) `openssl rand -hex 32` on your computer, save it in the password manager; (2) Railway `CRON_SECRET` on all 8 services (platform, lab-records, document-store, floor-stock, complaint-box, order-capture, attendance-salary, job-applications); (3) GitHub environment `shared` secret `CRON_SECRET`; (4) header `x-cron-secret` on all 13 cron-job.org jobs, Drop push first (HANDBOOK section 10 list); (5) check: **Test run** on 2–3 jobs = 200 (401 = old value left somewhere), Daily jobs by hand green, next morning's 07:01 runs in Execution history; then record it in `docs/deployments/shared.md` | next (owner, when free) | Steps: HANDBOOK section 8 "Changing a secret" → `CRON_SECRET` |
| Change demo plant 999's owner password (typed into a chat once) | open | `.env.demo` |
| Update the password-manager copy of `.env.railway.shared` (gained the Job applications module URL / secret) | open (check) | the `.paste` files are already deleted (checked 2026-10-24) |
| Railway cost: Serverless (sleep when idle) for `lab-records`, then `document-store` and `complaint-box`; Healthcheck Path `/health` on `job-applications`; send Railway per-service memory | open | `STABILITY_PLAN.md` section 9 |
| UptimeRobot account (once a day per address) | open | bug B-09 |
| Lab Records off for plant 001 (or "no tests today" Off); resolve the open complaints | open | bug B-07 |
| Ask Dillip and Gaja which phone and how they open PlantOps | open | bug B-03 |
| Renew or archive the document expired since 31 Mar 2026; everyone responsible for documents turns on phone notifications | open | bug B-02 |

## Waiting

| Work | Waiting for | Notes |
|---|---|---|
| WhatsApp Step 5: learn from the reminder pilot | pilot end 2026-12-19 | `WHATSAPP_BUILD_PLAN.md` section 10 |
| Area list (villages served) for the bot | bot taking new customers | |
| Lab Records WhatsApp alerts | Meta approval | |
| Lab Records Form 3 "Record of Test Report" column | a plant saying what goes there | bug B-14 |
| Purchases: **vendor credits** (a return or price correction from a vendor, used on the next payment) | the first vendor credit (none in 9 months of Zoho) | Owner 2026-11-10. Until then: cancel the purchase bill and record the corrected one. Needs a Sales migration (ask then). `docs/PURCHASES_PHASE_PLAN.md` P4 |
| Purchases: **link purchase items to Floor Stock materials** (Preform 18.5 g in kg = "Preform 18.5" counted in packets, 1 pkt = 25 kg): purchase vs count checks, later cost per box | the module-to-module design (with the batch lookup below) | Owner 2026-11-10. `purchase_items.stock_item_id` is ready (0016). `docs/PURCHASES_PHASE_PLAN.md` P5 |
| Purchases: **expenses** (diesel, power, freight, repairs, tea) | the Cash book (`docs/CASHBOOK_PHASE_PLAN.md`) | Owner 2026-11-10: built once, inside the Cash book; Reports → Purchases adds them once it is live |

## Later (features)

| Work | Where | Status | Notes |
|---|---|---|---|
| **Staff app (PureVibe APK) leftovers** (low priority): Job applications redeploy so `jobs.` serves `/.well-known/assetlinks.json` (404 on 2026-11-12); the phone checklist (`docs/STAFF_APP_PHASE_PLAN.md` section 4: no address bar on every tile, test push, Attendance QR + location, photo upload, back / Logout); HANDBOOK section "Staff app (Android)"; later Play Store (after D-U-N-S) and a "Get the app" link on the login page | Platform / `apps/staff-app` | low | Plan closed by the owner 2026-11-12; v0.66.0 live, APK `~/projects/staff-apk/PureVibe-staff-1.0.1.apk`. Rebuild: `apps/staff-app/README.md`. Key in `~/projects/android-tools/keys/` (copy to the password manager) |
| Demo plant set-up script (fake users, products, sample data) | Platform | idea | helps selling; demo plant 999 exists |
| Purchases: **photo of the vendor's bill** on a purchase bill (P6) | Sales | idea | Owner 2026-11-10: after P3. Needs file storage + nightly backup in Sales (today it stores no files). `docs/PURCHASES_PHASE_PLAN.md` P6 |
| Hindi / Odia screens, staff modules first (Floor Stock count, Attendance scan, Order Capture), then Lab Records, Salary, Job applications public page | All | idea | CLAUDE.md UX |
| Fewer, better alerts: daily summary option | Platform | idea | most alerts go unread (B-07) |
| Floor Stock dispatch entries with the Lab Records batch check + batch lookup API | Floor Stock + Lab Records | idea | module-to-module design (the field day lookup ticket can be reused): ask first |
| Floor Stock: "Delivered by orders" next to "Sold" on the day page (leakage check) | Floor Stock + Order Capture | idea | module APIs only |
| Floor Stock: purchases, party list, who holds returnable jars, history paging, godown stock (several godowns, transfers, ledger) | Floor Stock | idea | long-term owner idea 2026-10-04 |
| Attendance: weekly-off rules, holiday lists, leave requests from the phone, marking a date for everyone | Attendance | idea | day marks cover it for now |
| Attendance: worker asks for a correction; teams per supervisor | Attendance | idea | |
| Salary: printed / PDF payslips; PF / ESI / TDS deductions; advance requests from workers; per-vehicle km rates | Attendance & Salary | idea | |
| **Sales ledger: still missing compared with Zoho Books** (owner, 2026-11-06: "do it later"; v0.39.0 has orders, bills, payments, advances, statements, cancellations, CSV) | Order Capture | later | plan `docs/ZOHO_IMPORT_PHASE_PLAN.md`; owner picks the order |
| ↳ Credit notes (goods returned, price corrected after billing), applied to bills or refunded | Order Capture | later | likely a new table: ask first |
| ↳ Receivables **aging** report (0–30 / 31–60 / 61–90 / 90+ days per customer) | Order Capture | later | no schema change (worked out from bills) |
| ↳ **Sales by customer / by product / by brand** for a date range, with CSV | Order Capture | later | no schema change |
| ↳ **Payment reminders** for overdue bills (bell to the owner; WhatsApp to the customer with a template) | Order Capture | later | WhatsApp needs an approved Twilio template and consent: ask first |
| ↳ A bill **without an order** (walk-in / counter sale) | Order Capture | later | |
| ↳ Recurring bills (monthly fixed customers) | Order Capture | later | |
| ↳ Send bills to Zoho for the **GST invoice** automatically (send queue, decision 4.9 in `docs/CUSTOMER_APP_PLAN.md`) | Order Capture | later | Zoho API credential: ask first; CA question 11 |
| ↳ A Zoho contact's "no phone yet" bills on the Match screen counts; delivered orders "Check these" (44 at plant 001) linked by hand | Order Capture | later | the import listed them; linking by hand not built yet |
| Order Capture: Zoho Invoice link (draft invoice from a delivered order) | Order Capture | idea | only if retyping becomes a nuisance |
| Order Capture: delivery dates, assigning orders to a driver, partial delivery | Order Capture | idea | |
| Order Capture: public order link / QR for customers | Order Capture | idea | the bot covers most of this now |
| Customer type (shop / household / office / institution) | Order Capture | idea | schema change: ask first |
| Bot demand vs Floor Stock "Can make" | Order Capture + Floor Stock | idea | module APIs only |
| Complaint Box: customer looked up by phone (from Order Capture), complaint by QR / WhatsApp, message back to the customer, assign to a person, link the batch to Lab Records | Complaint Box | idea | |
| Job applications: "Hired" creates the PlantOps user / Attendance person; messages to applicants | Job applications | idea | |
| Phase 6 Preventive Management | new module | idea | new Railway service = cost |
| Phase 7 AMC, Phase 9 Marketing Contacts, Phase 10 website / provisioning | new modules | idea | |

Parked, no date: Document Store real S3 bucket; India hosting.

## New ideas

Add new ideas here (one line each, with the date). They move up to "Next" or "Later" when decided.

| Date | Idea | Notes |
|---|---|---|
| 2026-10-24 | **Mid-month payment for per-day staff:** clear a per-day person's pay in the middle of the month and mark it as a payment (paid up to a date), not only at month end | Today "Mark paid" works per whole month; a mid-month amount can only be entered as an advance (`SALARY_PHASE_PLAN.md` "Not in this version": partial payments). Needs a design: "paid up to <date>" vs an amount, the slip, the month-end balance |
| 2026-10-24 | **Job applications: public page off for a while, owner enters applicants by hand:** switch `jobs.bluemins.life` off temporarily (no public form), and the owner (tenant_admin) adds an applicant's details from their own login (e.g. someone who phoned or walked in) | Today each opening can be switched off, but there is no "whole page off" switch and no owner "Add applicant" form. Check the wording: "customer details" read as applicant details |
| 2026-11-01 | **Daily action agent (next session):** a morning (08:30 IST) AI agent that reads plant 001's order + stock data and writes the day's action items with a reason each, like section 6 of `docs/ORDER_FLOW_LEAN_ANALYSIS.md` | Recommended: 2-week trial of a scheduled Claude agent, first a **narrow read-only database login** (order / stock totals only, no names or phones: permission change, ask). Options: cloud agent / this PC / rules built into PlantOps (bell + phone; later, for the actions that prove useful). The date-range page idea is on hold (owner, 2026-11-01) |
| 2026-11-06 | **Customer app "Book it" (name to change):** one Play Store app (Capacitor) for 20L, Bluemins and Mr.Charge customers on the PlantOps backend; 20L first, replacing PurePani (delivery + empties, jar balance, dues, payments, monthly bill, pause), then B2B ordering, then cross-selling | Under discussion; waiting for PurePani customer-app screenshots + 5 answers. 20L ledger proposed inside Order Capture (schema changes: ask). Native app goes against CLAUDE.md "PWA only in v1": owner's OK needed. Everything discussed: `docs/CUSTOMER_APP_PLAN.md`; demo APK in `~/projects/book-it-demo` |
| 2026-11-06 | **Marketplace (very far off):** other businesses list their products in "Book it" and customers see them all | Crosses plants, so needs an opt-in public catalogue, not shared tenant data (RLS). Also brings payments to others, GST, delivery and disputes. Keep "Book it" generic (brand / business as data) so it stays possible |
| 2026-11-09 | **Drop: shop polls + points:** weekly 1–2-question tap polls to shops (fastest size, stock-outs, supplier pain, margin, udhaar, wish list), answers tagged by place / buying volume and cross-checked with real orders; points for buying and for answering, redeemed as free boxes | Draft maths (owner): 1 point per ₹10, 1 point = ₹0.25 of cost (2.5 % back); production cost per box 1L ₹80 → 320 points, 500 ml / 250 ml ₹125 → 500. Selling price per box (owner, 2026-11-09): 1L ₹85, 500 ml ₹130, 250 ml ₹143, so profit per box only ₹5 / ₹5 / ₹18 and 2.5 % back would eat 42 % / 65 % / 20 % of it. **Decided (owner, 2026-11-09): 1 point per ₹20 of bill, 1 point = ₹0.10 of cost (≈ 0.5 % back); free box = 800 points (1L) / 1,250 (500 ml, 250 ml), ≈ 1 free box per 200 bought** (reward = 8.5 % / 13 % / 4 % of profit on 1L / 500 ml / 250 ml). Seasonal (owner, 2026-11-09): off season 1L already gets 2 free on 24 boxes (26 boxes made for ₹2,040 = ₹40 below the ₹80 cost); recommended: free boxes earn no points, points earned all year but **redeemed only in the off-season months** (off season = **July–January**, peak = February–June, owner 2026-11-09; the ₹80 / ₹125 include fixed costs (salaries, power standing charge), so an off-season free box really costs only its materials + running power (owner's cost sheet 10 Oct 2026, 1L per bottle: bottle 3.76, cap 0.25, shrink 0.95, label 0.27, water 0.65, power 0.2 = ₹6.08 → **≈ ₹73 a box**; the sheet also has labour 0.25, transport 0.1, load 0.1, margin 0.5 → ₹84.36): keep 1 point per ₹20 to start and raise later if needed; spare capacity; a peak-season free box displaces a sale). Off-season free-box schemes (owner, 2026-11-09): 1L 2 free on 24, **500 ml 2 free on 48**, 250 ml none. **Points expire on 31 January each year (owner, 2026-11-09):** points year = 1 Feb – 31 Jan; recommended: start counting from 1 Feb 2027 and remind shops with unspent points in December and January. Also recommended: earn on **paid** bill value before GST (`CUSTOMER_APP_PLAN.md` 18.2 point 2), so no hold period or reversals; redeem as a free-box line on the next order (v0.48.0); poll 10 points, 1 counted a week, only shops that ordered in the last 30 days; polls first (no money risk), points after. Shop type needs the "customer type" field (schema change, ask). New tables for polls / answers / points ledger: ask. **Now Drop's first version (owner, 2026-11-09): `CUSTOMER_APP_PHASE_PLAN.md` D7–D10, Phases 3–4** |
| 2026-10-24 | **Leave policy attached to each employee:** the owner defines policies, e.g. (a) 2 paid leave a month, (b) a yearly allowance + choice (optional) leaves, and picks one per person | Today: one "paid leave per month" number per person (lapses each month). Joins the "weekly-off rules, holiday lists, leave requests" item under Later. Likely a schema change: ask first |

## Done

| Date | Work |
|---|---|
| 2026-10-24 | Attendance "See as worker" slip preview for the owner (v0.31.1, tested by the owner on Ramu); salary type name removed from the worker's slip (v0.31.2). Overtime now counted to the minute (owner: "earlier not that precise, now precise") |
| 2026-10-24 | WhatsApp Steps 3–4 live; reminder pilot on from 2026-10-25; `BOT_ORDERS=on` deployed; owner's test order O-0072 + consent |
| 2026-10-23 | Attendance lunch break, short days, three salary types (v0.29.1–v0.29.3); WhatsApp Step 2 (v0.29.0) |
| 2026-10-20 | Attendance "Mark days" (v0.28.0) |
| 2026-10-19 | Day marks (v0.26.0); view-only roles (v0.27.0); error log (v0.25.5); tests on GitHub |
