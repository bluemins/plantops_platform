# Reports (B5): plan

Asked by the owner 2026-11-07: "a report tile on the main dashboard; the sales report first; later different sections".
Reference: the owner's Zoho Books Reports Center (sections on the left; Sales: by Customer, by Item, by Salesperson,
Summary) and their Zoho "Sales by Item, grouped by salesperson, Oct 2026".
Mock-ups (real Oct 2026 figures from plant 001's Zoho export): https://claude.ai/artifact/CmaHReL3fE5gALSh9DVZXb
Status: **built 2026-11-07 (v0.43.0)**: the owner said "build it". Changed with the owner before building: monthly /
quarterly / salesperson are **filters** on two reports (Sales by Item, Sales by Customer), not separate reports; the
Reports card is owner only.

## 1. Decisions (owner, 2026-11-07)
1. **Own "Reports" tile on the PlantOps dashboard** (not only a link inside Order Capture). Later report sections (stock,
   attendance…) hang off the same page.
2. **Owner only** (Accounts can be added later with one access row).
3. **Zoho history included:** imported Zoho invoices (Apr 2025 – 5 Nov 2026) and PlantOps bills (from 6 Nov 2026) form
   one sales history.

## 2. What sales means
- Sales = **bills**, not orders; cancelled bills left out; opening-balance bills (`OB-…`) left out.
- "Sales" = before GST (sub-total − discount, minus the GST inside when rates included GST); "Sales with GST" = the
  bill total. Zoho's own report uses the line amounts before GST, so the figures can be checked against Zoho.
- Rows by **PlantOps product** (bill line `sku_id`); Zoho lines whose code matched no product keep Zoho's name. Two Zoho
  names for one code count as one product (plant 001: PV_DM_1 "Deionised" / "Distilled").
- Salesperson: PlantOps bills' salesperson; Zoho bills' "Sales person" name as imported. Not set → "Not mentioned".
- Vehicle: PlantOps bills only (Zoho had none). Place: the customer's place (Zoho contacts not matched: "Not matched").

## 3. Screens (mock-ups 1–5)
1. **Dashboard tile "Reports"** (owner only, when Order Capture is switched on): last month's sales and the change on
   the month before. Opens the Reports page.
2. **Reports page:** sections on the left (Sales now; Receivables, Payments received, GST, Stock, Attendance & salary
   "later"), search, the Sales reports with one line on what each shows.
3. **Sales by Item:** date range (previous month default, this month, this financial year, custom), group by
   (none / salesperson / customer / place / vehicle / brand), compare with (none / previous period / same period last
   year), amount before / with GST; quantity and amount per product, group totals, grand total; CSV and Print / PDF.
4. **Sales by Customer:** bills, sales, sales with GST per customer, biggest first; salesperson filter.
5. **Sales Summary** (by month with change) and **Sales by Salesperson**; a name opens Sales by Item for that person.
6. Also listed: **Sales by Vehicle**, **Sales by Place**.
Phones: the same pages, tables scroll sideways; reports are mostly read on a PC.

## 4. Build (no database change expected)
- **Order Capture:** `/reports` pages + `src/server/reports.ts` (SQL over `bills` / `bill_lines` / `customers` /
  `zoho_contacts`, one query per report, plant-scoped by RLS as always); access row `reports` = owner (+ support
  read-only, logged like other pages); CSV with the shared writer.
- **Platform:** a "Reports" tile for owners when Order Capture is on (launcher tile list; opens
  `/sso/start?module=order_capture&next=/reports`), its number from Order Capture's summary endpoint (a `reports`
  request). No platform migration; SSO token unchanged.
- **Tests:** totals against a hand-worked set (incl. a GST-inclusive bill, a cancelled bill, an `OB-` bill, a Zoho
  bill with an unmatched code), grouping, date edges (IST), owner-only (Accounts / desk / staff refused), plant B sees
  nothing, CSV.
- **Check against Zoho:** plant 001's Oct 2026 Sales by Item by salesperson must equal the owner's Zoho screenshot
  (kedar ₹2,23,765, Bindu Sagar Bhoi ₹1,36,588, dillip ₹83,420, Anmol ₹2,050, not mentioned ₹200).

## 5. Phases
- **R1:** Reports page + Sales Summary, by Customer, by Item, by Salesperson (+ CSV / print), owner only.
- **R2:** dashboard tile with the number; Sales by Vehicle, by Place; compare with.
- **Later sections** (owner to order): Receivables (built v0.56.0, section 6), Payments received, GST (GST bills by
  month, HSN summary), Stock (Floor Stock), Attendance & salary.

## 6. Receivables (built 2026-11-10, v0.56.0)
Asked by the owner 2026-11-10 (from Zoho's Receivables list; "similar filters as Sales by Item"); plan and the three
recommendations approved the same day ("build").
- **Reports:** Customer Balances (opening, billed, received, closing per customer; = Zoho Customer Balance / Receivable
  Summary), Aging Summary (per customer by age; = AR Aging Summary), Aging Details (each unpaid bill with its age; = AR
  Aging Details), Bill Details (bills of a period with status and still due; = Invoice / Receivable Details). Quotes,
  delivery challans and sales orders left out (PlantOps has none).
- **Filters:** period (balances, bill details) or "as of" (today, end of last month / quarter / financial year, custom);
  age by due date (default, Zoho's way; no due date = bill date) or bill date; bands 15 or 30 days × 4; salesperson,
  place, vehicle; group by (per report); show who owe / also advances / everyone; bills all / not fully paid / overdue /
  paid. CSV and Print on each; a customer opens their Statement, a bill its page.
- **Rules:** amounts with GST; opening-balance bills count; cancelled bills and payments left out completely, with every
  allocation touching them (decision 3); "as of" counts bills, allocations and adjustments dated up to that day.
  Salesperson / vehicle belong to a bill: with either, Customer Balances works per bill and advances are left out.
  Aging shows unused advances apart (not taken off), like Zoho.
- **Zoho-closed amounts** (credit notes / write-offs, `bill_adjustments.kind = 'zoho_closed'`): the export doesn't say
  when, so the import dated them the import day (6 Nov); the reports count them from the bill's date, as Zoho shows them
  closed. Looking back before the real credit note this can be early.
- **Data:** Zoho history to 5 Nov 2026 + PlantOps from 6 Nov, one ledger.
- **Checked 2026-11-10** on a local copy of plant 001's live rows (read with the backup login, owner's OK; copy removed
  afterwards) against Zoho's AR Aging Summary by invoice date as of 05/11/2026 (₹1,06,306.26; the 10/11 PDF is the same).
  PlantOps as of 05-11-2026: ₹1,06,196.26. ayush, Bindu Sagar Bhoi, maheshwar and manas sahu equal Zoho to the paisa; the
  ₹110 is three record differences made in PlantOps after the import, not report errors: Deepak dhaba INV-001844
  ₹2,610 (bill and its payment cancelled in PlantOps on 9 Nov, still owed in Zoho); Hotel 10Mail INV-001763 ₹100 and
  Sahu Family Dhaba INV-001669 ₹1,200 (their Zoho payments cancelled in PlantOps on 7 Nov, paid in Zoho); Subrat Kumar
  Mishra opening balance ₹1,200 (Zoho's aging by invoice leaves contact opening balances out). **Owner 2026-11-10: the three PlantOps changes are correct (made on purpose); PlantOps is the record, Zoho is not corrected.** As of 10-11-2026 PlantOps
  shows ₹1,10,966.26 owed (incl. PlantOps bills since 6 Nov) and ₹7,465 unused advances.
- **Code:** `apps/order-capture/src/lib/receivables.ts` (pure rules + one table shape for page and CSV),
  `src/server/reports.ts` (`receivablesData`, `readRecParams`, `receivablesReport`), `/reports?section=receivables`,
  `/reports/receivables/<balances|aging|aging-details|bills>`, `/api/reports/receivables/<kind>` (CSV). Owner only
  (support reads). No migration; platform and SSO token unchanged.
