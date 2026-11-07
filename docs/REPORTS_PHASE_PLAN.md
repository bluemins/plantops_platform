# Reports (B5): plan

Asked by the owner 2026-11-07: "a report tile on the main dashboard; the sales report first; later different sections".
Reference: the owner's Zoho Books Reports Center (sections on the left; Sales: by Customer, by Item, by Salesperson,
Summary) and their Zoho "Sales by Item, grouped by salesperson, Oct 2026".
Mock-ups (real Oct 2026 figures from plant 001's Zoho export): https://claude.ai/artifact/CmaHReL3fE5gALSh9DVZXb
Status: **plan + mock-ups, waiting for the owner's approval.**

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
- **Later sections** (owner to order): Receivables (customer balances, aging), Payments received, GST (GST bills by
  month, HSN summary), Stock (Floor Stock), Attendance & salary.
