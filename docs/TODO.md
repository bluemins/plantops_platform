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
| 1 | **Customer insights page** (owner only): delivery time by area, new vs repeat, reorder interval per product, orders per village (+ cancellations, pack mix, lapsed list) | Order Capture | idea → plan next | Group-level only, no scores of individuals; report only, no schema. Ideas in `WHATSAPP_BUILD_PLAN.md` section 11 (B3, B4, C1, C3, C5) |
| 2 | **Chatbot: more engaging, fix customer interaction** (wording, menus, Odia / English, where customers get stuck, misunderstood replies) | Bot (`~/projects/order_handoff`) | idea | Start from real conversations (Sheet `Message_Logs`, `Sessions_Log`). Rules-first, no AI. Must not disturb the reminder pilot (to 2026-12-19). Include the Step 3 leftovers ("ok" instead of YES, 201 boxes, non-customer number) |
| 3 | **Field day log** for Field staff (start / end km + photo, shop visits from Order Capture customers, GPS at each, shop location on the customer) | Attendance & Salary (+ Order Capture) | planned | `docs/FIELD_DAY_PHASE_PLAN.md`; mock-ups (https://claude.ai/artifact/EutRdTDJaBw7tHpHLXcUCq) to approve, with the additions listed at the top of the plan |

## Before the October salary month end (31 Oct) — owner, Attendance at plant 001

| Task | Status | Notes |
|---|---|---|
| Salary type per person from October | done (checked 2026-10-24) | Fixed: Kedar, Dillip, Prakash, dirju, maheswar. Per day: reeta, Damayanti, joshobanti, Mohan, sushil. Monthly: Ramu (0 leave), bindu / Gaja / Anmol (2) |
| 8 h work + 1 h lunch from October | done (checked 2026-10-24) | reeta, Damayanti, joshobanti, Ramu, bindu, Gaja, Anmol. **Owner to confirm:** Mohan and sushil (per day) are still 9 h with no lunch: intended? |
| Tick **Field staff** on Dillip and Kedar | done (checked 2026-10-24) | both with TA ₹2 / km, DA ₹100 / day |
| Permanent / Temporary | done (checked 2026-10-24) | Temporary: Damayanti, Mohan, sushil, joshobanti; reeta is Permanent (per day) |
| Review October OFF days, now unpaid | open | Only **Anmol** (6 OFF: 7–9, 21–23; 2 covered by leave, 4 cut at salary ÷ 30) changes pay. Ramu moved to per day ₹1,000 on 2026-10-24 23:21 (matches the owner's September sheet: present days × ₹1,000 + OT ₹125 / h), so his 4 OFF days are simply unpaid days. Per-day people get ₹0 for an OFF day either way (same as absent); fixed people are paid in full; Gaja's 1 is covered by leave. Damayanti's 1–5 Oct makes no pay difference (per day) |
| This month's advances entered | open | On record (checked 2026-10-24): Anmol ₹5,000 (6th ₹2,000 + 20th ₹3,000), dirju ₹5,000, maheswar ₹3,000, Damayanti ₹1,500 (₹1,000 on the 20th corrected once), Ramu ₹1,000. Add any others before 31 Oct |
| Plant staff without a salary: `bluemins` (owner), `bluemins_lab_lead`, `bluemins_lab` (disabled) | open | They count as employees with "No salary set". Remove Plant staff from them unless they are paid staff |
| 31 Oct 07:00: "salary review" notification arrives → fix no-exit days → check two people with the checking panel → mark paid → one slip with "Can see own salary" | open | `docs/deployments/shared.md` v0.20.0 checklist |
| Plant 001 attendance circle to 300 m standing outside (still 2,000 m) | deferred | bug B-04 |

## Open owner tasks — WhatsApp

| Task | Status | Notes |
|---|---|---|
| Sheet **Leads** tab: customer orders 19:34–22:21 on 2026-10-24 → enter in Order Capture by hand | open | bot was still in pilot mode then (B-20) |
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
| **Rotate Railway secrets** (after Railway's 2026-10-21 incident): `scripts/rotate-railway-secrets.sh shared` makes new database passwords (incl. postgres and the backup login), SSO signing key, module session and client secrets and `CRON_SECRET`; step 1 writes `.env.railway.shared.rotate` to stage in Railway without deploying, step 2 (type ROTATE) changes the database, then deploy. Steps: HANDBOOK section 8 "Changing a secret" | deferred | Afterwards everyone logs in again and the Attendance QR is printed again. Not covered by the script: R2 keys (4 services; pasted into a chat on 2026-10-17), `CRON_SECRET` in GitHub + the 12 cron-job.org jobs, Twilio, bot key. Do at night (23:05–06:55 IST). Script not yet committed |
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

## Later (features)

| Work | Where | Status | Notes |
|---|---|---|---|
| Demo plant set-up script (fake users, products, sample data) | Platform | idea | helps selling; demo plant 999 exists |
| Hindi / Odia screens, staff modules first (Floor Stock count, Attendance scan, Order Capture), then Lab Records, Salary, Job applications public page | All | idea | CLAUDE.md UX |
| Fewer, better alerts: daily summary option | Platform | idea | most alerts go unread (B-07) |
| Floor Stock dispatch entries with the Lab Records batch check + batch lookup API | Floor Stock + Lab Records | idea | module-to-module design (the field day lookup ticket can be reused): ask first |
| Floor Stock: "Delivered by orders" next to "Sold" on the day page (leakage check) | Floor Stock + Order Capture | idea | module APIs only |
| Floor Stock: purchases, party list, who holds returnable jars, history paging, godown stock (several godowns, transfers, ledger) | Floor Stock | idea | long-term owner idea 2026-10-04 |
| Attendance: weekly-off rules, holiday lists, leave requests from the phone, marking a date for everyone | Attendance | idea | day marks cover it for now |
| Attendance: worker asks for a correction; teams per supervisor | Attendance | idea | |
| Salary: printed / PDF payslips; PF / ESI / TDS deductions; advance requests from workers; per-vehicle km rates | Attendance & Salary | idea | |
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

## Done

| Date | Work |
|---|---|
| 2026-10-24 | WhatsApp Steps 3–4 live; reminder pilot on from 2026-10-25; `BOT_ORDERS=on` deployed; owner's test order O-0072 + consent |
| 2026-10-23 | Attendance lunch break, short days, three salary types (v0.29.1–v0.29.3); WhatsApp Step 2 (v0.29.0) |
| 2026-10-20 | Attendance "Mark days" (v0.28.0) |
| 2026-10-19 | Day marks (v0.26.0); view-only roles (v0.27.0); error log (v0.25.5); tests on GitHub |
