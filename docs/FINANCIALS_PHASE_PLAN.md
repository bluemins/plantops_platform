# Profit & Loss and Balance Sheet: phase plan

Asked by the owner 2026-11-20: "Balance sheet (cash, receivables, inventory, fixed assets, debt, payables, equity) and
P&L (sales, cost of goods sold, operating expenses, taxes, net income). If any data is missing, plan something for the
owner to enter it, so we get a proper view."

Status: **plan, waiting for the owner's decisions (section 2).** Nothing built. Mock-ups come after the decisions, before
any code (rule: mock-up before UI).

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
