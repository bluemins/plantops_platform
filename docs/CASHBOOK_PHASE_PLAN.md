# Cash book (petty cash) in Sales: plan

Asked by the owner 2026-11-10: replace the WhatsApp group **"RB payments"** (the plant's **petty cash**) with a screen in
PlantOps, the way Floor Stock replaced the evening stock message. It covers van day totals, expenses, cash given to staff
(linked to Attendance advances), credit sales and 20 L jar payments on the customer's account in Sales. The owner will
provide the **20 L customer list as an Excel sheet**; jar payments are credited to those customers.
Status: **see section 0.**

## 0. Status and handover (2026-11-11, read this first)
- **C1 live** (v0.63.0, `c799a2d`, Sales migration `0017` applied 2026-11-11). Nobody uses it yet: **the owner starts
  the cash book only after C2 and C3 are live** ("when all customers' money, all brands, is counted in cash").
- **C2 live 2026-11-11** (v0.64.0, `6ab6284`, migration `0018` applied). **Owner to do:** Cash → 20 L → Import list.
  - **Owner, 2026-11-11: a collection must not update the customer's billing directly.** Cash goes into the cash book at
    once; every customer line waits in **Cash → To post** until the owner or Accounts posts it or turns it down.
  - In the file: 17 rows without a mobile + **10 placeholder "mobiles"** (1730445774…) = **27 rows (₹4,036) left out by
    default**; 151 come in (₹60,288) unless their mobile is already a customer (12 on the live copy).
- **C3 built 2026-11-11 (v0.65.0), not deployed.** Sales migration `0019_van_reports.sql` (approved "Approve 0019").
  **Deploy: migration first, then Sales.** Design as built: section 6c. **"Not paid" lines wait in To post too** (owner
  2026-11-11): posting makes the bill.
- **Owner's to-dos after C3:** start the cash book (count the box), Settings: vehicles Mini + Pickup, check expense
  types, give Anmol and Bindu the Accounts role, run alongside the WhatsApp groups, then stop them.
- **Never commit `refeDocs/payments/`** (the private WhatsApp export and customer files).
- Open finding for the owner: Pickup report of 1 Nov is ₹1,000 off (₹9,780 worked out vs ₹8,780 posted).

## 1. What the group does today (plant 001, read 2026-11-10)
Chat export `refeDocs/payments/WhatsApp Chat with Payments/` (Mar 2023 – 9 Nov 2026, ~7,500 messages; bindu ~5,400,
Anmol, Rocky, Jay Lal, Ayush, Gaja, Kedar). Since 1 Aug 2026: 188 "Total deposit" posts, 69 "Cash in hand", 55 "not
paid", 92 20 L collection lists, 83 "deli" (gave), 30 "nele" (took), 31 diesel, 76 meal / tiffin.

| Kind | Example | Where it should go |
|---|---|---|
| **Van day report** (Mini 79×, Pickup 17× since Aug) | `Mini 12450 · Bluemins 12450 · Online 8500 · Jitu dhaba 800 not paid · Jitu dhaba old 500 paid · Meal 0 · Tiffin 0 · Total deposit 1150` | Van report (section 3.2) |
| **Big customer sale** | `Krupalu Enterprise SBP · Bluemins 30250 · Online 11000 · Cash 19250 · Tiffin 80` | Van report or Receive payment |
| **20 L jar collections** | `20LTR 350 · Santanu Seth 50 · Biku Meher 50 · … · Total deposit 350` | Jar collection (3.3) → payment on the 20 L customer |
| **Field collection** (Dilip) | `Basanta Sohela 1000 paid, 1300 balance` | Collection on the customer's account |
| **Expense** | `Diesel 2000 · Tollgate 200`, `Phenyl 160 deli`, `Tiles lagi 8000 deli` | Expense (3.4) |
| **Cash to / from staff** | `Kedar 6500 deli`, `Anmol 1000 neli`, `Ramu 2000 nele` | Staff cash (3.5) → Attendance advance |
| **Money moved** | `Deposit from bindu 46710 · Received`, `Online transfer 15000 from Rocky dada` | Handover / owner in / out / bank (3.6) |
| **Cash in hand** | `Cash in hand 26825` | Day close count (3.7) |

**The arithmetic is right** in every report checked: *sales − not paid + old dues paid − online − meal − tiffin = cash
deposit*; cash in hand is a running book (7 → 9 Nov: ₹14,435 + ₹22,550 in − ₹10,160 out = ₹26,825 ✔).
**What goes wrong:** posts 2–3 days late (owner asks "Cash in hand?" "????"), wrong dates (21/01 for 21/10, 30/11 for
30/10), messages edited afterwards, credit ("not paid") lives only in the chat, cash advances may never reach Attendance.

**20 L dues sheet** (Excel in the chat, 3 Nov): 163 customers, columns Ref no., Customer Name, Payment Preference
(Daily / Monthly), Mobile, Group (Event, Institutions, Police Station Area, … Non Active), Past due, Invoice (month),
Paid, Due, Security deposit, Balance jar, Delivered. Totals: **₹66,129 due, ₹4,350 security deposit, 176 jars out**.
Some rows have no mobile (Police Party, Kalyan Mandap).

**20 L customer list = Pure Pani "Customer Products Report"** (PDF from the owner, 10 Nov 2026): **172 customers**, each
with group and product(s) at their own rate: **Capsule Jar** (₹40 in Bijepur; ₹45–₹60 outside / some institutions),
**Chiller Jar** (₹50 / ₹60), **Dispenser** (₹60; one at ₹1), **Bluemins 20 L** (₹50, 2 customers). Groups: Default,
1 Institutions, 2 Police Station Area, 3 Hospital Area, 4 Ramji Pada Area, 5 Bijepur Area, 52 Outskirts Area, 6 DM Water
Account, 900 Non Active (~70). Names carry the place ("Biku Meher Bijepur"); the chat writes them short ("Biku meher").
No mobiles in the PDF: they come from the dues Excel (3 Nov), joined by name; rows that don't match go to the owner.

**Vehicles (owner, 2026-11-10): two, Mini and Pickup.** "Krupalu Enterprise SBP" is a customer, not a vehicle.

## 2. Where it lives
**A "Cash" section inside Sales** (`apps/order-capture`), beside Orders / Bills / Calls / Purchases:
- the money is already there: customers, bills, Receive payment (mode cash), and Purchases pays vendors "from Petty cash"
  (`PURCHASES_PHASE_PLAN.md`); Expenses (Purchases P4) are built **once, here**, and Purchases uses them
- Accounts role and Reports already exist; **no new Railway service** (cost stays flat, `STABILITY_PLAN.md` section 9)

## 3. What gets built
**Owner, 2026-11-10: "go with your recommendations"** (section 8 answered as recommended); **screens OK'd** the same
day; Pure Pani customer list saved in `refeDocs/payments/`. Mock-ups with the chat's
real 5–9 Nov numbers: https://claude.ai/artifact/T6mXss5cJcsf8QxfcwREQf (day sheet, van report, 20 L collection, staff
cash, close the day, owner's cash book).

### 3.1 The day sheet (`/cash`, phone first)
**The cash book date is the day the cash reached the box**; each entry also keeps its **work day** (a van report
handed in on 9 Nov for 7 Nov shows "for 7 Nov", and counts for 7 Nov in van and sales reports). So the cash in hand
always matches the box, and late reports are visible to the owner ("6 of 12 entries on 9 Nov were for 6–8 Nov").
One page per India date, today or earlier days not yet closed, with big buttons:
**+ Van report · + 20 L collection · + Expense · + Staff cash · + Money in / out · Close the day.**
The top shows **Expected cash in hand** worked out live: last close + cash in − cash out. Each entry is numbered
**C-0001…**, saved at once, never changed; a wrong entry is cancelled with a reason (owner), like payments.

### 3.2 Van report (vehicle per day)
**Owner, 2026-11-11:** sales are entered **per brand per product** (boxes of each product, grouped under its brand:
Bluemins 1 L / 500 ml / 250 ml, DM Water, ...; rate from Rates, rupees worked out), not one rupee total per brand. The van's
**load is counted when it leaves and when it returns**; today that is tracked in a separate WhatsApp group. **Owner, 2026-11-11: don't build on
that group's export now; keep a placeholder.** C3 gives each product line two **optional** boxes, "Loaded" and
"Returned" (saved when typed, never required); when both are filled the line shows "loaded − returned = N" next to the
boxes entered as sold. The full load / stock check (free boxes, breakage, Floor Stock) is designed later.
- **Vehicle** (plant's own list on Settings; plant 001: **Mini, Pickup**; switched off, never deleted), **who drove / sold** (plant user).
- **Sales by brand** (the brands on Rates: Bluemins, DM Water, …), one amount each.
- **Not paid** lines: customer (search the Sales customer list; "new customer" with name + phone) + amount → **a bill on
  that customer's account** (B-number, one line "Van sale – Mini, 9 Nov", the brand as line item, no GST) so it shows in
  their Account, Statement, Receivables and Buying & paying.
- **Collected from customers** (owner, 2026-11-10: on the retail route the van takes cash from existing Sales
  customers): one search over **every Sales customer and the 20 L customers**; each line = customer + amount + Cash /
  Online → **a payment on that customer's account** (oldest bills first, or a ticked bill, like Receive payment). Covers
  old dues ("Jitu dhaba pending balance 500 paid") and today's delivery paid on the spot. Online lines go on the account
  but not into the cash box. "+ New customer" (name + phone) for someone not in the list.
- **Online received** (UPI to the bank, not cash), **Meal, Tiffin, Diesel, Toll** (expenses of that van).
- The app works out **Cash to hand in** = sales − not paid + old dues − online − meal − tiffin − diesel − toll; the
  person types **Cash handed in**; any difference shows as **"short ₹50" / "extra ₹50"** in red.
- Owner: "Copy as WhatsApp message" (the same layout as today) during the switch-over.

### 3.3 20 L jar collection
**Owner, 2026-11-11: "for now cash tracking is main."** C2 is slimmed to money only: import each 20 L customer (name,
mobile, group) with their **pending amount** as an opening balance (from the owner's 20 L customer pending report), the
collection screen (payments on the account, cash into the cash book), and what they still owe on the customer page.
**Left for later:** jars out, security deposits, jar products and per-customer jar rates, monthly 20 L bills. The text
below is the fuller design; build only the slimmed part now.
- **Import the 20 L customer list** from the owner's Excel (owner only, preview → confirm, like Zoho import): each row
  becomes (or is matched by mobile to) a Sales customer with a **"20 L" tag** + its group; **"Total due" becomes an
  opening balance** (`OB-…` bill, like Zoho contacts' opening balances); security deposit and jars out are stored on the
  customer for reference. Rows without a mobile: section 8, Q3. From the customer products report each customer also
  gets **their 20 L product(s) and rate**, so a payment can show "= 5 jars"; "900 Non Active" is imported switched off.
  Collection search finds by any part of the name ("biku" → Biku Meher Bijepur).
- **Collection screen:** pick the date, then tap names from the 20 L list (search, the people who paid last time on top),
  amount (₹50 pre-filled from their last payment), Cash / Online. Each line = **a payment on that customer's account**
  (mode cash or upi). Cash lines add to cash in hand; the total is shown like today's "Total deposit".
- 20 L customer page shows due, last paid, security deposit, jars out.

### 3.4 Expense
Category (plant's own list, starter: Diesel, Toll, Meal, Tea / tiffin, Cleaning (phenyl, broom), Building (cement,
tiles), Chemicals (HCL), Vehicle repair, Stationery, Other), amount, vehicle (optional), paid to (text), note.
Optional photo of the bill comes later (Sales stores no files today).

### 3.5 Staff cash (linked to Attendance)
Person (plant user), amount, direction **Gave / Took back**, type:
- **Advance against salary** → sent to Attendance as an advance (Staff → person → advances, recovered from salary like
  today). Took back = an advance correction.
- **For plant spending** (e.g. "Maheshwar mess lagi 5000", "Packet Bala ke 4800"): shows as **open with that person**
  until settled by expenses / purchase bills / cash returned; an "Open with staff" list for the owner.
- **Salary paid in cash**: shown in the cash book; Attendance's Mark paid stays as it is (Q5).

### 3.6 Money in / out
Owner added cash, owner took cash, deposited to bank, **handover** (cash moves from one holder to another: "Deposit from
bindu 46710", the receiver confirms with one tap), other in / out with a note.
Automatic lines (nothing typed twice): **Receive payment with mode Cash** (Sales), **Pay vendor from Petty cash**
(Purchases), staff advances given in Attendance by Office staff (Q4).

### 3.7 Close the day
The person counts the cash and types **Cash in hand**. Saved once per day (a correction = new version with a reason, like
Floor Stock counts). Shows **expected vs counted** and the difference. The first close is the **opening balance**,
set by the owner on the start day (Q7).

### 3.8 Owner views
Cash book by day (opening, every line, closing, difference), **Open with staff**, **Not paid today** (credit given),
van sales by vehicle and brand; **Reports → Cash**: Cash book (period, CSV, print), Expenses by category / month, Van
sales by vehicle / day, Shorts and extras. Tile: "Cash in hand ₹26,825 · Closed 6:24 pm" / "Not closed today" /
"N short".

## 4. Notifications (N5+, from day one)
| Kind | Who | Text / link | Dedupe | When | Level |
|---|---|---|---|---|---|
| `order_capture.cash_closed` | owners (+ ticked Accounts) | "Cash in hand ₹26,825 (9 Nov) · short ₹0" → `/cash/<date>` | date + version | on close | bell |
| `order_capture.cash_short` | owners | "Cash short ₹350 on 9 Nov (Mini)" | entry id | van report / close with a difference > ₹100 (setting) | phone, urgent |
| `order_capture.cash_not_closed` | owners + ticked Accounts | "Cash book for 9 Nov not closed" | date | daily job 10:00 next morning | phone |
| `order_capture.cash_big_expense` | owners | "Expense ₹8,000 Building (tiles) by bindu" | entry id | on save, ≥ ₹2,000 (setting) | phone |
| `order_capture.cash_credit` | owners | "₹9,450 not paid: Devanand Seth (Mini, 23 Oct)" | entry id | van report with not paid | bell |
| `order_capture.cash_handover` | the receiver | "bindu handed you ₹46,710: confirm" | entry id | on save | phone |

Never for the owner's own entries (except handover). Staff advances keep Attendance's own `advance_given`; the cash book
sends nothing extra for them. Outbox + `kit.retryOutbox` as usual; a cron-job.org job for 10:00.

## 5. Database (**needs the owner's approval**)
**Sales migration `0017_cash_book.sql`** (after Purchases' `0016`): new tables only, `tenant_id` + FORCE RLS,
`order_app` SELECT + INSERT, column UPDATE only for cancel columns and on / off; **no DELETE**; no existing table changed.

| Table | Holds |
|---|---|
| `cash_vehicles`, `expense_categories` | the plant's lists (name, order, active) |
| `cash_entries` | C-number, India date, kind (van, jar, expense, staff, owner_in, owner_out, bank, handover, other_in, other_out), amount in paise, in / out, vehicle, category, person, customer, note, links to the bill / payment made, who / when, cancel columns |
| `van_report_lines` | brand sales, not paid, old dues, online, meal / tiffin / diesel / toll, cash handed in |
| `cash_closes` | date, version, counted, expected, difference, reason for a correction |
| `jar_customers` | customer, Ref no. from the sheet, group, payment preference, security deposit, jars out, import id |
| `cash_imports` | one row per 20 L sheet import |
| `attendance_outbox` | advances waiting to reach Attendance (retried, deduped by entry id) |

**Attendance migration `0013_cash_book_link.sql`:** `salary_advances.source_ref` (the C-number, unique per plant) so an
advance from the cash book is stored once even if sent twice. Grants unchanged.

**Sales → Attendance link** (no module-to-module calls exist yet): Attendance gets `POST /api/cashbook/v1/advances`,
outside the login proxy, with a key `atc_…` held by Sales (`ATTEND_CASHBOOK_KEYS` on attendance-salary, plant bound to
the key, like the bot and call keys; rate-limited, audited). The advance is recorded as "by <who entered it> (cash book
C-0123)". Platform and **SSO token unchanged**.

## 6. Who may do what (rows in Sales' `src/server/access.ts`)
| Action | Owner | Accounts | Order desk | Delivery / van staff | Support |
|---|---|---|---|---|---|
| Day sheet: van report, 20 L collection, expense, staff cash, money in / out, close | ✔ | ✔ | – | own van report only (Q2) | read |
| See cash book, Open with staff, reports | ✔ | ✔ (no Reports) | – | – | read |
| Cancel an entry, correct a close, settings (vehicles, categories, limits), opening balance, 20 L import | ✔ | – | – | – | – |

Staff advances: never for yourself (like Office staff in Attendance).

## 6a. Step C2 design (2026-11-11, approved; as built: section 6b)
**The owner's file:** `refeDocs/payments/WhatsApp Chat with Payments/customer_remaining_payment_report_11_2026_*.xlsx`
(Pure Pani "Remaining Payment", 11 Nov 2026): **178 customers, ₹64,324 due** (every row has a due), 161 with a mobile,
17 without (₹2,774: events, police, old customers), 13 rows with an old invoice ref ("#000123811/ Nov-2024") instead of a
number; groups as in section 1; Daily 50 / Monthly 2. Columns used: Ref. No., Customer Name, Mobile No., Group, Payment
Preference, **Total Due Till (Nov)**. Read-only check against plant 001's live Sales customers: **12 mobiles are already
Sales customers** (some the same shop: "Raja Tea Stall" = "Raja Tea"; some not: "Home Majhipali" = "Rocky",
"Prabhat Pradhan" = "Block Office Party").

**What C2 builds:**
1. **Sales → Cash → 20 L → Import** (owner): choose the Excel → preview (nothing saved): new customers, customers whose
   mobile is already in Sales (each: *add the due to that customer*, or *type another mobile*), customers without a
   mobile (type one, or leave them out for now: they stay in Pure Pani), totals that must equal the file's ₹ → confirm.
   Each customer gets a **"20 L" mark** (Pure Pani ref, group) and its due as an **opening-balance bill** (no product lines,
   so sales reports leave it out; Receivables and the customer's statement count it), like Zoho's "OB-…" bills.
   Importing the same file again adds nothing; a later file adds only customers not yet imported.
2. **Cash → + 20 L collection** (owner, Accounts): pick the day, find customers by any part of the name (20 L customers
   first), amount, Cash / Online → one payment per line on the customer's account (oldest due first), cash lines into the
   cash book; the total shown like today's "Total deposit".
3. **What they owe**: the customer's page in Sales (existing), plus a "20 L" list under Cash with due per customer.

**Not in C2 (owner: cash first):** jars, deposits, jar rates, monthly 20 L bills. So in PlantOps a 20 L due only goes
**down** with collections; new deliveries billed in Pure Pani are not added until monthly bills are built.

**Database (needs approval):** Sales migration `0018_jar_customers.sql`: `jar_imports` (file, counts, who) and
`jar_customers` (customer, Pure Pani ref, group, preference, opening bill, import), FORCE RLS, no DELETE; **one change
to an existing table:** `bills.source` also allows `'opening'` (today only `'zoho'` / `'plantops'`), so the opening
balances get their own numbers ("OB20-3324") instead of using up B-numbers. Platform and SSO token unchanged.

## 6b. Step C2 as built (2026-11-11, v0.64.0)
- **Migration `0018_jar_customers.sql`** (approved; the owner added "collection" and "post later" the same day):
  `bills.source` also `'opening'` (OB20-<ref>, no B-number, no lines, customer only); `jar_imports`, `jar_customers`
  (the "20 L" mark: Pure Pani ref, group, preference, opening bill); `cash_entries.kind` also `'collection'`;
  `collection_lines` (each customer line as typed, with its cash entry when cash) and `collection_posts` (posted → its
  payment, or turned down → reason; append-only, a cancelled payment lets the line be posted again). FORCE RLS, SELECT +
  INSERT only, no DELETE.
- **One rule for "opening balance"**: `isOpeningBill` / `OPENING_SQL` in `src/lib/ledger.ts` (Zoho's `ob:` and the new
  `'opening'`), used by Buying & paying, the timeline, Bills list / bill page / statement labels, Link bills, sales
  reports and Drop's box totals. Receivables and the Customers tile count them as money owed.
- Rules `src/lib/jar-import.ts`; server `src/server/collections.ts`; pages `/cash/jar` (20 L list: owe, waiting),
  `/cash/jar/import` (owner), `/cash/post` (To post), "+ Collection" on the day sheet (customer search, 20 L first, last
  amount pre-filled, Cash / Online). Receive payment's inside is shared (`receiveInTx`), so posting follows its rules.
- Access rows `jar_import` (owner) and `collection_post` (owner, Accounts); entering a collection = `cash_enter`.
- A collection entry can't be cancelled while a line is on an account (cancel that payment first); cancelling it makes
  its waiting lines void. Online lines never go into the box; a save with only online lines has no C-number.
- Posting sends the usual "Payment received" bell; saving a collection sends nothing (like other cash entries).

## 6c. Step C3 as built (2026-11-11, v0.65.0)
- **Migration `0019_van_reports.sql`** (approved): `cash_entries.kind` also `'van'`; `van_reports` (vehicle, trip day,
  who drove, sales, not paid, collected cash / online, online, meal, tiffin, diesel, toll, cash to hand in, handed in,
  difference; checks keep the sums honest), `van_report_lines` (per product: boxes, rate, amount = boxes × rate,
  optional loaded / returned), `van_credit_lines` ("not paid") and `van_credit_posts` (billed → its bill, or turned down
  → reason). FORCE RLS, SELECT + INSERT only. "Collected from customers" = C2's `collection_lines` (batch = the report,
  linked to the van's cash entry).
- Rules `src/lib/van.ts` (cash to hand in = sales − not paid + collected cash − online − meal − tiffin − diesel − toll;
  checked with Mini 21 Oct = ₹1,150 and Mini 7 Nov = ₹5,200 from the chat; the WhatsApp layout). Server `src/server/van.ts`.
- Screens: **+ Van report** on the day sheet (`/cash/van/new`): vehicle, who drove, trip day, products grouped by brand
  (only products with a brand on Rates; rate = the last van report's, else Rates; a "Loaded / returned" tick shows the
  placeholder boxes and "loaded − returned = N"), not paid, collected (Cash / Online), online / meal / tiffin / diesel /
  toll, cash to hand in live, cash handed in, short / extra. `/cash/van/[id]`: the report, each customer line's status,
  **Copy as WhatsApp message**, owner Cancel. **Cash → Vans** list. **To post** has a "Not paid on van trips: to bill"
  section (Bill, Another customer, Turn down); the tab count includes them.
- Posting a "not paid" line makes a B-number bill dated the trip day: one line "Van sale (Mini, 7 Nov)", no GST, vehicle
  and salesperson set (Receivables can filter by them). Cancelling that bill lets the line be billed again.
- Meal / tiffin / diesel / toll come out of the van's money before hand-in: kept on the report (expense reports in C5),
  not separate cash book lines. Cash handed in must be more than ₹0.
- A van ₹100 or more short / extra → the existing `cash_short` phone alert to owners. No new notification kinds, no
  platform change. The owner cancels a van report through its cash entry, only while none of its lines is on an account.
- Not in C3: van drivers entering their own report, credit bills by product (one line per not-paid amount), van sales in
  Reports (C5).

## 7a. Step C1 as built (2026-11-11, v0.63.0)
- Sales migration `0017_cash_book.sql`: `expense_categories`, `cash_vehicles`, `cash_entries` (C-numbers, cash day +
  work day, cancel columns only), `cash_closes` (versions; the first = opening balance), `cash_tenants()`. FORCE RLS,
  SELECT + INSERT, no DELETE. Van reports, 20 L customers and the Attendance outbox get their own migrations (C2–C4).
- Rules `src/lib/cash.ts`; server `src/server/cash.ts`; alerts `src/server/cash-notify.ts`; pages `/cash` (day sheet),
  `/cash/book` (month), `/cash/settings` (owner); a **Cash** tab for owner / Accounts / support.
- Access rows `cash_view` (owner, Accounts, support), `cash_enter` + `cash_close` (owner, Accounts), `cash_owner` (owner:
  start, lists, cancel, correct the last close). Store keepers, Order desk, plant staff: nothing.
- Kinds `order_capture.cash_closed` (bell), `cash_short` (≥ ₹100 off), `cash_expense` (≥ ₹2,000), `cash_not_closed`
  (Sales' daily job, **07:00** instead of 10:00: no new cron job). Limits fixed in code for now (Settings later).
- Made while building: entries only on days after the last close (≤ 7 days back); closing a day rolls in earlier
  unclosed days; only the last close can be corrected (owner, reason); **staff cash takes a typed name** (or a Sales
  person) until C4 brings Attendance's employee list; no handover between holders yet (one box).

## 7. Phases (finish and test each)
- **C1:** tables, settings (vehicles, categories), day sheet with expense, money in / out, staff cash (no Attendance yet),
  close the day, opening balance, owner's cash book view, WhatsApp copy, notifications. **Usable alongside the group.**
- **C2:** 20 L customer import from the owner's Excel + jar collection screen → payments.
- **C3:** van report with not paid → bills and old dues → payments; automatic lines from Receive payment and Purchases.
- **C4:** Attendance link (advances) + "Open with staff".
- **C5:** Reports → Cash, tile, stop the WhatsApp group.

Tests with each: tenant isolation, access rows, append-only refusals, the arithmetic (the chat's real days as test cases:
20/10, 21/10, 30/10, 7–9 Nov), once-only Attendance advance, notifications.

## 8. Open questions (recommendation first)
1. **One cash box or one per person?** bindu and Anmol both post one "cash in hand". **Recommended: one Petty cash box per
   plant** with handovers recording who holds it. Alternative: a box per person.
2. **Who enters?** **Recommended: give bindu and Anmol the Accounts role** (they handle money; Accounts already sees
   bills and payments). Van drivers entering their own report: later.
3. **20 L customers without a mobile** (Police Party, Kalyan Mandap): Sales customers need a phone. **Recommended: allow
   "no phone yet" for 20 L customers** (as for Zoho contacts). Alternative: put them under one "20 L others" customer.
4. **Monthly 20 L invoices:** the sheet comes from another app that bills deliveries each month. **Recommended for now:
   import its Total due as the opening balance once, then each month import the month's invoice amounts from the
   sheet** (adds bills), until 20 L deliveries are entered in PlantOps. Needs your sheet to confirm the columns.
5. **Salary paid in cash:** **Recommended: record it in the cash book only;** Attendance's Mark paid stays separate.
6. **Van sales without a customer** (cash sales to shops): **Recommended: one total per brand only** (as today), no
   customer; only not paid and old dues name a customer.
7. **Start day:** **Recommended: a Monday after C1 is live;** the owner counts the cash and types it as the opening
   balance. The chat history stays in WhatsApp (I can make a one-time Excel cash book from it, Aug–Nov, if useful).
8. **Short / big-expense limits:** recommended ₹100 short and ₹2,000 expense; changeable on Settings.
9. **20 L products in PlantOps:** Capsule Jar, Chiller Jar, Dispenser, Bluemins 20 L. **Recommended: add the missing ones
   in Business details → Products** (brand "Bluemins 20L" on Rates), so jar rates use the same products as everything else.
