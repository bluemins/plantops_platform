# Plant Answers (Morning report + Ask your plant): complete phase plan

Asked by the owner 2026-11-23. **Status: Phase 1 built (2026-11-24, v0.88.0).** We go **one phase at a time**. No code,
database, permission or setting changes until the owner says "start" for that phase.

**Direction (owner, 2026-11-23): get the maximum without using AI.** Every phase below runs on PlantOps' own rules. No
plant data goes to an AI service, and there is no AI bill. AI is only an optional decision at the very end (Phase 15).

**Built ready for AI (owner, 2026-11-23):** the design must let AI be switched on later without rewriting the cards,
screens or saved reports (section 3, "Ready for AI later"). No AI package, key or call is added until then.

Replaces the "Daily action agent" idea in `docs/TODO.md` (2026-11-01). The model for the morning content is section 6 of
`docs/ORDER_FLOW_LEAN_ANALYSIS.md`: each action comes with the reason behind it.

## 0. Where we stopped (handover, 2026-11-23)

**Read this first in the next session.** Status (2026-11-24): **Phase 0 done** (D10–D12 decided by the owner as
recommended). **Next: Phase 1 plan.** No code, database, permission or setting has changed for this feature yet.

**Done:**
- Complete plan covering all 27 questions, both ways of using it, and the limits.
- Direction set by the owner: maximum **without AI**, built so AI can be added later without a rewrite (D3, D13).
- Mock-ups approved (sample data): https://claude.ai/artifact/MtCX4J5Kp1wHTAtDKucd3W
- D7: copied message has no rupee amounts or phone numbers.
- D8: support reads and is logged, no Copy; private salary and attendance answers are owner only.
- D9: per-plant switch, plant 001 only until the two-week trial ends.

- D10: attendance, salary, claims and applicant cards are never copied (2026-11-24).
- D11: morning report at 8:30 am IST, at most 7 actions (2026-11-24).
- D12: "Ask your plant" is a question finder (2026-11-24).
- The Accounts desk work is committed (v0.86.0, v0.87.0), so it no longer overlaps. Keep this feature in its own commits.

**Phase 1 live 2026-11-24 (v0.88.0)**, switched on for plant 001. The owner checked M2 against Aging Summary: equal
(₹58,550). Left: the owner copies one message into WhatsApp. Then Phase 2 (money cards M1, M3–M5), planned first.

## 1. The goal

The owner can get answers from what PlantOps already records, in two ways:

1. **Morning report:** PlantOps tells the owner every morning what to do today, without being asked.
2. **Ask your plant:** the owner finds any question from a searchable list, picks the customer, product or date, and
   gets the answer at once.

Both use the same tested **answer cards**. An answer card is one question PlantOps knows how to answer exactly, such as
"Bills over 30 days". There are 27 in this plan (section 5).

**For now everything is owner only.**

## 2. Decisions

| # | Decision | Status |
|---|---|---|
| D1 | Morning report first, "Ask your plant" after it | Owner, 2026-11-23 |
| D2 | First morning report covers orders, stock and money due | Owner, 2026-11-23 |
| D3 | **No AI.** Rules choose the actions and fixed sentences word them | Owner, 2026-11-23 |
| D4 | No plant data leaves PlantOps for this feature | Follows from D3 |
| D5 | Owner only for now | Owner, 2026-11-23 |
| D6 | One **Copy as WhatsApp message** button for the owner | Owner, 2026-11-23 |
| D7 | The copied message has **no rupee amounts and no phone numbers**. The screen has both | Owner, 2026-11-23 |
| D8 | PlantOps support can open the cards read-only and logged, like other reports, with no Copy button. **Private salary and attendance cards are owner only** (support's existing read-only view inside Attendance is unchanged) | Owner, 2026-11-23 |
| D9 | Switched on per plant, off by default. Only plant 001 until the two-week trial ends; other plants can then be switched on with no code change | Owner, 2026-11-23 |
| D10 | Attendance, salary, claims and applicant cards can **never** be copied to WhatsApp (no Copy button on them) | Owner, 2026-11-24 |
| D11 | Morning report at 8:30 am IST, at most 7 actions | Owner, 2026-11-24 |
| D12 | "Ask your plant" is a **question finder** (search + pick), not free conversation | Owner, 2026-11-24 |
| D13 | Built so AI can be added later without a rewrite. Rules stay as the fallback even then | Owner, 2026-11-23 |

## 3. How it works

### Morning report

```
Sales + other modules → answer cards (exact numbers)
   → priority rules pick at most 7 actions → fixed sentences
   → saved report → notification → screen → Copy for WhatsApp
```

**Priority rules (first version; the trial in Phase 6 tunes them):**

| Order | Action | Most per day |
|---|---|---|
| 1 | Last night's stock count is missing, or consumables weren't updated | 1 |
| 2 | Pending orders can't be filled because a product is short: what to make | 2 |
| 3 | A material runs out within 3 days at the current rate | 1 |
| 4 | Pending over 2 days with stock ready: give a delivery day | 2 |
| 5 | Overdue bills, largest and oldest first: call | 2 |
| 6 | Regular customer later than their usual reorder gap: call | 1 |

If a level has nothing, the next one fills the place, up to 7 actions. A quiet day says "Nothing urgent today".

**Fixed sentences** are templates filled with exact facts:
`{order} {customer}: waiting {days} days, stock is ready. Give a delivery day.`
The same template can have an Odia version, so wording never changes meaning.

### Ask your plant (no AI)

```
Owner types or taps → list narrows to matching questions (English, Odia, common spellings)
   → owner picks the question → picks customer / product / date if needed
   → PlantOps shows the answer with its date and source
```

### Rules for every phase

1. **Every number comes from tested code** and matches the existing report screens.
2. **Read-only.** Cards never enter, change, send or delete anything.
3. **The access check happens on the server** on every card, even though only the owner can open the page.
4. **Each answer shows its date and source**, with a link to the PlantOps page it came from.
5. **Missing data is stated.** A missing count or a module that doesn't answer is shown, never treated as zero.
6. **Predictions say "at this rate" or "about".** They are never stated as facts.

### Ready for AI later

The feature has three decision steps. Each sits behind one small, replaceable piece of code:

| Step | Now (no AI) | Later (optional AI) | Stays the same |
|---|---|---|---|
| **Choose the question** | Keyword search + picker | AI understands a free sentence, in English or Odia | The 27 cards and their inputs |
| **Rank the actions** | Priority rules | AI suggests the order | The facts and the limit of 7 |
| **Word the answer** | Fixed sentences | AI writes the sentence | The numbers, checked against the facts |

**Five things are built this way from Phase 1, at almost no extra cost:**

1. **One card list.** Each card declares its id, title, inputs (customer, product, date) and result shape in one place.
   The finder uses this list today, and an AI could use the same list as its only allowed actions.
2. **Facts kept apart from wording.** A card returns structured facts with ids, such as `days_waiting: 4`. Sentences are
   made from them afterwards, so wording can change without touching a calculation.
3. **A privacy label on every field:** `shareable`, `money`, `personal` (phone, notes) or `private` (salary, attendance,
   applicants). The Copy button uses these labels today. Any future AI filter would use the same labels and send nothing
   unlabelled.
4. **Saved reports record how they were made:** the facts, the final text, and `prepared_by` (`rules` for now, with the
   rules version). AI reports could later sit beside them with no change to old reports.
5. **Rules always remain.** If AI is off, fails or gives a wrong number, the rules version is used.

**Not built now:** any AI package, API key, AI setting, prompt or data filter. Those belong to Phase 15, so the
no-AI version carries no unused AI code.

## 4. What it will not do

| Type | Examples | What it does |
|---|---|---|
| Not recorded in PlantOps | Competitors' prices, market demand, weather, why a customer left | Has no card for it |
| Exact accounting or tax | GST filing, tax advice | Shows PlantOps figures; Zoho and the accountant remain the authority |
| Future as fact | "How many boxes will sell next month?" | Only "at this rate…", with the period used |
| **Without AI** | Questions in free sentences that match no card, a new comparison nobody planned, explaining a situation in its own words | Shows the closest questions. If the owner keeps needing one, we add a new card |

## 5. All 27 questions (all answerable without AI)

**Ready** = data and calculation exist. **Partly** = data exists, a new calculation or module link is needed.
**Gap** = a useful part can be answered, but the full answer needs new data (section 6).

### Money

| ID | Question | Ready? | Limit or note | Phase |
|---|---|---|---|---|
| M1 | Who owes the most, and who is paying slower than usual? | Ready | | 2 |
| M2 | Which bills are over 30 days? Call these first | Ready | | 2 |
| M3 | How much came in this week, cash and online? | Ready | | 2 |
| M4 | Why is cash in hand ₹600 short today? | Partly | Lists what changed since the last close. It shows where to look, not the proven cause | 2 |
| M5 | Is this month's sales up or down, and from which customers or brands? | Ready | Van cash sales show as a separate line, because they have no product or brand | 2 |

### Orders and customers

| ID | Question | Ready? | Limit or note | Phase |
|---|---|---|---|---|
| O1 | Which pending orders are waiting too long, and is stock there? | Partly | Stock as of the last count | 3 |
| O2 | Who usually orders every 6 days but hasn't for 12? | Ready | Needs enough past orders | 3 |
| O3 | Who stopped buying 500 ml, and when? | Partly | Needs a plant-wide version of the per-customer rule | 3 |
| O4 | Which villages had the most orders? | Partly | Different spellings of a place count separately until G4 | 3 |
| O5 | What does Sahoo Stores usually order? | Ready | | 3 |

### Stock and production

| ID | Question | Ready? | Limit or note | Phase |
|---|---|---|---|---|
| S1 | What should we make today? | Partly | Pending orders + stock + "Can make" | 4 |
| S2 | When will caps, labels or preforms run out? | Partly | "At this rate". Depends on true counts and complete recipes | 4 |
| S3 | Was today's count done? Did someone forget consumables? | Ready | | 4 |
| S4 | Which items hold too much cash on the shelf? | **Gap** | First version: months of stock, no ₹. Value needs G1 | 4 |

### Purchases

| ID | Question | Ready? | Limit or note | Phase |
|---|---|---|---|---|
| P1 | What do I owe vendors, and what's due this week? | Ready | | 8 |
| P2 | Preform cost per month? Is the price going up? | Partly | Needs consistent item names and units | 8 |

### Attendance and salary (owner only, never copied)

| ID | Question | Ready? | Limit or note | Phase |
|---|---|---|---|---|
| T1 | Who hasn't marked IN? Who is often late? | Ready | Late is measured only for people with "Work starts at" | 9 |
| T2 | Which field-duty claims are waiting? | Ready | | 9 |
| T3 | What will November's salary come to so far? | Partly | Today's Sales link has paid months only. Needs a new owner-only estimate | 9 |

### Complaints, job applications, documents

| ID | Question | Ready? | Limit or note | Phase |
|---|---|---|---|---|
| C1 | Which complaints are open over 3 days, and on which product? | Ready | | 10 |
| C2 | Do complaints rise after a certain batch or product? | **Gap** | By product now. By batch needs G3 | 10 |
| J1 | How many new applicants for the driver post? | Ready | Counts only, no names | 10 |
| L1 | Which licences expire in the next 30 days? | Partly | Needs a new Sales → Document Store link | 10 |

### Business questions

| ID | Question | Ready? | Limit or note | Phase |
|---|---|---|---|---|
| B1 | My best 10 customers: are any slowing down? | Ready | | 11 |
| B2 | Is the Mini van's trip worth it? | Partly | Van sales minus diesel, meals and toll. Excludes product cost, driver pay and vehicle upkeep unless added | 11 |
| B3 | If I stop Mr.Charge 2L, what do I lose? | **Gap** | Billed sales now. Van sales and true profit need G1 and G2 | 11 |
| B4 | Summarise this month in 5 lines for my accountant | Ready | A fixed 5-line template, not a tax or accounting statement | 11 |

## 6. Data gaps (each is the owner's choice)

| ID | Gap | Helps | Change needed |
|---|---|---|---|
| G1 | Link Floor Stock items to purchase items, to get stock value and cost | S4, B3 | Schema change, ask first |
| G2 | Van report by product | M5, B3 | Extra entry for staff; the owner simplified this form on 2026-11-11, so recommended **not** unless B3 proves important |
| G3 | Batch on complaints filled in reliably | C2 | Staff habit or a required field |
| G4 | One fixed place list | O4, route planning | Schema change, ask first |

## 7. Phases (one by one)

Finish and test each phase, write its status note, then the owner says "start" for the next.

| Phase | What | Covers |
|---|---|---|
| 0 | Decisions and mock-ups | D7–D12 |
| 1 | Foundation: card format and owner page | |
| 2 | Money cards | M1–M5 |
| 3 | Order and customer cards | O1–O5 |
| 4 | Stock and production cards | S1–S4 |
| 5 | Morning report at 8:30 + Copy button | Way 1 |
| 6 | Two-week trial | Way 1 |
| 7 | Tune the priority rules from the trial | Way 1 |
| 8 | Purchase cards | P1–P2 |
| 9 | Attendance and salary cards | T1–T3 |
| 10 | Complaints, applicants, documents | C1–C2, J1, L1 |
| 11 | Business question cards | B1–B4 |
| 12 | Ask your plant: question finder in English | Way 2 |
| 13 | Odia labels, Odia sentences, phone voice typing | Way 2 |
| 14 | Review: staff access, data gaps, other plants | Owner decides |
| 15 | **Optional:** is AI still needed for anything? | Owner decides |

### Phase 0: Decide and design (no code)
- Owner confirms D7–D12, one at a time.
- Mock-ups **approved by the owner 2026-11-23** (sample data): https://claude.ai/artifact/MtCX4J5Kp1wHTAtDKucd3W
  (morning report, copied message, question finder, answer card, private answer).

### Phase 1: Foundation (detailed plan, 2026-11-24; waiting for the owner's "start")

**What the owner gets:** a new **Plant answers** section in Sales → Reports, switched on for plant 001 only. It opens
a list of the 27 questions grouped by area (Money, Orders, Stock, Purchases, Staff, Other, Business). Questions not built
yet are greyed out with "comes in Phase N". One question works end to end, **M2 "Which bills are over 30 days? Call
these first"**, so the whole path is tested before Phase 2 adds the rest: card list → facts → sentence → screen → Copy.
The screens follow mock-up 4 ("answer card") of the approved mock-ups.

**No database, grant, credential, platform or SSO token change.** Only Sales (`apps/order-capture`) changes.

**Three choices for the owner (recommendation first):**

| # | Choice | Recommended | Why |
|---|---|---|---|
| P1-a | Does Phase 1 include one working card? | **Yes, M2** | An empty page can't prove the Copy rules, the support rules or the numbers. M2 reuses Receivables, which was checked against Zoho, so its numbers can be compared to the paisa |
| P1-b | Where the per-plant switch (D9) lives | **A Sales setting** `PLANT_ANSWERS_PLANTS` (plant ids, comma-separated) on Railway | Needs no migration. Switching on another plant later is one Railway edit with no code change (the same approach as `DROP_APPS`) |
| P1-c | Build the "rank" step now? | **No. Only its shape (type) now, the rules in Phase 5** | Nothing ranks until the morning report exists. Building it now would mean code nobody uses or tests against real data |

**Pieces (all in `apps/order-capture`):**

1. **Card list** `src/lib/answers/cards.ts` (pure, no database): one entry per question, all 27 written now:
   `id` (M2…), `area`, `title`, `phase`, `inputs` (none / customer / product / vehicle / date / period), `fields`
   (each fact: `key`, `label`, `kind` count / money / days / date / text / phone, and **privacy** `shareable` / `money` /
   `personal` / `private`), `source` (the report page it comes from). A card is **private** if any field is private
   (T1–T3, J1: owner only, never copied; D8, D10). Phase 12's finder and a future AI both read this same list.
2. **Facts** `src/server/answers/m2.ts`: M2's facts from `receivablesData()` + the Aging Details rules in
   `src/lib/receivables.ts` (nothing recalculated). Bills over 30 days past their due date, as of today: per customer the
   bill numbers, oldest days late, amount, phone; plus the totals. Largest and oldest first.
3. **Run** `src/server/answers/run.ts` `runCard(user, id, input)`: the one entry point. Checks in this order on the
   server: plant switched on (else 404), access (below), card built (else 404), input valid (else 400). Returns
   `{ card, asOf, facts, missing, source, preparedBy: { by: "rules", version } }`. Missing data is listed and never shown
   as zero (rule 5).
4. **Word** `src/lib/answers/word.ts`: fixed English sentences filled only from the facts, e.g. "12 bills from 7
   customers are over 30 days late. Call Sahoo Stores first: B-0231, 64 days." `WORDING_VERSION = 1`. Odia comes in Phase
   13.
5. **Copy** `src/lib/answers/copy.ts`: builds the WhatsApp text from `shareable` fields only. `money` and `personal`
   fields are left out (D7). Private cards and support get no Copy (D8, D10). A last check refuses any text containing
   "₹", "Rs", "+91" or a 10-digit mobile, so a wrong label can never leak a number. M2's copied message: customer names,
   bill numbers and days late, without amounts or phones.
6. **Rank** (shape only, P1-c): the type `rank(facts[]) → actions[]` in `src/lib/answers/rank.ts`, no rules yet.
7. **Access** (`src/server/access.ts`, the one table): `answers: ["owner", "support"]`, `answers_private: ["owner"]`,
   `answers_copy: ["owner"]`. Accounts, Order desk, viewers, Delivery staff, Marketing staff and Store keepers are
   refused. Support page views are logged by `requirePageUser` as on every report, so they show on the owner's Support
   access page.
8. **Screens** (server pages, no new API route):
   - `/reports/answers`: the area list; built cards are links, the rest greyed with their phase.
   - `/reports/answers/[id]`: sentence on top, then the facts (a table on PC, cards on a phone), "As of 24 Nov, 08:12 ·
     from Receivables → Aging Details" with the link, missing-data notes, **Copy as WhatsApp message** (owner only; the
     existing copy button with its "select it" fallback for plain http). Call / WhatsApp links per customer as on Accounts
     desk.
   - Reports page: a "Plant answers" section, shown only when the plant is switched on.
9. **Setting** in `src/server/env.ts` + `.env.example`: `PLANT_ANSWERS_PLANTS`. Empty = off everywhere.

**Tests** (`test/answers-lib.test.ts` pure, `test/answers.test.ts` with the database):
- every field of all 27 cards has a privacy label; every card with a private field is marked private; ids unique
- the copied text of M2 has no ₹, amount, "+91" or 10-digit number, and the last check refuses a deliberately mislabelled
  field
- the sentence uses only numbers present in the facts
- roles: owner reads and copies; support reads, gets no Copy, is logged, and gets 404 on a private card; Accounts, Order
  desk, viewer, Delivery staff, Marketing staff, Store keeper and a Store-keeper-only user are refused
- switch: plant not listed → 404 for everyone, including support
- tenant isolation: plant B's owner never sees plant A's bills, even with plant A switched on
- **numbers:** M2's totals equal Receivables → Aging Details (30+ bands, by due date, as of today) to the paisa, on the
  same test data
- missing data: a plant with no bills says "No bills over 30 days", never an error

**Checks before release:** typecheck, all Sales tests, `next build` for Sales. On `pnpm dev` (plant 002, switched on only
for the check, temporary data removed afterwards): the list and M2 at 390 and 1280 px, Copy on a phone width, support
handoff read-only with no Copy, an Accounts login refused.

**Release:** Sales v0.88.0, Sales only, no migration. On Railway: set `PLANT_ANSWERS_PLANTS` to plant 001's id on
`order-capture`. **Done when:** the owner opens M2 on the live copy, finds the numbers match Receivables, and copies one
message into WhatsApp.

**Not in Phase 1:** the other 26 cards (Phases 2–11), the morning report, notifications and job (Phase 5), the search box
(Phase 12), Odia (Phase 13), anything AI (Phase 15).

### Phase 2: Money cards (M1–M5)
Reuse `receivables.ts`, `customer-insights.ts`, the cash book and Business Overview. Check each card against the existing
report screens, to the paisa.

### Phase 3: Order and customer cards (O1–O5)
Reuse `order-flow.ts`, `flow-check.ts`, `customer-insights.ts`. **Needs approval:** new read-only lookup scope for stock
facts, Sales → Floor Stock (`day_report` returns display text and is not suited to this).

### Phase 4: Stock and production cards (S1–S4)
Reuse `recipe.ts` and `not-updated.ts` in Floor Stock. Compare results with the owner's knowledge of the plant for 3 days.

### Phase 5: Morning report
- The priority rules in section 3 pick at most 7 actions from the money, order and stock cards.
- **Needs approval:** Sales migration for `morning_reports` (one per plant per day, FORCE RLS, no DELETE) and
  `morning_report_marks` (Useful / Not useful).
- **Needs approval:** job `POST /api/cron/morning-report`, cron-job.org row 15 at 08:30 IST, safe to run twice.
- Notification kind `order_capture.morning_report`, owners only, phone + bell. Update the HANDBOOK job table.
- **Done when:** it arrives on the owner's phone 3 mornings in a row, with no duplicates.

### Phase 6: Two-week trial (plant 001)

| Measure | Target |
|---|---|
| Report arrived by 8:35 am | 14 of 14 days |
| Wrong numbers | 0 |
| Actions marked Useful | At least 60 % |
| Pending orders over 2 days | Falling |
| Overdue money | Falling |

### Phase 7: Tune the rules
Using the Useful / Not useful taps: drop action types nobody used, change limits and order, and add actions the owner
wished for during the trial.

### Phase 8: Purchase cards (P1–P2)
Reuse Payables and Reports → Purchases. Check preform names and units on plant 001's bills first.

### Phase 9: Attendance and salary cards (T1–T3)
- **Needs approval:** new owner-only lookup for the running month's salary estimate, because `salary_totals` covers paid
  months only.
- Never in the copied message (D10).

### Phase 10: Complaints, applicants, documents (C1–C2, J1, L1)
- **Needs approval:** new read-only lookup, Sales → Document Store.
- Applicants as counts only.

### Phase 11: Business question cards (B1–B4)
Each joins earlier cards. Each states what it leaves out, such as driver pay in B2.

### Phase 12: Ask your plant, question finder
- One search box over all 27 questions, with area chips (Money, Orders, Stock…) and "recently used".
- Each question has keywords and common spellings, so "due", "baki" or "udhaar" all find M1.
- Pickers for customer, product, vehicle and date.
- If nothing matches, it shows the closest questions and records the words typed, so the owner can see which new cards
  are worth adding. **Needs approval** if this is stored (small table, FORCE RLS).

### Phase 13: Odia and voice
- The owner checks Odia question labels, keywords and sentence templates.
- Voice uses the phone keyboard's own voice typing into the search box. Whether it is good enough for Odia must be tested
  on a real phone before it is promised.

### Phase 14: Review
The owner chooses from: staff versions by role (Accounts, Order desk, Store keeper), data gaps G1–G4, other plants.
Each gets its own plan.

### Phase 15: Optional AI decision
Only if the "no match" list from Phase 12 shows a real need. PlantOps would still calculate every number.

Suggested order, each step separately approved and switched on per plant:

1. **AI chooses the question:** only the owner's question and the card list are sent, with **no plant data**. This is
   the safest step and solves the main limit of the finder.
2. **AI words the answer:** only `shareable` fields, and `money` fields if the owner agrees. `personal` and `private`
   fields are never sent. Any number that doesn't match the facts means the rules version is shown.
3. **AI ranks the morning actions:** the same limits, compared side by side with the rules first.

**Would be added then:** one AI connection file, its key on `order-capture` only, a per-plant switch, the data filter,
usage and cost log, and a spending limit. Decisions needed then: which AI service, what data may be sent, its privacy
terms, each plant's agreement, and a monthly budget. The cards, screens and saved reports are not rewritten.

## 8. Cost

| Item | Cost |
|---|---|
| AI | **None** until the owner approves Phase 15 |
| Railway | No new service. Runs inside Sales |
| Notifications, cron-job.org | No added cost |

## 9. Risks

| Risk | What protects us |
|---|---|
| Rules pick the wrong priority | Useful / Not useful taps, then tuning in Phase 7 |
| A question can't be found | Keywords and spellings; the no-match list shows which cards to add |
| Dues spread on WhatsApp | The copied message has no amounts (D7) |
| Staff pay details are shared | Attendance and salary cards can't be copied (D10) |
| Bad counts give bad advice | Missing or old counts are shown; estimates say "about" |
| Too many alerts | At most 7 actions; the trial removes unused ones |
| A card disagrees with a report | Cards reuse the same report rules and are checked against them |

## 10. Approvals needed, in order

These follow the CLAUDE.md rule to ask before schema, permission or credential changes:

1. Lookup scope Sales → Floor Stock for stock facts (Phase 3).
2. Migration for morning reports and marks, the new job and notification kind (Phase 5).
3. Owner-only salary estimate lookup (Phase 9).
4. Lookup Sales → Document Store (Phase 10).
5. Table for no-match searches, if stored (Phase 12).

The SSO token does not change.

## 11. Progress

| Phase | Status |
|---|---|
| 0 | **Done 2026-11-24**: mock-ups approved, D7–D12 decided |
| 1 | **Live 2026-11-24 (v0.88.0)** for plant 001. M2 checked by the owner against Aging Summary (₹58,550, equal). Copy test still to do |
| 2–15 | Not started |
