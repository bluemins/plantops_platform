# Profit & Loss and Balance Sheet: phase plan

Asked by the owner 2026-11-20: "Balance sheet (cash, receivables, inventory, fixed assets, debt, payables, equity) and
P&L (sales, cost of goods sold, operating expenses, taxes, net income). If any data is missing, plan something for the
owner to enter it, so we get a proper view."

Status: **D1–D8 decided by the owner 2026-11-28 (section 2; D3 changed to owner only; books start 1 Apr 2026).**
Nothing built. Break-even decisions BE-D1…BE-D6 still open (section 8.3). Mock-ups come before any code (rule: mock-up
before UI).

**Break-even planner (section 8, owner 2026-11-28): starts once Morning report Phases 4 and 5 are done**
(`docs/MORNING_REPORT_PHASE_PLAN.md`), built during the morning report's two-week trial (Phase 6, no code). It needs F1
and the price part of F2 first (section 8.4), so those move up with it.

## 0. Where we stopped (handover, 2026-11-28)

**Read this first in the session that starts this work.** Nothing is built; everything below is planned and decided
except BE-D1…BE-D6.

**When to start (owner, 2026-11-28):** after the owner completes **Morning report Phases 4 (stock cards) and 5 (morning
report at 8:30)**. Phases 6 onwards of the Morning report (the two-week trial, then tuning) run alongside; the owner starts
a new session for it.

**Decided:**
- D1 books start **1 Apr 2026**. The CA's computation sheets (`refeDocs/ca/`, git-ignored, never commit them) are
  presumptive 44AD with no books, so openings come from the owner's asset list, statements and estimates (section 2).
- D2 inside Sales (Reports → Business Overview + Books tab). **D3 owner only** enters and sees (not Accounts; support
  reads, logged). D4 monthly bank balance. D5 prices from purchase bills + "Can make" recipe. D6 income-tax WDV rates
  (an estimate, the CA doesn't depreciate under 44AD). D7 capital worked out. D8 Month close checklist.
- Break-even: BE-D7 = save one plan per month (the owner's **notes box** + slider values), section 8.2 item 6b.
- Mock-up (sample numbers, notes box included): https://claude.ai/artifact/PWfxdTfXEBRgoNHLhsxRvn (not yet OK'd by the
  owner).

**Open:** BE-D1…BE-D6 (section 8.3, each with a recommendation); the owner's OK on the mock-up.

**First steps of that session:**
1. Ask BE-D1…BE-D6 and the mock-up OK (one question at a time, recommendation first).
2. Plan **F1** in detail (purchase item kind, expense group → P&L group, Other expenses incl. electricity, rent, EMI as a
   repeat monthly expense), mock-up first, show migration `0028`-style SQL before any code (check the next free Sales
   migration number; others may have been used since).
3. Then F2's price part, the Attendance salary split, then BE1 (order in 8.4).

**Morning report Phase 4 overlap:** Phase 4 adds Floor Stock facts through a lookup (Phase 3 already added
`stock-levels` in Floor Stock). Reuse that lookup for "boxes made per month" (electricity per box, BE-D2) instead of
building a second one.

These are **management reports for the owner**, not audited accounts. The CA's books stay the official ones; section 7
lets the owner compare the two.

---

## 1. What PlantOps has and what is missing

| Line | Have it? | Source today / what to add |
|---|---|---|
| Sales | ✅ | Bills (Zoho history + PlantOps), van cash sales, 20 L month bills (Business Overview's "Sales") |
| Discounts, write-offs | ✅ | Bill discounts; write-off adjustments (v0.83.0) → "Bad debts" expense |
| Purchases | ✅ partly | Purchase bills, but **materials, equipment and services are mixed** → mark each purchase item (F1) |
| Salary | ✅ | Paid months from Attendance (v0.77.0) |
| Cash expenses, van costs, staff spending | ✅ | Cash book (C1–C4) |
| **Expenses paid from the bank** (electricity, rent, phone, insurance, bank charges) | ❌ | New **Other expenses** list (F1) |
| **Stock value** (opening / closing) | ❌ | Quantities in Floor Stock, no prices → **stock prices** (F2) |
| **Bank balances** | ❌ | New **Bank accounts** with a monthly closing balance (F3) |
| **Fixed assets + depreciation** | ❌ | New **Asset register** (F4) |
| **Loans + interest** | ❌ | New **Loans** with EMIs (F5) |
| **GST owed to / by government** | ✅ partly | GST on bills and purchase bills; add **GST paid (challan)** entries (F5) |
| **Income tax** | ❌ | "Income tax paid" entry (F5); P&L shows profit before and after it |
| **Owner's capital, drawings** | ❌ | Opening balances (F6); cash book owner in / out + bank drawings |
| Customers owe / advances | ✅ | Receivables, customer advances |
| Vendors owed / advances | ✅ | Payables, vendor advances |
| Staff advances not yet recovered | ✅ | Attendance (needs a lookup scope, F6) |
| Cash in hand | ✅ | Cash book's last close |

---

## 2. Decisions for the owner (my recommendation first)

| # | Question | Recommended | Why |
|---|---|---|---|
| D1 | Start date of the books | **1 Apr 2026**, with every opening figure copied from the **CA's 31 Mar 2026 balance sheet** | One page from the CA gives all opening numbers (assets, loans, capital, stock, bank). Sales and purchases are in PlantOps from Feb 2026, so FY 2026-27 is complete. |
| D2 | Where it lives | **Sales → Reports → Business Overview** (P&L, Balance Sheet) and a new **Books** tab in Sales for the entry screens | Sales already holds bills, purchases and cash. No new service (Railway cost rule). |
| D3 | Who enters | **Owner: everything. Accounts: monthly entries only** (bank balances, other expenses, EMIs, GST paid). **Only the owner sees** the P&L, Balance Sheet, assets and loans | Accounts already records purchases. Profit and capital stay private. |
| D4 | Bank: full ledger or monthly balance? | **Monthly closing balance typed from the statement** (+ optional statement photo / PDF) | A few minutes a month. A full bank ledger (importing every SBI line) is phase F8 later, built on Bank remarks. |
| D5 | Stock prices | **Materials: last purchase rate automatically** (purchase item ↔ Floor Stock item link); unlinked items: owner types a price. **Finished goods: material cost from the "Can make" recipe** (+ optional labour / power per box) | Almost no typing; the prices follow the purchase bills. |
| D6 | Depreciation | **Income-tax WDV rates** by asset group (plant & machinery 15 %, vehicles 15 %, building 10 %, furniture 10 %, computers 40 %), owner can change per asset | Same as the CA uses, so the figures come close to the CA's. |
| D7 | Opening capital | **Worked out** = opening assets − opening liabilities (the CA's figure should match) | A proprietor rarely knows "capital" separately. |
| D8 | Month close | A **Month close checklist** page that lists what is missing for a month (bank balance, EMIs, electricity, last-day stock count, salary paid) | The owner can see whether the P&L for a month is complete before trusting it. |

**Owner's answers (2026-11-28):**

| # | Decided |
|---|---|
| D1 | **Decided 2026-11-28: books start 1 Apr 2026.** The CA's computation sheets (in `refeDocs/ca/`, git-ignored) are presumptive 44AD with no books, so openings come from the owner's asset list, statements and estimates (table below). |
| D2 | As recommended: **inside Sales** (Reports → Business Overview + a Books tab). |
| D3 | **Owner only, changed from the recommendation**: only the owner enters the figures and only the owner sees the P&L, Balance Sheet, assets and loans. Accounts gets nothing new. PlantOps support reads (logged), as on every report. |
| D4 | As recommended: **monthly closing balance** typed from the statement (+ optional file). |
| D5 | As recommended: **prices from purchase bills** (last rate, purchase item ↔ Floor Stock item link); finished goods from the "Can make" recipe. |
| D6 | As recommended: **income-tax WDV rates**, the CA's method. |
| D7 | As recommended: **capital worked out** (assets − liabilities), shown beside the CA's figure. |
| D8 | As recommended: **Month close checklist**. |

**D1: working from the computation sheet.** A computation sheet shows the year's profit, the income-tax depreciation
schedule (each block's written-down value) and the tax. That covers part of the opening figures:

| Opening figure on 1 Apr 2026 | From the computation sheet? | Otherwise from |
|---|---|---|
| Fixed assets (WDV per block) | ✅ the depreciation schedule's closing WDV for FY 2025-26 | — |
| Last two years' profit (to compare with PlantOps' P&L) | ✅ | — |
| Customers owe / vendors owed on 31 Mar 2026 | ❌ | Already in PlantOps (Zoho invoices, payments, purchases imported) |
| Bank balances on 31 Mar 2026 | ❌ | The bank statement's 31 Mar balance (owner types it, F3) |
| Loans outstanding on 31 Mar 2026 | ❌ | Loan statement / EMI schedule (F5) |
| Stock on 31 Mar 2026 | Maybe (if the sheet states closing stock) | Else the owner's estimate, marked as an estimate (no Floor Stock count then) |
| Cash in hand on 31 Mar 2026 | Maybe | Else the owner's figure |
| Capital | Worked out (D7) | — |

**Read 2026-11-28** (the owner shared the AY 2025-26 and AY 2026-27 statements of income; copies go in `refeDocs/ca/`,
git-ignored; no personal details or amounts are copied into this repo):
- **FY 2025-26 (AY 2026-27):** the plant's income is filed as **presumptive income u/s 44AD** (a fixed share of
  turnover). Presumptive filing needs **no books of account**, so the sheet has **no balance sheet, no depreciation
  schedule, no stock, no loans, no debtors / creditors**. It gives only the year's turnover and deemed income.
- **FY 2024-25 (AY 2025-26):** before the plant; nothing usable for the plant's opening figures.

**So the computation sheets give no opening balances.** Revised recommendation for D1 (waiting for the owner's OK):

| Opening figure on 1 Apr 2026 | From |
|---|---|
| Fixed assets | **Asset list typed by the owner** (F4): each machine / vehicle / building with purchase date and cost (from its bill); PlantOps works out the value on 1 Apr 2026 at the D6 rates |
| Customers owe / vendors owed | Already in PlantOps (Zoho imports) |
| Bank on 31 Mar 2026 | The bank statement's balance (F3) |
| Loans on 31 Mar 2026 | Loan statements (F5) |
| Stock on 31 Mar 2026 | **The owner's estimate**, marked as an estimate (no Floor Stock count then) |
| Cash in hand on 31 Mar 2026 | The owner's figure |
| Capital | Worked out (D7) |

Effects on other parts of this plan:
- **D6:** the CA does not work out depreciation under 44AD, so "close to the CA's figures" no longer applies; income-tax
  WDV rates stay as a sensible management estimate.
- **Section 7 (compare with the CA):** the CA's profit is a deemed share of turnover, not a real profit, so only the
  **turnover** can be compared (PlantOps sales for the year against the return's turnover).
- These reports stay management reports; whether presumptive filing still suits the business as turnover grows is a
  question for the CA, not for PlantOps.

---

## 3. Phases

Each phase: mock-up → owner OK → build → tests → release. Every new table: `tenant_id` + FORCE RLS, `order_app`
SELECT + INSERT only (corrections = new rows / cancel with a reason, like the cash book), audited.

### F1: P&L (first useful page)
- **Purchase item kind** (owner, on Purchases → Items, and while recording a bill): Raw material / Packing material /
  Consumable / **Equipment (fixed asset)** / Repairs & maintenance / Service / Other expense. Starter guess from the
  item name; owner corrects. Plant 001's October RO membrane, ozone generator, pump → Equipment.
- **Expense type → P&L group** on the cash book's expense types (Power, Fuel, Rent, Repairs, Office, Travel, Food,
  Transport, Other).
- **Other expenses** (Books → Other expenses): date, type, amount, paid from (bank account / UPI / card), note, optional
  bill photo. For anything not paid from petty cash and not a vendor purchase bill. A **repeat monthly** tick (rent,
  internet) pre-fills next month's entry for one-tap confirm.
- **P&L page** (Reports → Business Overview → Profit & Loss): period (month / quarter / FY / custom), by month columns,
  CSV, print.
  - Revenue: sales before GST − discounts
  - Cost of goods sold: opening stock + material purchases − closing stock (until F2: purchases only, with a note)
  - **Gross profit**
  - Operating expenses by group: salary, power, fuel / van, rent, repairs, transport, office, bad debts (write-offs),
    other
  - Depreciation (from F4), interest (from F5)
  - **Profit before tax**, income tax paid (F5), **net profit**
- Migration (Sales `0028`): `purchase_items.kind`, `expense_categories.pl_group`, `other_expenses` (+ cancels).

### F2: stock value
- Floor Stock answers **quantities per item on a date** (latest count version on or before it) and the recipes, through
  a lookup ticket (new scope `stock_quantities`, Sales → Floor Stock; platform `LOOKUPS` change, no Floor Stock schema
  change). Floor Stock never sees prices (Store keepers can't).
- Books → **Stock prices**: each Floor Stock item with its price: "from purchases (₹2.10, PB-0046)" or typed by the
  owner; finished goods = recipe cost per box (+ optional extra cost per box).
- Stock value on any date = quantity × price; P&L uses the counts nearest the period's start and end (says which dates).
- Opening stock on 1 Apr 2026 typed from the CA (no Floor Stock count then).
- Migration: `stock_prices` (history: from date + price).

### F3: bank accounts
- Books → **Bank accounts**: name ("SBI current"), last 4 digits, opening balance on the start date.
- **Monthly balance**: closing balance per account per month end (+ statement file, like purchase bill copies).
- The Balance Sheet uses the balance on the date asked (month end), and says "not typed for Oct" when missing.
- Vendor / customer payments already say "paid from" → later reconciliation (F8).
- Migration: `bank_accounts`, `bank_balances`.

### F4: fixed assets
- Books → **Assets**: name, group, bought on, cost, depreciation rate, opening written-down value for assets bought
  before the start date, linked purchase bill line(s) (Equipment lines from F1 are offered as "add to assets").
- Sold / scrapped on a date with the amount received → profit or loss on sale.
- Depreciation worked out per month (never stored); asset list shows cost, depreciation so far, value now.
- Migration: `fixed_assets`, `asset_disposals`.

### F5: loans, GST paid, income tax
- Books → **Loans**: lender, kind (term / vehicle / overdraft / from family), balance on the start date, interest rate,
  EMI. Each month: EMI paid (interest part typed or worked out from the rate), extra drawn / repaid.
  Balance = opening + drawn − principal repaid; interest → P&L.
- **GST paid** (challan): date, amount, month it is for. Balance Sheet: GST payable = GST on bills − GST on purchases −
  GST paid.
- **Income tax paid** (advance tax, self-assessment): date, amount, year.
- Migration: `loans`, `loan_entries`, `tax_payments`.

### F6: opening balances + Balance Sheet
- Books → **Opening balances** (owner, once): start date and the CA's figures: stock, bank (from F3), assets (from F4),
  loans (from F5), other debtors / creditors / deposits not in PlantOps (e.g. electricity deposit), capital (worked out,
  shown beside the CA's figure).
- Attendance answers **staff advances not yet recovered** on a date (new lookup scope `advances_open`).
- **Balance Sheet** (Reports → Business Overview → Balance Sheet), on any month end:
  - Assets: fixed assets (value now), stock, customers owe, advances to vendors, staff advances, deposits, cash in hand,
    bank
  - Liabilities: vendors owed, customer advances, loans, GST payable
  - Owner's capital: opening + net profit − drawings (cash book owner out + bank drawings) + money brought in
  - **"Does it balance?"** line: a difference is shown in red with the likely causes (missing bank balance, purchase
    paid in cash also typed as a cash-book expense, …), never hidden.
- Migration: `opening_balances`, `owner_drawings` (bank side).

### F7: Month close checklist
- Books → **Month close**: per month, ✓ / missing: stock count on the last day, every bank balance typed, EMIs entered,
  repeat expenses confirmed, salary marked paid, GST paid entered, cash book closed every day. The P&L and Balance Sheet
  show "Month not closed: 2 things missing" with a link.
- Optional bell on the 3rd of each month to the owner: "October books: 3 things to enter".

### F8 (later): bank statement import
- Bank remarks already reads the SBI Excel in the browser. Later: send its lines to Books, match them to payments /
  expenses already in PlantOps, and offer the rest as "Other expense / drawing / loan EMI". Ask before building
  (bank data would then be stored, unlike Bank remarks today).

---

## 4. What the owner types, and how often

| When | What | Time |
|---|---|---|
| **Once** | CA's 31 Mar 2026 balance sheet → Opening balances; asset list; loans; bank accounts; mark purchase item kinds; check stock prices | ~1–2 hours |
| **Monthly** | Bank closing balance per account; EMIs; electricity, rent, phone (repeat ones = one tap); GST challan | ~10–15 min |
| **When it happens** | Asset bought / sold; income tax paid; owner takes money from the bank | a minute each |
| **Daily** | Nothing new (bills, purchases, cash book, stock count as today) | — |

---

## 5. Approvals needed before building
- Sales migrations `0028`–`0033` (new tables + two columns), shown first per phase.
- Platform `LOOKUPS`: Sales → Floor Stock `stock_quantities`, Sales → Attendance `advances_open`.
- No platform schema, no SSO token change. No new service.

## 6. Known limits (said on the pages)
- Before the start date nothing is counted; months with missing entries are marked "not closed".
- Stock value is only as good as the last count (end-of-day count, nearest date shown).
- A purchase paid in cash *and* typed as a cash-book expense counts twice (existing warning, Business Overview).
- Not a tax return: depreciation and income tax follow the CA's figures only if the rates match.

## 7. Compare with the CA
- Each year (and any month): CSV of the P&L and Balance Sheet in the CA's usual order, so the CA can tick them off.

---

## 8. Break-even planner (owner, 2026-11-28)

Asked by the owner 2026-11-28: "Raw material, manpower and the electricity bill are the main cost, then the operational
cost. If I add the unit costing, I want something to tell me how to plan next month's activity so as to break even."

**Priority (owner, 2026-11-28): starts once Morning report Phases 4 and 5 are done** (`docs/MORNING_REPORT_PHASE_PLAN.md`),
during the morning report's two-week trial. Its blockers (section 8.4) are built first, in that order.

Status: **planned, mock-up made (sample numbers, with the owner's notes box), waiting for the owner's OK and decisions
BE-D1…BE-D6 (BE-D7 decided).** Nothing built.
Mock-up: https://claude.ai/artifact/PWfxdTfXEBRgoNHLhsxRvn

### 8.1 What it answers
"How many boxes must I sell next month to cover every cost, how far am I from that, and what can I change?"

Break-even is arithmetic, so **rules work it out exactly; no AI is needed**. AI (Morning report Phase 15, if the owner
switches it on) could later write a short plan in words from the same numbers, never replacing them.

- **Fixed costs a month** (paid whatever is made): monthly / fixed staff salary, electricity fixed charge, rent, loan EMI,
  phone, office, repairs.
- **Cost of one box** (goes up with every box): materials from the "Can make" recipe × the latest purchase rate (incl.
  Floor Stock's damage allowance), electricity per box, delivery per box (van diesel ÷ boxes delivered), per-day staff per
  box.
- **What each box leaves** = price − cost of one box, per product.
- **Break-even boxes** = fixed costs ÷ what an average box leaves at last month's product mix; per working day too.

### 8.2 The page (Sales → Reports → Business Overview → Break-even planner; owner only, support reads, logged)
Top to bottom, as in the mock-up:
1. **Headline:** boxes needed next month (and a day), last month sold, gap, extra a day; last month's result (₹ short or
   over).
2. **Before you trust this:** what is missing (electricity bill not entered, materials without a price, last stock count
   date, which salary month was used), each linking to where it is entered. Same idea as F7's Month close.
3. **Fixed costs a month:** each line with its source tag (Attendance, Other expenses, Loans, Cash book, Purchases).
4. **What each box leaves:** per product price, cost, leaves, last month sold; "How ₹58 is worked out" opens the cost lines
   (materials with the purchase bill they came from, electricity, delivery, per-day staff).
5. **Ways to close the gap** (worked out, in ₹ for the month): sell a better-leaving product instead of a weaker one;
   ₹2 more on a product; call the shops that are late to reorder (from "Buying & paying"); material prices that went up
   (with the purchase bill). A line says how much of the gap they close together.
6. **Try a plan:** sliders for price change, extra boxes a day, material prices %, fixed costs; break-even and next month's
   result recalculated in the browser. Nothing saved (BE-D7).
6b. **Your notes for <month>** (owner, 2026-11-28): a text box (≤ 1,000 characters) for what the numbers can't know:
   festivals, a van in repair, an agreed price, a big order coming. **Save <month> plan** stores the note together with the
   slider values. The note is shown at the top of the page all month and in a month-end line ("You planned 9,040 boxes;
   you sold 8,310"); earlier months' notes and results are listed. The rules don't read the sentences (the page says to
   set the matching slider); if AI is switched on later (Morning report Phase 15), it reads the note with the numbers.
   Owner only; support reads (logged); never copied.
7. **Cash is not profit:** customers owe over 30 days, salary due on the 1st, vendors due this month, cash in hand, bank
   balance (F3). Collecting dues doesn't change break-even but decides whether salary is paid on time.

Plant answers later gets a card from it ("Am I on the way to break even this month?") using the same facts.

### 8.3 Decisions for the owner (my recommendation first)

| # | Question | Recommended | Why |
|---|---|---|---|
| BE-D1 | Which costs are fixed and which go up per box? | **Set once per expense group, with a starting guess:** salary of monthly / fixed staff, rent, EMI, phone, office = fixed; materials, diesel, per-day staff = per box; electricity = both (BE-D2). Owner can change a group. | Most plants split them the same way; the owner only corrects the odd one. |
| BE-D2 | Electricity per box | **Month's bill − the fixed (demand) charge typed once, ÷ boxes made that month** (Floor Stock's production) | Uses the bill and counts that exist; no meter readings to type. |
| BE-D3 | Break-even with the full EMI or only its interest? | **Full EMI ("cash break-even")**, with a small line for profit break-even (interest + depreciation, from F4 / F5 when built) | The owner's question is "can I pay everything next month"; the principal is real money going out. |
| BE-D4 | Which month's mix and prices | **Last full month's product mix and selling prices** (bill values ÷ boxes), **latest purchase rate** for materials | Simple and close to next month; the sliders cover changes. |
| BE-D5 | Working days | **26 a month by default**, owner changes it on the page settings | Used only for "a day" figures. |
| BE-D6 | Per-day staff | **Counted per box** (their pay last month ÷ boxes made); monthly and fixed staff are fixed | Per-day staff come when there's work, so they move with production. |
| BE-D7 | Save plans? | **Yes, decided by the owner's notes box (2026-11-28):** one saved plan per month = the owner's note + the slider values, a new version on each save (old ones kept); month end compares planned with sold | The note is only useful if it is kept with the plan it explains. |

### 8.4 Dependency blockers (build order)

| Order | Blocker | Why the planner needs it | Where |
|---|---|---|---|
| 0 | **Morning report Phases 4 and 5 done** | Owner's order (2026-11-28) | `docs/MORNING_REPORT_PHASE_PLAN.md` |
| 1 | **Financials decisions D1–D8** (section 2): **all decided 2026-11-28** (D1 decided 2026-11-28: 1 Apr 2026) | F1 / F2 can't start without them | This plan |
| 2 | **F1**: purchase item kind, expense type → P&L group, **Other expenses** (electricity, rent, phone, EMI as a repeat monthly expense until F5) | Electricity, rent and EMI are not in PlantOps today; materials must be told apart from equipment | Section 3, F1 |
| 3 | **F2, the price part only**: purchase item ↔ Floor Stock item link, stock prices, recipe cost per box (D5); the `stock_quantities` lookup (production per month) | Cost of one box; boxes made for electricity per box | Section 3, F2 (stock value on the Balance Sheet can follow later) |
| 4 | **Salary by staff type** from Attendance: monthly / fixed vs per-day totals for a paid month | Fixed vs per-box salary (BE-D6). Today's `salary_totals` scope gives one total; needs the split (Attendance answer change, **ask**) | Attendance `GET /api/plantops/salary-totals` |
| 5 | **BE1: the planner page** (8.2) + the fixed / per-box setting (BE-D1, BE-D2) | — | Sales |
| later | F5 loans (EMI split into interest / principal for the profit line), F3 bank balance on the cash card, Plant answers card, AI wording (Morning report Phase 15) | Nice to have; the page says "not typed" until then | — |

Not blockers: selling prices and boxes sold (Sales bills), recipes ("Can make"), van diesel (cash book), dues and late
shops (Receivables, Buying & paying) all exist.

### 8.5 Approvals needed (asked before building)
- Sales migration for the planner settings: expense group → fixed / per box, electricity fixed charge, working days (one
  small table, FORCE RLS, SELECT + INSERT, history by date), and **`breakeven_plans`** (plant, month, owner's note ≤ 1,000
  characters, slider values, saved by / at; a new row per save, FORCE RLS, SELECT + INSERT only). Shown first.
- Attendance's salary-totals answer gains the per staff type split (no Attendance schema change expected).
- No platform schema, no SSO token change, no new service.

### 8.6 Tests
- The arithmetic with the mock-up's sample (fixed ₹2,60,000, four products, 6,900 boxes → 8,002 boxes, −₹35,800).
- Missing data is listed, never treated as ₹0 (no electricity bill, material without a price, no salary month).
- Levers add up to what the page says; sliders match the server's numbers at zero.
- Owner only; Accounts, Order desk and others refused; support read-only and logged; tenant isolation.
