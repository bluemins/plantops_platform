# Purchases (in Sales): plan

Asked by the owner 2026-11-10: "add all the purchases to PlantOps" (Zoho Books → Purchases: Vendors, Bills, Payments
Made, Expenses, Vendor Credits). Status: **P1 live 2026-11-10 (v0.60.0), Zoho data imported; P2 built 2026-11-10 (v0.61.0): owner + Accounts enter purchases; P3 + P5 built 2026-11-10 (v0.62.0); P4 split (section 1, decisions 10–13).** Answers to section 6 and
the migration approved by the owner 2026-11-10 (section 1, decisions 5–9).

## 1. Decisions (owner, 2026-11-10)
1. **Scope:** Vendors, Bills, Payments Made, Expenses, Vendor Credits. **Purchase Orders not now** (all of plant 001's
   are closed / billed; the PO number is kept as text on each imported bill). POs can come later with the Floor Stock
   min / max (`ORDER_FLOW_LEAN_ANALYSIS.md` section 5).
2. **Import Zoho now, then enter new purchases in PlantOps** (like Sales from 6 Nov 2026).
3. **A Purchases section inside Sales** (`apps/order-capture`): reuses the Zoho import, money rules, Reports and the
   Accounts role; no new Railway service (cost stays flat, `STABILITY_PLAN.md` section 9). Its own tab and access rows.
4. **Who:** Owner + Accounts (amounts); **Store keeper sees what was bought, never amounts** (how: section 6, Q1);
   PlantOps support reads. Order desk, Delivery staff, Marketing staff, Plant staff and viewers never see purchases.
5. **Migration `0016` approved** ("do it"), incl. the UPDATE on a payment's mode / "paid from" (decision 7).
6. **Store keepers are left out until P5** (section 6, Q1 option c).
7. **Payments imported as Zoho has them** (Cash / Petty Cash); the owner changes each to the right mode later.
8. **From 1 Nov 2026 purchases are entered in PlantOps** (P2); Zoho's numbers 1–46 → PB-0001…, new ones from PB-0047;
   payments PM-….
9. **Bill photos (P6) after P3**; build order P1 → P2 → P3, then P4 / P5 after a few weeks of use.
10. **Expenses live in the Cash book only** (owner, 2026-11-10; `docs/CASHBOOK_PHASE_PLAN.md`): built once there,
    Purchases reports include them once the Cash book is live.
11. **Vendor credits later**, when the first one happens (none in 9 months of Zoho): until then cancel the bill and
    record the corrected one. Its migration is asked again then.
12. **Store keepers: a "Purchases received" page in Sales** (section 6 Q1 option a; permission change approved).
13. **The Floor Stock link waits** for the module-to-module design (with the batch lookup).

## 2. The Zoho files (plant 001, exported 2026-11-10, `refeDocs/zoho-purchases-2026-11/`)
| File | Rows | Facts |
|---|---|---|
| `Vendors.csv` | 16 vendors, all active | 15 GST-registered (GSTIN; states 19, 20, 21, 22, 24, 29, 33), 1 unregistered; 11 with a mobile; no opening balances; terms all "Due on Receipt"; no bank details |
| `Bill.csv` | 98 lines = **46 bills** | 2 Feb – 31 Oct 2026; **₹22,02,844.00** (before GST ₹18,69,453.15; CGST ₹1,24,999.82, SGST ₹1,24,999.82, IGST ₹83,393.63); **all Paid, balance ₹0**; GST on top (never inclusive); no discounts, TDS or TCS; 12 bills with a paise rounding adjustment (−₹1.25 … +₹0.50); each bill linked to one PO (PO-00001 … PO-00046); bill numbers 1 … 46 (Zoho's own sequence, not the vendor's invoice number); account always "Cost of Goods Sold"; ITC always eligible |
| `Vendor_Payment.csv` | **46 payments** | ₹22,02,844.00, one per bill, all applied (nothing unused); mode always "Cash", paid through "Petty Cash"; 41 on the bill's own date |
| `Item_Purchase.csv` | 60 items | 50 "Purchases" (preforms, caps, labels, films, chemicals, membrane, pipes, fittings, freight…) + the 10 sold products; 49 items appear on bills |
| `Expense.csv` | **0** | empty: nothing to import; built new |
| `Vendor_Credits.csv` | **0** | empty: nothing to import; built new |

**Where the money went (2 Feb – 31 Oct 2026):** Balaji Sales Sambalpur ₹13,07,556 (16 bills, preforms + caps + film),
Mina Minerals ₹2,83,553 (11, 5 L bottles), Rayo ₹1,68,151 (LLDP roll), Shlok Polymers ₹1,38,286 (caps), Techno
Chemical ₹1,19,708 (membrane, carbon, media), 10 others ₹1,85,590. Preforms alone ≈ ₹10.7 lakh (all sizes).

**Data to tidy (shown in the import preview, imported as Zoho has them):**
- "Pet Preforms 3 star 28mm-19Gm": 1,275 **pcs** at ₹198,025 (the other preforms are in kg, so probably kg).
- MAXICLEAN in "ft"; 2 lines without a unit (Freight); "LABEL" and "nos" as units.
- Units are Zoho's (kg, pcs); Floor Stock counts preforms in **packets**. Matching them is Phase P5.

## 3. What gets built (phases; finish and test each)
**P1: Zoho import + read-only Purchases tab** (owner imports; owner + Accounts read; support reads)
- Sales → **Purchases** tab (beside Bills / Payments): **Vendors** (list, balance), a **vendor's page** (details,
  GSTIN, bills, payments, statement), **Purchase bills** (list with filters, a bill's page with lines and GST), **Payments
  made** (list).
- Owner-only **Purchases → Import from Zoho** (Vendors + Item_Purchase + Bill + Vendor_Payment CSVs): preview → must
  match Zoho's totals → confirm; re-import adds only what's new (by Zoho id); audited. Purchase-only items become the
  plant's **purchase items** (Sales' own list; the 10 sold products stay PlantOps products).
- Check: plant 001 = 16 vendors, 46 bills, ₹22,02,844.00 billed and paid, ₹0 owed.

**P2: Enter new purchases** (owner + Accounts)
- **Add / edit vendor** (name, mobile, GSTIN with the shape check of `packages/types/src/gst.ts`, address, terms).
- **Record purchase bill:** vendor, bill date, vendor's invoice number, due date (from terms), lines (purchase item,
  quantity, unit, rate, GST %), CGST + SGST for an Odisha vendor (21) / IGST otherwise, rounding, note. Number
  **PB-0047…** (continuing Zoho's 46). Optional "Paid now" records the payment in the same save (Zoho's habit: 41 of 46
  paid the same day).
- **Pay vendor:** amount, date, mode (Cash / UPI / Bank / Cheque), paid from (Petty cash / bank), reference; applied to
  the oldest open bills first or the ticked ones; the rest is an advance. Number **PM-0001…**.
- Owner cancels a purchase bill or payment with a reason (never deleted), like sales bills.
- Notifications (N5+): `order_capture.purchase_bill` (owners; bell; not for the owner's own entry),
  `order_capture.vendor_payment` (owners; bell), `order_capture.vendor_bill_due` (owners + ticked Accounts; phone; daily
  job, on the due date and weekly after; dedupe per bill + step). Outbox as usual.

**P3: Payables + Reports**
- **Payables** (mirror of Receivables v0.56.0): Vendor balances, Aging summary / details, as-of date, CSV + print.
- **Reports → Purchases:** Purchases by Item, by Vendor (period / month / quarter filters, before / with GST, CSV,
  print); GST paid (input tax) per month, so it can be checked against GSTR-2B.

**P4: Expenses + Vendor credits**
- **Expenses** (spending without a vendor bill: diesel, electricity, freight, repairs, tea…): date, category (the
  plant's own list), amount, GST optional, paid from, note, vendor optional. Report: Expenses by category / month.
- **Vendor credit** (a return or a price correction from a vendor): against a bill or as credit; used on the next
  payment.

**P5: Store keeper + Floor Stock link** (approach in section 6, Q1)
- Store keeper sees "Purchases received": date, vendor, item, quantity, unit; **no rates, totals or payments**.
- Link a purchase item to a Floor Stock material (preform 18.5 g ↔ "Preform 18.5", with "1 pkt = 25 kg"), so a purchase
  can be checked against the next count's "received (calculated)", and later **cost per box** for "Can make".

**P6 (optional): photo of the vendor's bill** on a purchase bill (needs file storage + nightly backup in Sales,
which today stores no files: a Railway volume or the S3 bucket).

## 4. Database (Sales migration `0016_purchases.sql`: **needs the owner's approval**)
New tables only, all with `tenant_id` + FORCE RLS; `order_app` SELECT + INSERT, column UPDATE only where noted; **no
DELETE**; no existing table changes. Platform and SSO token unchanged.

| Table | Holds | UPDATE allowed |
|---|---|---|
| `vendors` | name, mobile, email, GSTIN, GST treatment, state, address, terms, active, `zoho_id` | details, active |
| `purchase_items` | name, unit, HSN, default rate, GST %, active, `zoho_id`, optional Floor Stock item id (P5) | details, active |
| `purchase_bills` | number (PB-…), vendor, bill / due date, vendor's invoice no., PO no. (text), sub-total, CGST / SGST / IGST, adjustment, total, note, source (zoho / plantops), `zoho_id`, who / when | cancelled_at / by / reason |
| `purchase_bill_lines` | line no., purchase item, description, quantity, unit, rate, GST %, tax, amount | – |
| `vendor_payments` | number (PM-…), vendor, date, amount, mode, paid from, reference, note, `zoho_id` | cancelled_at / by / reason |
| `vendor_payment_allocations` | payment → bill, amount | – |
| `purchase_imports` | one row per Zoho import (files, counts, who, when) | – |
| P4: `expenses`, `expense_categories`, `vendor_credits`, `vendor_credit_lines`, `vendor_credit_allocations` | (separate migration `0017`, asked again at P4) | cancel columns |

Money in whole paise, as in the sales ledger (`src/lib/ledger.ts`). Purchase rules in a new pure file
`src/lib/purchases.ts` (balances, oldest-first allocation, GST split), tested on their own.

## 5. Who may do what (rows added to `src/server/access.ts`)
| Action | Owner | Accounts | Store keeper | Support | Others |
|---|---|---|---|---|---|
| See Purchases (vendors, bills, payments, amounts) | ✔ | ✔ | – | read | – |
| See purchases received (no amounts) | ✔ | ✔ | ✔ (P5) | read | – |
| Add / edit vendor, record bill, pay vendor, expense | ✔ | ✔ | – | – | – |
| Cancel bill / payment / expense | ✔ | – | – | – | – |
| Import from Zoho, CSV, Payables, Purchase reports | ✔ | – (one row to add later) | – | read | – |

## 6. Open questions (my recommendation first)
1. **How a Store keeper sees purchases.** Store keeper is a Floor Stock role. (a) **Recommended:** Sales gives Store
   keepers a "Purchases received" page only: a new `Who = "store"` row in Sales' access table, and Store keeper added
   to `PLANT_STAFF_VIEW_ONLY`-style view rules for Sales in `packages/types` (a permission change: their launcher shows
   a "Purchases received" tile). (b) Floor Stock shows the list, reading it from Sales server-to-server: cleaner for
   them, but module-to-module calls don't exist yet (the same piece the batch lookup needs) and it's more to build.
   (c) Leave Store keepers out until P5.
2. **Payment mode in Zoho was always "Cash / Petty Cash".** Was that true, or just the default? Recommended: import as
   Zoho has it; new payments pick the real mode and "paid from".
3. **Start date in PlantOps.** Zoho's last bill is 31 Oct. Recommended: anything from **1 Nov 2026** is entered in
   PlantOps (check Zoho has no November purchase bills first); re-imports skip bills dated from then on.
4. **Purchase bill number:** recommended **PB-0047** onwards (Zoho's 1–46 become PB-0001 … PB-0046) plus a separate
   "Vendor's invoice no." field. Alternative: keep only the vendor's number.
5. **Bill photos (P6):** worth it? Recommended yes, after P3 (it adds file storage and backup to Sales).
6. **Who builds first:** recommended P1 → P2 → P3 now; P4 and P5 after you've used it for a few weeks.
