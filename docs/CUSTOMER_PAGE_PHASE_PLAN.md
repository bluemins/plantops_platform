# Customer page (Sales): Phase Plan

**Status:** Asked by the owner 2026-11-07; design and mock-up agreed the same day. **Part 1 live (v0.44.0); Part 2 + GST details live (v0.45.0, 2026-11-07, migration `0010` applied). Next: Part 3 (Zoho Contacts fill).** Part 1 needs no
database change; Part 2's migration is listed in section 5 (owner agreed to the fields and permissions, migration text
to be shown before it is applied).

**Mock-up (2026-11-07):** https://claude.ai/artifact/NcJtuLX74cmspbpZU5vgzx (dashboard card, Overview with Shop
location, Transactions, Comments, Statement, Edit). Model: the owner's Zoho Books customer screenshots (Overview,
Comments, Transactions, Statement).

## 1. What the owner asked (2026-11-07)
- A **Customers card** on the owner's dashboard; the customer's details visible and editable there. Owner only for now.
- One customer = **PlantOps customer + its Zoho contact(s)**, on one page like Zoho: Overview, Transactions (**Bills and
  Payments first**), Comments, Statement.
- A **Google location** for the shop, saved by the person who visits it (field staff).

## 2. Decisions (owner, 2026-11-07)
| # | Decision |
|---|---|
| D1 | Card on the platform dashboard, owner only; the data stays in Sales (the card reads a summary, like Reports). |
| D2 | Fields: addresses (billing + delivery + landmark), business details (company, email, other phone, customer type), payment terms + GST treatment + place of supply (GSTIN exists), **contact persons**. |
| D3 | Mobile number: the **owner** may change it, with a reason; refused if another customer has it. Old orders and bills keep their copy. |
| D4 | Only the **owner** edits customer details (Order desk keeps today's add / name / place / on-off). |
| D5 | Fill from Zoho once: Contacts.csv uploaded again fills **empty** fields only; never bills or payments. Contact persons from Zoho's separate contact-persons export if available. |
| D6 | Shop location, quick path: **"📍 Save my location here"** on the customer page, for whoever stands at the shop. **Delivery staff** may open a customer page with the location box only (no amounts, no bills, no edit). Rough fixes (worse than ±150 m) refused. The owner may also paste a Google Maps link. |
| D8 | **Calling name vs GST details** (owner, 2026-11-07): in Sales a customer's name is the **calling name** everywhere (the order form's phone lookup, lists, ordinary bills). The **GST details** (legal name, GSTIN, GST treatment, billing address, GST state) are a separate block on the same customer (Overview "Billing & GST"), used only by GST bills and the Zoho file ("Customer Name" = legal name, so Zoho matches its contact). The first GST bill saves them on the customer; a GST bill keeps a copy (bill-to name + address). Example: calling name "Ajit kirana store", Zoho contact "Ashu battle shop(BPL)". |
| D7 | Never editable: money due, the copies on past orders / bills, Zoho contact id, created by / when. |

**Proposed (made while planning, owner may change):**
- Save location: owner, Order desk, Accounts, Delivery staff. Clear (wrong pin, with a reason): owner and Order desk.
- Customer type list: Shop / Household / Office / Institution / Individual.
- Comments: owner only (write); owner + Accounts + support read. ≤ 500 characters, never changed.
- The later Field day log (`docs/FIELD_DAY_PHASE_PLAN.md`, "Shop location on the customer") saves into the **same**
  location record, so nothing built here is redone.

## 3. Part 1: card + page tabs (no migration)
1. **Platform:** `CustomersCard` beside `ReportsCard` (`apps/platform/src/app/home/page.tsx`), owner only, badges from a
   Sales summary (`view: "customers"`): customers, money due (people), no phone yet. Open →
   `/sso/start?module=order_capture&next=/customers`.
2. **Sales, customer page** (`src/app/customers/[id]`, `src/app/account-view.tsx`): tabs **Overview / Transactions /
   Comments (Part 2) / Statement**.
   - Overview: today's details (name, mobile, place, GSTIN, linked Zoho contact(s)), money boxes, timeline from bills,
     payments, cancellations and audit rows.
   - Transactions: Bills table (date, number, order, from, amount, balance due, status, chips All / Due / Paid /
     Cancelled, totals) and Payments table (date, number, reference, mode, for bills, amount, unused, status). Old
     `?tab=bills|payments` links go to Transactions. Orders stay as their own section.
   - Statement: quick ranges (this / previous month, this quarter); plant name, address and GSTIN at the top of print.
   - Same page for a Zoho contact without a phone (`/customers/z/[id]`).
3. Customers list: chips "Due" and "No phone yet".
4. Tests: card owner-only, summary numbers, tabs per role (Order desk / Accounts / viewer / support), no amounts where
   today there are none.

## 4. Part 2: fields, edit, comments, contact persons, shop location (migration)
- Owner **Edit** with the D2 fields; mobile change (D3); every change audited and in the timeline / Recent changes.
- **Comments** tab.
- **Contact persons** (name, phone, role; add / switch off, never delete).
- **Shop location** (D6): browser location at the tap (same `bestLocation()` as Attendance: waits for good GPS);
  📍 Google Maps link `https://www.google.com/maps?q=<lat>,<lng>`; "Saved <date> by <name> ±N m". Shown on the
  customer page; on the order page and in "Copy as WhatsApp message" once the owner confirms.
- Delivery staff: a customer search (name / phone) that opens the location-only page.
- **Zoho fill** (D5): upload Contacts.csv → preview "N customers get an address / email / terms…" → confirm.

## 5. Part 2 database change (to show the owner before applying)
Sales migration `0010_customer_details.sql`:
- `customers`: `company`, `email`, `other_phone`, `customer_type`, `billing_address`, `billing_city`, `billing_pin`,
  `billing_state_code`, `delivery_same` (default true), `delivery_address`, `delivery_city`, `delivery_pin`,
  `delivery_landmark`, `payment_terms`, `gst_treatment`, `place_of_supply` (all optional, checked lengths / shapes).
  Grant UPDATE on these + `phone`, `phone_typed` (D3; uniqueness kept by the existing unique index).
- `customer_comments` (append-only), `customer_persons` (UPDATE only `active`), `customer_locations` (append-only:
  `kind` set / clear, lat / lng numeric(9,6), `accuracy_m`, `source` customer_page / map_link / field_visit, who,
  reason for clear). All with `tenant_id` + FORCE RLS, `order_app` SELECT + INSERT (+ the one UPDATE), no DELETE.
- SSO token and platform database unchanged.
