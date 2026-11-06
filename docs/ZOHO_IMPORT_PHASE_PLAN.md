# Sales ledger in Order Capture + Zoho import: phase plan

Asked by the owner 2026-11-06. Status: **approved by the owner 2026-11-06**: both migrations (section 5), numbers
`B-0001` / `P-0001`, Owner + Order desk make bills and receive payments (only the owner cancels), payments go to the
oldest bills first unless bills are ticked. Section 13 points 5–6 as recommended unless the owner says otherwise.
**L1 (Items) built 2026-11-06, not deployed:** platform migration `0023_sku_hsn_cost.sql`; HSN + purchase rate on the
product form; `src/lib/zoho-items.ts` (rules), `src/server/zoho-items.ts` (preview / confirm, fingerprint, one audit
row `sku.zoho_import`); `POST /api/admin/skus/zoho/{preview,confirm}` (owner only; super_admin not yet);
page `/admin/business/zoho-items`; modules get `hsn`, never `cost_rate`; tests `test/zoho-items.test.ts`.
**v0.37.0 live 2026-11-06**; plant 001 imported (8 updated, 2 added, 6 kept, 50 skipped), then the owner renamed 7
products. **v0.37.1 (owner, same day): edits are remembered.** Table `platform.zoho_item_links` (migration `0024`,
approved) keeps Zoho's last values per product + Zoho Item ID; a field changes only when Zoho changed it since the last
import; a code changed in PlantOps is found through the link. Products imported before links existed keep their
values on the next import (plant had a `sku.zoho_import` before). Dry run for plant 001: 0 changes, 7 names kept,
10 links.
**L2 + L3 built 2026-11-06 (v0.38.0; notes in `apps/order-capture/NOTES.md`).** L2 (ledger database + rules): Order Capture migration
`0008_ledger.sql`: `zoho_imports`, `zoho_contacts`, `bills`, `bill_lines`, `payments`, `payment_allocations`,
`bill_adjustments` (FORCE RLS; SELECT + INSERT; UPDATE only on contact link / phone, bill order link / GST invoice no. /
cancel, payment cancel; no DELETE; one open bill per order; numbers unique per plant). Drizzle in
`src/server/schema.ts`; money rules in `src/lib/ledger.ts` (paise: bill due, status, unused, totals, oldest-first
allocation, advances, Closed, statement). Tests: Order Capture 477 (+22: `ledger.test.ts`, `ledger-db.test.ts`,
append-only and RLS guards cover the 7 tables).
The Zoho **rate** is not stored on the platform: Order Capture's import (L3) reads `Item.csv` too and sets Rates.

## 1. What the owner wants (2026-11-06)
- **"The flow is order entry → invoice → payment made → order close. It's like Zoho Books."**
- **Everything from Zoho comes into Order Capture:** customers, invoices, payments, items.
- **One customer, everything on one page:** orders, invoices, payments, statement (like Zoho's customer
  "Transactions" tab).
- Orders marked Delivered up to 5 Nov are already invoices in Zoho: **link them, never import twice.**

## 2. Decided by the owner (2026-11-06)
1. **Bill in PlantOps, GST invoice in Zoho** (decision 4.9 in `docs/CUSTOMER_APP_PLAN.md` stays). Order Capture makes
   the **bill** (a statement of account, never a tax invoice), takes payments and closes the order. Customers who need
   a GST invoice (GSTIN, or they ask) still get one from Zoho; its number is saved on the bill. Replacing Zoho fully
   can come later, with the CA's OK.
2. Imported Zoho invoices become **bills in the same ledger**, keeping their Zoho number, so each customer has one
   balance.
3. Zoho invoices are **not turned into O-number orders**.
4. Contacts **without a usable mobile are kept** as "no phone yet"; the owner adds a phone any time.
5. **Payments are imported** (Zoho "Payments Received" export).

## 3. The Zoho files (plant 001, exported 2026-11-06)
| File | Rows | Notes |
|---|---|---|
| `Contacts.csv` | 1,104 contacts (1,082 active) | 644 distinct usable mobiles; ~346 without one; 75 mobiles on more than one contact; no place field; 6 GSTINs |
| `Invoice.csv` | 2,939 lines = 1,822 invoices | 8 Apr 2025 – 5 Nov 2026; ₹33.77 lakh billed; ₹1,03,696 due (54 overdue) |
| `Customer_Payment.csv` | 1,866 payments | ₹32.95 lakh received; mode always "Cash" in Zoho (deposit to Petty Cash 1,707 / PureVibe Enterprises 158); 2 drafts; 1 advance; ₹1,500 unused |

Checked:
- **Invoices − payments = Zoho's balance** for 1,789 of 1,822 invoices, to the paisa.
- **33 closed invoices (₹6,893)** were settled without a payment in this export: 25 partly paid, 8 not at all. Most
  likely credit notes or write-offs, which weren't exported. They are imported as **"closed in Zoho" adjustments**,
  so their due stays ₹0 as in Zoho.
- One payment is applied to "Customer opening balance" (the Opening Balance Adjustment invoice).
- 102 invoices have the same SKU code on two lines; 22 have a discount, adjustment or GST; 1 quantity is not whole.
  Bills keep Zoho's lines exactly, so none of this is a problem.
- 525 invoices (₹9.85 lakh) are for contacts without a mobile.

## 4. Items: everything the plant sells (Zoho Items, owner's screenshot)
| Zoho item | SKU | Purchase rate | Rate | HSN / SAC |
|---|---|---|---|---|
| 1 Litre Deionised Water | PV_DM_1 | ₹105 | ₹120 | 285300 |
| 1L Water Bottle | PV_BM_1 | ₹70 | ₹100 | 22011010 |
| 2 Litre Deionised Water | PV_DM_2 | ₹84 | ₹96 | 285300 |
| 250ml Water Bottle | PV_BM_250 | ₹100 | ₹150 | 22011010 |
| 2L PV Empty Bottle | PV_EM_2L | ₹6 | ₹7 | – |
| 5 Litre Deionised Water | PV_DM_5 | ₹140 | ₹160 | 285300 |
| 5 Litre Deionised Water Pro | PV_DM_5_PRO | ₹180 | ₹200 | 285300 |
| 500ml Water Bottle | PV_BM_500 | ₹110 | ₹150 | 22011010 |
| Bluemins Water - 20 Litre | PV_BM_20L | ₹45 | ₹45 | 002201 |
| Blumeins 20L Connection | PV_BM_20L_CON | ₹230 | ₹250 | 002201 |

**Zoho has priority (owner, 2026-11-06):** "Business details → Products gets appended / updated with the Zoho sales
items; Zoho has the priority."
- **New page on the platform:** Business details → Products → **Import Zoho items** (owner; super_admin too). Input:
  Zoho's Items export CSV (Items → ⋯ → Export). Preview first, then Confirm; audited; safe to run again.
- **Matching:** by SKU code. A PlantOps product without a code is matched once in the preview (the owner picks
  "this Zoho item = this product" or "new product"); the code is then saved, so later imports match by code alone.
- **Zoho wins** on what Zoho holds: **name, SKU code, HSN, purchase rate, active / inactive**. A rename keeps the
  product's id, so Floor Stock items, Order Capture rates and old orders stay linked.
- **PlantOps keeps** what Zoho doesn't have: **size (ml), pack type, bottles per box**. For a **new** product these
  are guessed from the Zoho name ("500ml", "1 Litre", "20 Litre" → size; "box" → case) and the owner checks them in
  the preview; nothing is saved without them.
- **Zoho `Item.csv` (exported 2026-11-06): 60 items.** 10 with Item Type "Sales and Purchases" (the 10 above, all
  with a SKU) and 50 "Purchases" only, without a SKU (preforms, labels, caps, chemicals, filter media, membrane, pump,
  pipes, fittings, freight …). **Only items Zoho marks as sold are imported**; purchase-only items are listed as
  skipped (they belong to a later purchases / Floor Stock link, not to Products). Rates come as "INR 120.00".
- **Zoho data to check with the CA (not changed by the import):** HSN `002201` on both 20L items is not a valid HSN
  (water is 2201…); 250ml / 500ml have 18 % within Odisha but 5 % outside; 2L PV Empty Bottle 0 % within, 5 % outside.
  GST rates are not copied into PlantOps (a PlantOps bill is not a tax invoice); old invoices keep the tax Zoho charged.
- **Plant 001 compared (live, read-only, 2026-11-06), owner OK'd Zoho names the same day:**
  - same code, Zoho name wins: PV_BM_1 Bluemins 1L → 1L Water Bottle; PV_BM_500 → 500ml Water Bottle; PV_BM_250 →
    250ml Water Bottle; PV_DM_1 Mr.Charge 1L → 1 Litre Deionised Water; PV_DM_2 Mr.Charge 2L → 2 Litre Deionised Water
  - same product, Zoho code wins (owner confirmed 2026-11-06, for products **and** bills): Mr.Charge 5L PV_DM_5L →
    PV_DM_5; Mr.Charge 5L Pro PV_DM_5L_PRO → PV_DM_5_PRO. The owner can change the two codes now on Business details
    → Products, so the import matches them by code; otherwise they are matched by hand in the first preview. No code in
    PlantOps or the bot repo uses the old codes (checked). **Release check:** `ORDER_BOT_KEYS` on Railway lists products by code;
    update it if it has PV_DM_5L / PV_DM_5L_PRO.
  - only in Zoho → **added as new PlantOps products** (owner, 2026-11-06), sizes proposed in the preview:
    Bluemins Water - 20 Litre PV_BM_20L (20,000 ml, jar, 1); Blumeins 20L Connection PV_BM_20L_CON (20,000 ml, other,
    1; the jar connection / deposit). Zoho's spelling "Blumeins" comes with the name; fix it in Zoho if wanted.
  - **2L PV Empty Bottle = Round Empty Bottle 2L** (owner, 2026-11-06): matched by hand in the first preview; Zoho
    wins, so it becomes "2L PV Empty Bottle", code PV_EM_2L (was PV_EM_2_R). Not a new product.
  - only in PlantOps, **kept as they are** (owner confirmed 2026-11-06): Hemex 1L (HE_DM_1L), Empty Bottle 5L, Round
    Empty Bottle 1L / 2L, Square Empty Bottle 1L / 250ml / 500ml. The import never switches them off.
  - PlantOps mistakes to fix: Round Empty Bottle 2L saved as 1000 ml; Square Empty Bottle 250ml saved as 1 ml
  - brands stay visible on orders through Rates → Brand (v0.32.0), not the name
- **Never deleted:** a PlantOps product missing from Zoho is left as it is (listed in the preview); an item inactive
  in Zoho becomes inactive.
- **Rate** → Order Capture's default rate on Rates (Zoho wins there too), set when the Zoho import runs in Order
  Capture (section 8), matched by SKU code.
- **HSN** (printed on bills, needed when the Zoho GST invoice is made) and **purchase rate** (margin later) don't exist
  in PlantOps yet: two optional columns on platform `tenant_skus` (section 5).
- The 20L items belong to the 20L business (later, `docs/CUSTOMER_APP_PLAN.md`); their bills come in as history.

## 5. Database changes (**ask before building**)
**Platform** migration `0023_sku_hsn_cost.sql`: `tenant_skus.hsn` (optional, 4–8 digits) and `tenant_skus.cost_rate`
(optional). The owner's existing column UPDATE grant on products is extended to these two. The product endpoint for
modules gains `hsn` (not the purchase rate). SSO token unchanged.

**Order Capture** migration `0008_ledger.sql`: new tables only, **no change to existing tables**. Each has
`tenant_id`, FORCE RLS and the `tenant_isolation` policy; `order_app` gets SELECT + INSERT, **no DELETE**, UPDATE only
where listed.

| Table | Holds | UPDATE allowed on |
|---|---|---|
| `zoho_imports` | one row per import: file names, counts, who, when, export date | – |
| `ledger_contacts` | every Zoho contact (Zoho id unique per plant), name, mobile as typed + normalised (may be empty), GSTIN; link to an Order Capture customer (may be empty) | `customer_id`, `mobile`, `mobile_typed` (owner adds a phone) |
| `bills` | number (Zoho `INV-…` for imported; `B-0001…` per plant for new ones), source (zoho / plantops), date, due date, customer **or** contact, linked order (may be empty), sub-total, discount, adjustment, tax, total, notes, salesperson, Zoho GST invoice no. (may be empty), cancelled at / by / reason | `order_id`, `zoho_invoice_no`, the cancel columns (once) |
| `bill_lines` | line no., product (may be empty) + SKU code + name as billed, quantity (decimal), rate, discount, tax %, tax, line total, HSN | – |
| `payments` | number (Zoho's for imported; `P-0001…` for new), source, date, customer **or** contact, mode (cash / UPI / bank / cheque / other), reference, deposit to, amount, note, entered by, cancelled at / by / reason | the cancel columns (once) |
| `payment_allocations` | payment → bill, amount, date (a cancelled payment adds a reversing row) | – |
| `bill_adjustments` | settles part of a bill without money: "closed in Zoho" on import; later write-off / discount after billing, with a reason | – |

**Nothing about money is stored as a running figure.** A bill's due = total − allocations − adjustments; a payment's
unused amount = amount − allocations; a customer's balance = all bills − all payments − adjustments. They are worked
out when a page opens. At import each bill's worked-out due must equal Zoho's balance; any difference is shown and
blocks the import.

**Order closed** is shown, not stored: a delivered order whose bill is fully paid reads **Closed**. Order statuses in
the database stay pending / delivered / cancelled, so the bot, reminders, CSV and tiles keep working unchanged.

## 6. The flow after this phase
1. **Order** entered (staff, bot, as today) → **Delivered**.
2. **Make bill** on the delivered order (owner / Order desk): lines and rates copied from the order, optional
   discount, optional Zoho GST invoice no. One bill per order. A bill can also be made without an order (walk-in sale).
3. **Receive payment** on the customer page or the bill: amount, mode, reference. It is set against the oldest
   unpaid bills first, or against the bills ticked. Money left over stays as **advance** (unused) and is used by the
   next bill automatically.
4. When a bill is fully paid its order shows **Closed**.
5. Mistakes: a bill or payment is **cancelled with a reason**, never edited or deleted; then make it again.

## 7. Customer page (like Zoho's Transactions tab)
- **Top:** balance due, advance (unused), last payment.
- **Orders:** date, O-number, status (Pending / Delivered / **Closed** / Cancelled), amount, bill no.
- **Bills:** date, number, **order no.**, amount, **balance due**, status (Paid / Due / Overdue / Cancelled), GST
  invoice no.
- **Payments:** date, number, reference, **mode**, amount, **unused amount**, status.
- **Statement:** bills, payments and adjustments in date order with a running balance, for any date range; print /
  save as PDF (print-ready page, like Lab Records) and CSV.
- Contacts with **no phone yet** have the same page; "Add phone" links or creates the Order Capture customer.

Also: a **Bills** tab and a **Payments** tab (lists, filters, search, totals) and the owner's CSV of each.

## 8. Importing from Zoho
**Owner only.** *Customers → Import from Zoho*. The owner picks the Contacts, Invoice and Customer_Payment CSVs. The
browser reads them and sends the rows; files are never stored. **Preview first, nothing saved**, then Confirm, in one
transaction, only if the preview is unchanged (fingerprint, 409 otherwise). **Importing again is safe**: same files
add nothing, a newer export adds only what is new (by Zoho id), so Zoho can be imported until the day it stops being
used for sales.

Rules:
- **Contacts:** mobile matches an Order Capture customer → linked, never renamed. Mobile with no customer → new
  customer (name = Zoho name; place = billing city, else **"Not set"**, with a "Place not set" filter to fill in). No
  usable mobile → "no phone yet". **One mobile on several contacts** → it goes to the contact with the most recent
  invoice; the others become "no phone yet", listed by name.
- **Items:** SKU codes matched to PlantOps products; unmatched codes listed (lines still imported with Zoho's name).
- **Invoices → bills, payments → payments + allocations**, drafts skipped, "closed in Zoho" adjustments as in
  section 3.
- **Delivered orders → linked to their bill:** (1) the invoice no. typed at "Mark delivered" matches; else (2) same
  mobile + invoice dated 0–3 days after delivery + same products and quantities, exactly one fits; else (3) a **"Check
  these"** list where the owner picks the bill or "No Zoho invoice". Each choice is audited.
- The preview's checks must match Zoho: plant 001 = **₹33,76,788 billed, ₹32,94,900 received, ₹1,03,696 due.**

## 9. Who may do what (rows in `src/server/access.ts`)
| Action | Owner | Order desk | Plant staff / Order viewer | Delivery staff | Support |
|---|---|---|---|---|---|
| See bills, payments, statement, balances | ✔ | ✔ | – (amounts) | – | read-only |
| Make / cancel a bill | ✔ | ✔ make; cancel owner only | – | – | – |
| Receive a payment | ✔ | ✔ | – | – | – |
| Cancel a payment | ✔ | – | – | – | – |
| Import from Zoho, Check these, CSV | ✔ | – | – | – | – |
| Add phone to a "no phone yet" contact | ✔ | ✔ | – | – | – |

## 10. Notifications (N5+, added to `NOTIFICATION_KINDS`)
| Kind | Who | When | Level |
|---|---|---|---|
| `order_capture.payment` "Payment ₹500 from Ajit Kirana (cash)" | owners + ticked | payment saved by someone else | bell |
| `order_capture.bill_cancelled` / `payment_cancelled` | owners | saved by someone else | bell |
| `order_capture.overdue` "12 bills overdue, ₹48,200" | owners | daily job, Mondays | phone |

Outbox and `kit.retryOutbox` as today. Each is tested.

## 11. Not in this phase
Sending bills to Zoho automatically (the send queue in `docs/CUSTOMER_APP_PLAN.md` 16.2), credit notes after a bill,
customer-facing bills / the customer app, 20L jars and deposits, purchase side, GST reports.

## 12. Build phases (each with tests; finish and check before the next)
- **L1 – Items:** platform migration (HSN, purchase rate), product screen fields, `hsn` in the module product list,
  and **Import Zoho items** on Business details → Products (Zoho priority, section 4). Tests: matching, Zoho-wins
  fields, kept fields, new-product checks, inactive, re-import, owner-only, tenant isolation, audit.
- **L2 – Ledger database + rules:** Order Capture migration `0008`; due / unused / balance / Closed / statement as pure
  functions (`src/lib/ledger.ts`); tests for isolation, FORCE RLS, append-only, every money case, rounding in paise.
- **L3 – Zoho import:** the three-file preview / confirm, re-import, order linking, "Check these"; tests with
  plant 001's shapes (made-up names).
- **L4 – Customer page + Bills / Payments tabs + statement + CSV;** "no phone yet" contacts and Add phone.
  **Match after import** (owner, 2026-11-06: "we can run a matching post import, for customer name"): a screen that
  suggests, for each "no phone yet" Zoho contact, existing customers with a similar name (place in brackets ignored /
  compared separately); the owner confirms (links the contact, its bills and payments follow) or skips. The same screen
  lists delivered orders not linked to a bill ("Check these") with the nearest bills.
- **L5 – New flow:** Make bill, Receive payment, cancel, Closed orders, notifications.
- **L6 – Release:** NOTES, HANDBOOK "Bills and payments" + "Importing from Zoho", `next build`, deploy; the owner
  imports plant 001's files on the live copy and checks the three totals.

## 13. To confirm with the owner
1. **The two migrations in section 5** (platform: 2 optional product columns; Order Capture: 7 new tables).
2. New bill numbers `B-0001…` and payments `P-0001…`, separate from Zoho's `INV-…`. *Recommended:* yes, so a PlantOps
   bill is never mistaken for a GST invoice.
3. Order desk may make bills and receive payments; only the owner cancels. *Recommended:* yes.
4. A payment goes to the oldest unpaid bills first unless bills are ticked. *Recommended:* yes (Zoho does the same).
5. Place for new customers = billing city, else "Not set". Shared mobile → contact with the latest invoice.
6. The ₹6,893 on 33 invoices closed in Zoho without a payment: imported as "closed in Zoho". If you have Zoho credit
   notes, export them too and they come in as their own records instead.
