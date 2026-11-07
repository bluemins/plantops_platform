# Bill fields + "Needs GST invoice" → Zoho: phase plan

Asked by the owner 2026-11-07. Status: **approved by the owner 2026-11-07** (both migrations; CSV to Zoho now, API
later; plant GSTIN + state on Business details; 5% GST on every water product). **Changed 2026-11-07:** plant 001's
Zoho Items rates are out of date (20 L = 18% in Zoho, but INV-001840 charged 5%; 250 / 500 ml = 18% intra, 5% inter), so
**the owner sets each product's GST rate on Products; the Zoho items import never touches it** (owner's choice).
Builds on the sales ledger (`docs/ZOHO_IMPORT_PHASE_PLAN.md`, v0.39.0 / v0.40.0).

## 1. Why
"Make bill" today asks only discount, due date and the Zoho GST invoice no., so a bill is a copy of the delivered order
("no difference between delivered and bill"). The owner wants a Zoho-like bill, so that later reports can use the fields,
and a tick for bills that need a GST invoice, so they go to Zoho.

## 2. Decisions (owner, 2026-11-07)
1. Rates are **GST-inclusive** by default, **configurable**: a plant setting (Rates include GST: yes / no) gives the
   default, and each bill can change it ("Rates include GST" switch in all fields). The owner's L&T sample (INV-001840) is
   GST on top: 92 × ₹55 = ₹5,060 + CGST 2.5% ₹126.50 + SGST 2.5% ₹126.50 = ₹5,313.
2. **"Needs GST invoice" is ticked automatically when the customer has a GSTIN**; it can be unticked.
3. The form shows the **important fields first**; the rest appear under **"Show all fields"**.
4. The fields follow the owner's sample Zoho tax invoice.

## 3. The Make bill form
Mock-ups (5 phone screens, 2026-11-07): https://claude.ai/artifact/FvKFjDCJ5vfhKVULU9ShVc
Platform migration number: **`0026`** (0025 is the Accounts role).

```
Make bill                                   O-0132 · Rocky · Bijepur
──────────────────────────────────────────────────────────────────
Bill date [07-11-2026]   Terms [Due on receipt ▾]   Due [07-11-2026]
☑ Needs GST invoice (send to Zoho)
   GSTIN [21AAACL0140P4ZS]   Place of supply [Odisha (21) ▾]
   Rates include GST: [Yes ▾]   (plant default; this bill only)
Lines
  Bluemins 1L (1 L × 12)  HSN 002201  25 box × ₹100  GST 5%  ₹2,500
  Description [Oct month                       ]
Discount ₹ [   ]
──────────────────────────────────────────────────────────────────
Taxable ₹2,380.95 · CGST 2.5% ₹59.52 · SGST 2.5% ₹59.53 · Total ₹2,500
▸ Show all fields
   Salesperson [▾ plant users]   Reference / PO no. [      ]
   Vehicle / delivered by [      ]   Adjustment ± [   ]
   Line discount (per line)   Customer notes [Thanks for your business.]
   Private note [      ]   Zoho GST invoice no. [INV-……] (fills itself after the Zoho import)
                                              [ Save bill ]  [ Cancel ]
```

- Important (always shown): bill date, terms → due date, **salesperson** (owner 2026-11-07; a plant user or None,
  filled in from this customer's last bill) and **vehicle** (a separate field, owner 2026-11-07: no "delivered by";
  free text, suggests the plant's earlier vehicle numbers, filled in from this customer's last bill), the GST tick, GSTIN + place of supply (only when ticked),
  line description, discount, the tax breakdown and total.
- Show all fields: reference / PO no., adjustment (round-off), discount per line,
  customer notes, private note, rates include GST (this bill), Zoho GST invoice no.
- Tax per line: rate from the product (new **GST rate** on products, platform). Same state as the plant → CGST + SGST
  half each; another state → IGST. Inclusive: taxable = amount ÷ (1 + rate), rounded per line to the paisa.
- Without the GST tick, a bill is still the plant's statement of account; the tax lines show only when the tick is on.
- The customer's GSTIN and state are saved on the customer the first time, so the next bill fills them in.

## 4. "Send to Zoho"
- Bills tab gets a **"GST invoices to make (N)"** list: ticked bills not yet sent to Zoho, not cancelled.
- **Download for Zoho** writes them as a CSV in Zoho Books' invoice-import layout (one row per line: Invoice Date,
  Invoice Number = the B-number as reference, Customer Name, GST Identification Number, Place of Supply, Payment Terms,
  Due Date, Item Name, Item Desc, HSN/SAC, Quantity, Rate, Item Tax %, Discount, Adjustment, Is Inclusive Tax, Sales
  person, Customer Notes). Each download marks the bills "sent to Zoho" (who / when; audited); "Download again" for
  repeats.
- Back from Zoho: the existing Zoho import (invoices only, after 6 Nov), or typing the INV number on the bill, fills
  "Zoho GST invoice no.". The list then shows the bill as done.
- Later (only if the owner wants): send them straight to Zoho through the Zoho Books API (needs a Zoho connection).

## 5. Database changes (owner's approval needed)
**Order Capture migration `0009_bill_fields.sql`:**
- `bills`: `terms`, `reference_no`, `vehicle`, `private_note`, `needs_gst` (bool, default false), `gstin`,
  `place_of_supply` (state code), `tax_inclusive` (bool), `sent_to_zoho_at` / `_by` / `_by_name` (column UPDATE, once)
- `bill_lines`: uses the existing `description`, `discount`, `tax_percent`, `tax_amount`, `hsn`; new `tax_kind`
  ('cgst_sgst' / 'igst'). Bills and lines stay append-only (no UPDATE on the amounts, no DELETE).
- `customers`: `gstin`, `state_code` (column UPDATE, like the other customer fields)
- `plant_settings` (or a new ledger settings row): `rates_include_gst` (default true), `default_terms`,
  `default_customer_notes`
- Existing bills read as: not GST, inclusive, no terms. Nothing that is already saved changes.

**Platform migration `0025_sku_gst_rate.sql`:** `tenant_skus.gst_rate` (0 / 5 / 12 / 18 / 28, optional), on
Products and from the Zoho items import; plant **GSTIN** and **state** on Business details (for the bill header and
CGST / SGST vs IGST). Modules get `gst_rate` with the product list. SSO token unchanged.

## 6. Who
Make bill and the GST tick: owner + Accounts (as today). Send to Zoho list and download: owner + Accounts. Support
read-only. Order desk and plant staff: no change (they don't see bills).

## 7. Phases
1. **B1 Platform:** GST rate on products, plant GSTIN + state. Tests. **Built 2026-11-07 (v0.41.0):** platform
   migration `0026_gst_fields.sql` (`tenant_profiles.gstin` with the GSTIN pattern, `tenant_skus.gst_rate` in 0 / 5 / 12 /
   18 / 28 / 40); shared `packages/types/src/gst.ts` (`GST_RATES`, `GST_STATES`, `gstinProblem` with the check character,
   checked on 21NWSPS1732J1ZX and 21AAACL0140P4ZS); GSTIN on Business details (state shown from it), GST rate on
   Products; modules get `gst_rate` with the products and `gstin` with the branding (never the purchase rate). The Zoho
   items import is unchanged (owner: rates set by hand).
2. **B2 Order Capture migration + rules** (built 2026-11-07, v0.42.0: `0009_bill_fields.sql`, `billAmounts` / `dueFromTerms` in `src/lib/ledger.ts`, 13 tests incl. L&T ₹5,313 and ₹2,500 inclusive = 2,380.95 + 59.52 + 59.53): tax arithmetic (inclusive / exclusive, CGST+SGST / IGST, rounding) in
   `src/lib/ledger.ts` with the owner's L&T sample (₹5,313) and an inclusive example as tests.
3. **B3 Make bill form** (built 2026-11-07, v0.42.0: `src/server/bill-make.ts`, `MakeBill` in `src/app/ledger-forms.tsx`, bill page, Rates → Bill settings; salespeople = owners + Order Capture people from alert-contacts): important fields, Show all fields, GST tick auto from the customer's GSTIN, saved customer
   GSTIN / state; bill page and print show the new fields. Tests.
4. **B4 Send to Zoho** (built 2026-11-07, v0.42.0: `/bills/gst`, `POST /api/bills/zoho` with `which` new / again; columns from the plant's own Zoho invoice export: place of supply "OD", GST Treatment business_gst / consumer, Item Tax GST5 / IGST5, status Draft): list, CSV in Zoho's layout, mark sent, INV number back. Tests; one real import into Zoho by the
   owner with one bill.
5. **B5 Reports (later, owner to order):** sales by salesperson / area / vehicle / product / HSN, GST vs non-GST,
   discounts, days to pay.

## 8. Open questions for the owner
1. CSV download into Zoho now, API later? **Recommended: yes** (no Zoho login to set up; one file a day is quick).
2. The plant's own GSTIN and state on Business details? **Recommended: yes** (it decides CGST + SGST vs IGST and goes
   on the bill header).
3. GST rate per product: **recommended 5% for every water product**, as on the L&T sample, filled from Zoho's items
   where Zoho has it.
(The rounding of an inclusive split, e.g. CGST ₹59.52 + SGST ₹59.53, is checked against one real Zoho invoice in B2.)
