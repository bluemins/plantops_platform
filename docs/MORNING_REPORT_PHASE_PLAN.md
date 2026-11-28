# Plant Answers (Morning report + Ask your plant): complete phase plan

Asked by the owner 2026-11-23. **Status: Phase 1 live (2026-11-24, v0.88.0), plant 001. Next: Phase 2 plan.** We go **one phase at a time**. No code,
database, permission or setting changes until the owner says "start" for that phase.

**Direction (owner, 2026-11-23): get the maximum without using AI.** Every phase below runs on PlantOps' own rules. No
plant data goes to an AI service, and there is no AI bill. AI is only an optional decision at the very end (Phase 15).

**Built ready for AI (owner, 2026-11-23):** the design must let AI be switched on later without rewriting the cards,
screens or saved reports (section 3, "Ready for AI later"). No AI package, key or call is added until then.

Replaces the "Daily action agent" idea in `docs/TODO.md` (2026-11-01). The model for the morning content is section 6 of
`docs/ORDER_FLOW_LEAN_ANALYSIS.md`: each action comes with the reason behind it.

## 0. Where we stopped (handover, 2026-11-28)

**Read this first in the next session.** Status: **Phases 0 and 1 done (v0.88.0, plant 001). Phases 2 + 3
live 2026-11-28 (v0.89.0):** M1, M3, M4, M5, M6 and O1–O5, a note beside every number, the Floor Stock
`stock_levels` lookup (approved by the owner the same day). **G4 (fixed place list)** approved in principle: plan in
section 7 ("G4"), G4-a…d decided as recommended (owner 2026-11-28); mock-up and migration shown before code.
**Phases 4 + 5 built 2026-11-28 (v0.90.0, not deployed):** plan approved in plan mode, mock-up OK
(https://claude.ai/artifact/TLZ4DyBSEDRjPQsczoLMNw), migration `0029_morning_reports.sql` approved by the owner. Choices
P4-a…e / P5-a…d as recommended (Sales NOTES.md "Plant answers Phases 4 + 5"). **Live 2026-11-28** (migration `0029`, cron-job.org row 15 at 08:30, test run OK). **Next:** the owner's 3-day checks,
then the Break-even planner (new session).

**Decided (all phases):**
- Direction: maximum **without AI**, built so AI can be added later without a rewrite (D3, D13). No AI code until Phase 15.
- D5 owner only. D7 copied message has no rupee amounts or phone numbers. D8 support reads (logged), no Copy, no private
  cards. D9 per-plant switch, plant 001 only until the two-week trial ends. D10 attendance / salary / claims / applicant
  cards never copied. D11 morning report 8:30 am IST, at most 7 actions. D12 "Ask your plant" is a question finder.
- Phase 1 choices (owner 2026-11-24, as recommended): P1-a one working card (M2) in Phase 1; P1-b switch =
  `PLANT_ANSWERS_PLANTS` setting on `order-capture`; P1-c the "rank" step is a type only until Phase 5.
- Mock-ups approved (sample data): https://claude.ai/artifact/MtCX4J5Kp1wHTAtDKucd3W

**What is live (v0.88.0, `production` = `0d26868`, 2026-11-24):**
- Sales → Reports → **Plant answers** (`/reports/answers`): the 27 questions by area, unbuilt ones greyed with their phase.
- **M2 "Which bills are over 30 days? Call these first"** (`/reports/answers/M2`): sentence, totals, per customer bills /
  days late / due / Call / WhatsApp, as-of time, link to Receivables → Aging Details, Copy as WhatsApp (owner).
- Railway `order-capture`: `PLANT_ANSWERS_PLANTS=950ea907-0a74-48f6-aaaa-5308424049b4` (plant 001), set by the owner.
- **Checked live by the owner (2026-11-24):** 42 bills, 29 customers, ₹58,550 = Aging Summary 31–45 (₹20,740) + Over 45
  (₹37,810); the six customer rows compared match too.

**Where the code is** (Sales, `apps/order-capture`; details in its NOTES.md, "Plant answers Phase 1"):
- `src/lib/answers/cards.ts` (the one card list + privacy labels), `facts.ts`, `word.ts` (sentences, `WORDING_VERSION`),
  `copy.ts` (shareable facts only + last guard against ₹ / phones; masks a mobile inside a name), `rank.ts` (type only),
  `m2.ts` (M2 facts from `openBillsAsOf` in `src/lib/receivables.ts`).
- `src/server/answers.ts`: `runCard` (switch → access → built card → facts), `listCards`, `copyFor`, `RULES_VERSION`.
- Access rows `answers` (owner, support), `answers_private`, `answers_copy` (owner) in `src/server/access.ts`.
- Pages `src/app/reports/answers/page.tsx`, `[id]/page.tsx`; section on `src/app/reports/page.tsx` (only when switched on).
- Tests `test/answers-lib.test.ts`, `test/answers.test.ts` (24).
- **Adding a card:** add its `fields` + `source` in `cards.ts`, a sentence in `word.ts`, a facts function in
  `FACTS` (`src/server/answers.ts`); the card-list test then requires labels and a sentence for it.

**Phase 1 closed (owner 2026-11-28):** Copy test on M2 passed (names / places / bills / days only, no ₹ or phones);
masking a mobile inside a customer name in the copied text ("Retail Customer xxxxxx3831") kept.

**Phases 2 + 3 (built 2026-11-28, v0.89.0):** code in `src/lib/answers/money-cards.ts`, `order-cards.ts`,
`src/server/answers-data.ts`; Floor Stock `src/server/stock-levels.ts`; details in both NOTES.md. Mock-up (owner OK + "start"
2026-11-28): https://claude.ai/artifact/G2h1tbTPDDNX4jmmUHtPJi. Tests: Sales 1,513, Floor Stock 202, platform 452.

**Next session:**
1. ~~Copy test + masking~~ done 2026-11-28; Phase 1 closed.
2. ~~Deploy v0.89.0~~ live 2026-11-28. The owner checks each card against its report on the live copy (Phase 2 "Done
   when", plus O1 against Pending and Floor Stock's last count).
3. **Phases 4 + 5 together** (owner 2026-11-28): one plan for both, in plan mode; Phase 5 needs the approvals listed
   in section 10 (migration for morning reports and marks, the 8:30 job, the notification kind).
4. G4 (decided as recommended): the Places screen mock-up, then the migration shown, after or beside Phases 4 + 5 as the
   owner prefers.

**After Phases 4 and 5 (owner, 2026-11-28): the Break-even planner starts**, built during the two-week trial (Phase 6),
in a new session. Handover: `docs/FINANCIALS_PHASE_PLAN.md` section 0 (Financials D1–D8 all decided; BE-D1…BE-D6 open;
mock-up https://claude.ai/artifact/PWfxdTfXEBRgoNHLhsxRvn).

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
| M6 | How much cash is in the box now, and how much did we sell today? | Ready | Added by the owner 2026-11-28. Cash is "expected" until the day is closed. Never copied | 2 |

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

### Phase 2: Money cards (M1, M3, M4, M5, M6) (plan 2026-11-28; built the same day, v0.89.0)

**What the owner gets:** five more questions open in Sales → Reports → Plant answers, each built like M2: one sentence on
top, the facts below (table on PC, cards on a phone), "As of … · from <report>" with a link to the screen it comes from,
missing data said in words, and **Copy as WhatsApp message** without rupees or phones. After this phase the whole Money
area works.

**No database, grant, credential, platform or SSO token change.** Only Sales (`apps/order-capture`). Each card reads the
same rules its report screen already uses; nothing is calculated a second way.

**The four cards:**

| Card | Answers | Comes from (same rules) | Checked against |
|---|---|---|---|
| **M1** Who owes the most, and who is paying slower than usual? | Top 10 customers by money due today, each with days of the oldest unpaid bill, usual days to pay, and a "paying slower" tag; plus a second list: customers whose last 3 bills are paid slower than usual (even if not in the top 10) | Due: `customerBalances` / `openBillsAsOf` in `src/lib/receivables.ts`. Slower: the `trend` rule of `customerInsights` in `src/lib/customer-insights.ts` (last 3 bills ≥ 7 days and ≥ 1.5 × slower than the rest of the year) | Receivables → Customer Balances (as of today), and "paying slower lately" on each customer's Overview |
| **M3** How much came in this week, cash and online? | Customer payments this week split Cash / Online (UPI, bank, cheque, other), van cash sales, the total; the same days last week; the five biggest payments; and a separate line "collected but not posted yet" from Cash → To post | Customer payments (`payments`, not cancelled, by payment date), van cash sales as in `moneyFacts` (`src/server/business.ts`); waiting collection lines as on Cash → To post | Business Overview "money in" for the same days (customer payments + van) and Sales → Payments filtered to the week |
| **M4** Why is cash in hand short today? | The latest close with a difference (in the last 7 days): counted, expected, short / extra, the reason typed. Then **where to look**: entries since the close before it, biggest first, with marks for entries cancelled after the close, entries back-dated (cash day earlier than the day typed), staff cash given, van reports short, expenses ≥ ₹2,000 | `closesOf` (`src/server/cash.ts`), `expectedOn` / `bookDays` (`src/lib/cash.ts`), `live_difference` from the day sheet | Cash → day sheet of that day (expected, counted, difference) and the month cash book |
| **M5** Is this month's sales up or down, and from which customers or brands? | This month so far against the same days last month (and last year, when the plant has records then), up / down %; the brands that moved most; the 5 customers who grew most and the 5 who dropped most; van cash sales as their own line (no brand) | `saleFacts` (`src/server/business.ts`, bills + van cash sales, cancelled and opening bills left out), brand rule of `buildCharts` | Reports → Business charts (sales by brand, top customers) for the same dates, and Sales by Customer |
| **M6** How much cash is in the box now, and how much did we sell today? (owner 2026-11-28) | **Cash in the box:** counted at today's close if the day is closed, else expected now (last count + cash in − cash out since), with when and by whom it was last counted. **Sold today so far:** bills + van cash sales with GST, how many bills and van reports, against the same weekday last week. Any hour of the day, not only at 9 pm | Cash: `daySheet` rules (`expectedOn`, `closesOf`). Sales: the Day report's `sales` / `salesWeekAgo` (`src/server/day-report.ts`) | Cash → today's day sheet (Expected / Counted), and Reports → Day report for today |

**Choices (decided by the owner 2026-11-28: all as recommended):**

| # | Choice | Recommended | Why |
|---|---|---|---|
| P2-a | "This week" in M3 | **Monday to today (India time), against the same days last week** | It is how people say "this week"; a 7-day window would change every morning and mix two weeks |
| P2-b | Collections still waiting in Cash → To post | **Shown as their own line, not added to the total** | The cash book rule (2026-11-11): nothing changes billing until posted. Once posted they become payments and are counted then, so nothing is counted twice |
| P2-c | M1's "paying slower" | **The customer page's rule exactly** | The card and the customer's Overview will then always agree; a new rule would give two answers |
| P2-d | M4 when nothing is short | **Says so plainly**: "Cash matched at the last close (27 Nov)", or "Not closed since 25 Nov", with a link to close | No made-up cause; rule 5 (missing data said, never zero) |
| P2-e | M5 amounts | **Before GST**, the Business charts default | Sales by Item / Business charts then match the card; with GST would differ from both |
| P2-f | M5 when the month has just begun (1st–3rd) | **Compare last full month with the month before**, and say so | Two days against two days gives big, meaningless percentages |

**Every number has a note beside it (owner, 2026-11-28):** a short grey line under or beside each figure saying what
it is and what it counts, so no number has to be guessed. Examples:
- M6 "₹18,450 · **Expected cash**: last count ₹16,200 (Thu 27 Nov, 9:10 pm, Anmol) + ₹4,750 in − ₹2,500 out since. Not
  counted yet today."
- M6 "₹42,300 · **Sold today so far**: 9 bills + 1 van report, with GST. Orders not yet billed are not in it."
- M3 "₹82,000 · **Cash received**: customer payments marked Cash, Mon 24 – Fri 28 Nov. Van cash is the next line."
- M1 "38 days · **Usually pays in**: their average days from bill to payment, last 12 months."
The notes live with the field in the card list (`note` on each field), so screens, the later morning report, the finder
and any later AI all explain a number the same way; the tests require a note on every field.

**What can be copied (D7):** M1 names, places, days late, "paying slower" (no amounts). M3 **only counts** ("18 payments
this week, 11 cash, 7 online"), no amounts, no customer names (who paid is not for a group). M6 **no Copy** (cash in hand is not for a group). M4 **no Copy**: it is about
staff handling cash, so it stays on the owner's screen (like D10). M5 up / down as **percent only** plus brand and
customer names, no rupees. The copy guard (₹, Rs, +91, 10 digits) stays as the last check.

**Pieces (all in `apps/order-capture`):**
1. **Card list** `src/lib/answers/cards.ts`: M6 added; `fields` + `source` for M1, M3, M4, M5, M6, each field with its
   privacy label and its **note** (new `note` on `FieldDef`, also filled in for M2); M4 and M6 get a new card flag `noCopy` (screen only, owner and support) so the copy rule stays in the card list.
2. **Facts**, pure, one file each: `src/lib/answers/m1.ts`, `m3.ts`, `m4.ts`, `m5.ts`, `m6.ts`, taking the same data the report
   uses (as `m2.ts` does) plus `today`.
3. **Loaders** in `FACTS` (`src/server/answers.ts`): M1 `receivablesData` + bill lines / settles for the insights; M3 a
   read of `payments`, van reports and waiting collection lines for two weeks; M4 `closesOf` + entries of the last 14
   days; M5 `saleFacts` for the month, last month and last year; M6 the day sheet's cash math for today + the Day report's sales
   query (exported, not copied). Reuse the existing loaders; where a loader is private to
   its file, export it rather than copy it.
4. **Sentences** `src/lib/answers/word.ts` (`WORDING_VERSION` 2), e.g. M3 "₹1,24,500 came in this week (Mon–Fri): ₹82,000
   cash, ₹42,500 online. Last week's same days: ₹1,10,200. ₹3,400 collected is still waiting in To post."
5. **Copy** `src/lib/answers/copy.ts`: honour `noCopy`; M3 / M5 copy counts and percents only (fields labelled
   `shareable`).
6. **Screens**: the existing `/reports/answers/[id]` page draws the new fields; M3 gets a small two-week comparison,
   M4 a "where to look" list with links to each entry's day sheet, M5 up / down lists. Mock-up first (rule: mock-up
   before UI), with plant 001-like sample data.
7. `RULES_VERSION` 2.

**Tests** (`test/answers-lib.test.ts`, `test/answers.test.ts`):
- every field labelled and has a note; M4 and M6 have no Copy for anyone; no copied text has ₹, "+91" or 10 digits
- **numbers match the reports on the same test data**, to the paisa: M1 dues = Customer Balances; M1 "slower" = the
  customer page's trend; M6 cash = the day sheet's expected / counted and sales = the Day report's; M3 total = Business Overview money in for those days; M4 difference = the day sheet's; M5
  totals = Business charts' sales for the same dates and brand split
- M3: a cancelled payment is not counted; a waiting collection is shown apart and not in the total; a posted one is
  counted once; week from Monday
- M4: matched / not closed / not started cash book each give the plain sentence; a back-dated entry and an entry
  cancelled after the close are marked
- M6: closed day = counted; open day = expected with the last count's date; no cash book = "Cash book not started";
  a cancelled bill is not in today's sales
- M5: van sales on their own line; 1st–3rd uses the last full month; no last year when the plant has no records then
- roles, switch and tenant isolation as in Phase 1 for each card (support reads, no Copy; Accounts refused)

**Checks before release:** typecheck, all Sales tests, `next build` for Sales. On `pnpm dev` (plant 002, switched on
only for the check, temporary data removed afterwards): each card at 390 and 1280 px, each against its report screen,
Copy on a phone width, support read-only.

**Release:** Sales v0.89.0, no migration, no new setting. **Done when:** the owner opens all five on the live copy and
each matches its report: M1 against Customer Balances, M3 against Business Overview for the week, M4 against the cash
day sheet, M5 against Business charts, M6 against today's day sheet and Day report.

**Not in Phase 2:** ranking actions (Phase 5), anything from Floor Stock (Phase 3 asks for that lookup first), money owed
to vendors (P1, Phase 8).

### Phase 3: Order and customer cards (O1–O5) (built with Phase 2, 2026-11-28; owner "go ahead for phase 3 also")
- **Approved by the owner 2026-11-28:** the read-only lookup scope **`stock_levels`**, Sales → Floor Stock (`LOOKUPS` in
  `packages/types`). Floor Stock answers `GET /api/plantops/stock-levels` (`src/server/stock-levels.ts`): the newest
  count's closing stock of finished products linked to a PlantOps product, counts only (`StockLevels`). No schema change.
- **O1** pending orders 48 h or older (the Pending tab's amber rule) + the stock all pending orders need against that
  count; Floor Stock off or not answering = "Stock not checked", said in words.
- **O2 / O3 / O5** from each customer's "Buying & paying" (`customerInsights`, the customer page's rules), read for the
  whole plant (`plantBuying` in `src/server/answers-data.ts`). O3 picks a product (most stopped first); O5 searches a
  customer by name, place or the last digits of the mobile.
- **O4** orders by place for a period (this month, last month, this quarter, this FY) against the same number of days
  before; spellings that differ only by case or spaces are one place; Order flow check's look-alike rule (one letter
  apart) lists the rest. **G4 (fixed place list) approved in principle 2026-11-28; its plan below, not built yet.**

### G4: a fixed place list (owner 2026-11-28: approved, G4-a…d as recommended; mock-up and migration next)
**Why:** O4 and route planning count "Khurda", "Khordha" and "Khurdha" as three places.

**Recommended shape (smallest change that fixes it for good):**
1. **Places screen** in Sales (Customers → Places, owner only, support reads): every place typed on customers with its
   customer count, look-alikes side by side. **Merge** "Khordha" into "Khurda": every customer with that spelling gets
   the chosen name (the same change "Select → Place" already makes, one Recent changes line per customer, audited).
   No schema change for this part.
2. **One new table `places`** (Sales migration, FORCE RLS, SELECT + INSERT, UPDATE only on `active`): the plant's own
   list of place names. The customer forms (Add customer, Edit, New order's new customer, Calls' new caller, the bulk
   Place change) then **suggest** from the list as you type, and a name not on the list asks "Add Khurdha as a new
   place?" before saving. Customers keep their place as text (no link column), so the bot, CSV, Drop, field day and
   every report keep working unchanged.

**Choices (decided by the owner 2026-11-28: all as recommended):**

| # | Choice | Recommended | Why |
|---|---|---|---|
| G4-a | Build the Places screen (merge) first, the list second | **Yes, two steps** | The merge cleans today's data at once with no migration; the list stops new spellings |
| G4-b | A new spelling not on the list | **Asked once, then added** | Refusing it would block an order at the door; asking catches most typos |
| G4-c | Who adds places to the list | **Owner, Order desk, Accounts, Marketing staff** (everyone who types a customer's place) | Otherwise staff get stuck on a new village |
| G4-d | Odia / Hindi names | **Later**, with Phase 13 | One spelling per place first |

Mock-up of the Places screen and the place box before any code (rule: mock-up before UI); the migration shown first.

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

**Owner's wish (2026-11-28): a free AI, owner only, that reads the plant's data and suggests next actions.** Not decided
yet (D3 still says no AI); written here so Phase 15 starts from it. Recommendations:

| # | Question | Recommended | Why |
|---|---|---|---|
| AI-1 | Which AI service | **Claude Haiku 5.5** (paid, very cheap), not a free tier | Free tiers (e.g. Gemini's free API) may use the requests to improve their products, and customer dues / sales would go there; free open-model hosts have low limits and change without notice; running a model ourselves needs memory on Railway (cost rule). Haiku 5.5 is about $0.10 per million input tokens, so one morning report (~20,000 tokens) costs well under ₹1, about ₹5–20 a month for one owner. Sonnet 5.5 if the advice isn't good enough (about 20× Haiku, still small). |
| AI-2 | Who uses it | **Owner only**, per plant switch (like `PLANT_ANSWERS_PLANTS`); support never triggers it | Same as the cards' D5 / D8. |
| AI-3 | What is sent | **Only the card facts** (never the database): customer names, places and amounts yes; **phone numbers never; attendance, salary, claims and applicant facts never** (D10) | Amounts are needed for useful advice; the rest isn't. |
| AI-4 | Spending limit | **$2 a month per plant**, then rules only until next month, with a note | A wrong loop can never become a bill. |
| AI-5 | When | **After Phase 5** (morning ranking), so the AI has a full set of cards to read | Before that there is too little for it to work from. |

The rules always stay: every number shown comes from them; if the AI is off, over budget, fails, or quotes a number
that doesn't match the facts, the rules version is shown.

**Also for the Break-even planner** (`docs/FINANCIALS_PHASE_PLAN.md` section 8): the same AI could word "next month's
plan" from the planner's numbers (step 4 here), under the same limits.

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
| 1 | **Done 2026-11-28** (live v0.88.0, plant 001). M2 checked against Aging Summary (₹58,550, equal); Copy test passed and mobile masking in names kept (owner 2026-11-28) |
| 2 | **Live 2026-11-28 (v0.89.0)**: M1, M3, M4, M5, M6. Owner's live check against each report still to do |
| 3 | **Live 2026-11-28 (v0.89.0)**: O1–O5 + Floor Stock `stock_levels` lookup. Owner's live check still to do. G4 decided, not built |
| 4 | **Live 2026-11-28 (v0.90.0)**: S1–S4 + Floor Stock `stock_answers` lookup. Owner checks vs Floor Stock for 3 days after deploy |
| 5 | **Live 2026-11-28 (v0.90.0)**: morning report, migration `0029`, kind `order_capture.morning_report`; cron-job.org row 15 added, test run 200 + notification received. Done when it arrives 3 mornings in a row |
| 6–15 | Not started |
