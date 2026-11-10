-- Purchases inside Sales (owner, 2026-11-10; docs/PURCHASES_PHASE_PLAN.md sections 3-4, approved): vendors, purchase
-- items, purchase bills + lines, payments made + what each paid, and a log of "Import from Zoho" for purchases.
-- Same rules as the sales ledger (0008): money is never stored as a running figure (a bill's due, a vendor's balance and
-- a payment's unused amount are worked out from these rows), nothing is deleted, a mistake is a cancellation with a
-- reason. Seven new tables; no existing table changes. Backward-compatible: v0.59.x code ignores them.

-- 1. One row per purchases import (counts + file names; the files themselves are never stored).
create table order_capture.purchase_imports (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid not null,
  files            jsonb not null default '{}',
  counts           jsonb not null default '{}',
  imported_by      uuid not null,
  imported_by_name text not null,
  created_at       timestamptz not null default now(),
  unique (tenant_id, id)
);

-- 2. Vendors (who the plant buys from). From Zoho (zoho_contact_id) or added here (P2).
create table order_capture.vendors (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid not null,
  name             text not null check (length(trim(name)) between 1 and 200),
  company          text check (company is null or length(company) <= 200),
  phone            text check (phone is null or length(phone) between 1 and 30),
  email            text check (email is null or length(email) <= 200),
  gstin            text check (gstin is null or gstin ~ '^[0-9A-Z]{15}$'),
  gst_treatment    text check (gst_treatment is null or gst_treatment in ('registered', 'unregistered', 'overseas', 'other')),
  state            text check (state is null or state ~ '^[0-9]{2}$'),          -- GST state code, e.g. 21 = Odisha
  address          text check (address is null or length(address) <= 500),
  terms            text check (terms is null or length(terms) <= 60),
  notes            text check (notes is null or length(notes) <= 1000),
  active           boolean not null default true,
  zoho_contact_id  text check (zoho_contact_id is null or length(zoho_contact_id) between 1 and 60),
  import_id        uuid,
  created_by       uuid not null,
  created_by_name  text not null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  check ((zoho_contact_id is null) = (import_id is null)),
  unique (tenant_id, zoho_contact_id),
  unique (tenant_id, id),
  foreign key (tenant_id, import_id) references order_capture.purchase_imports (tenant_id, id)
);
create unique index vendors_name on order_capture.vendors (tenant_id, lower(trim(name)));

-- 3. What the plant buys (preforms, caps, labels, chemicals, spares, freight...). The products it sells stay PlantOps
--    products; a purchase item may later point at a Floor Stock item (plain reference, no cross-schema key; P5).
create table order_capture.purchase_items (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid not null,
  name             text not null check (length(trim(name)) between 1 and 200),
  sku              text check (sku is null or length(sku) <= 40),
  hsn              text check (hsn is null or length(hsn) <= 12),
  unit             text check (unit is null or length(unit) <= 20),
  rate             numeric(14, 2) check (rate is null or rate >= 0),
  gst_percent      numeric(5, 2) check (gst_percent is null or gst_percent between 0 and 100),
  description      text check (description is null or length(description) <= 500),
  active           boolean not null default true,
  stock_item_id    uuid,
  zoho_item_id     text check (zoho_item_id is null or length(zoho_item_id) between 1 and 60),
  import_id        uuid,
  created_by       uuid not null,
  created_by_name  text not null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  check ((zoho_item_id is null) = (import_id is null)),
  unique (tenant_id, zoho_item_id),
  unique (tenant_id, id),
  foreign key (tenant_id, import_id) references order_capture.purchase_imports (tenant_id, id)
);

-- 4. Purchase bills (the vendor's bill to the plant). Numbered PB-0001... per plant; Zoho's bill numbers 1-46 become
--    PB-0001...PB-0046 (owner, 2026-11-10), so ref_no is set for both sources when Zoho's number is a plain number.
create table order_capture.purchase_bills (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         uuid not null,
  source            text not null check (source in ('zoho', 'plantops')),
  number            text not null check (length(number) between 1 and 40),
  ref_no            int check (ref_no is null or ref_no >= 1),
  zoho_bill_id      text check (zoho_bill_id is null or length(zoho_bill_id) between 1 and 60),
  vendor_id         uuid not null,
  vendor_name       text not null check (length(trim(vendor_name)) between 1 and 200),   -- as billed
  bill_date         date not null,
  due_date          date,
  vendor_invoice_no text check (vendor_invoice_no is null or length(vendor_invoice_no) between 1 and 60),
  po_number         text check (po_number is null or length(po_number) between 1 and 40),
  sub_total         numeric(18, 2) not null,
  discount          numeric(18, 2) not null default 0 check (discount >= 0),
  adjustment        numeric(18, 2) not null default 0,
  tax_total         numeric(18, 2) not null default 0 check (tax_total >= 0),
  cgst              numeric(18, 2) not null default 0 check (cgst >= 0),
  sgst              numeric(18, 2) not null default 0 check (sgst >= 0),
  igst              numeric(18, 2) not null default 0 check (igst >= 0),
  total             numeric(18, 2) not null check (total >= 0),
  notes             text check (notes is null or length(notes) <= 2000),
  zoho_status       text check (zoho_status is null or length(zoho_status) <= 30),
  zoho_balance      numeric(18, 2),                  -- Zoho's amount due at the export (checked at import)
  import_id         uuid,
  created_by        uuid not null,
  created_by_name   text not null,
  created_at        timestamptz not null default now(),
  cancelled_at      timestamptz,
  cancelled_by      uuid,
  cancelled_by_name text,
  cancel_reason     text,
  check ((source = 'plantops') <= (ref_no is not null)),
  check ((source = 'zoho') = (zoho_bill_id is not null)),
  check ((source = 'zoho') = (import_id is not null)),
  check ((cancelled_at is null) = (cancelled_by is null) and (cancelled_by is null) = (cancelled_by_name is null)
         and (cancelled_by_name is null) = (cancel_reason is null)),
  check (cancel_reason is null or length(trim(cancel_reason)) between 3 and 300),
  unique (tenant_id, number),
  unique (tenant_id, ref_no),
  unique (tenant_id, zoho_bill_id),
  unique (tenant_id, id),
  foreign key (tenant_id, vendor_id) references order_capture.vendors (tenant_id, id),
  foreign key (tenant_id, import_id) references order_capture.purchase_imports (tenant_id, id)
);
create index purchase_bills_vendor on order_capture.purchase_bills (tenant_id, vendor_id, bill_date);
create index purchase_bills_date on order_capture.purchase_bills (tenant_id, bill_date);

-- 5. Purchase bill lines exactly as billed.
create table order_capture.purchase_bill_lines (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null,
  bill_id      uuid not null,
  line_no      int not null check (line_no between 1 and 500),
  item_id      uuid,
  item_name    text not null check (length(trim(item_name)) between 1 and 200),
  description  text check (description is null or length(description) <= 500),
  quantity     numeric(14, 3) not null check (quantity >= 0),
  unit         text check (unit is null or length(unit) <= 20),
  rate         numeric(14, 2) not null check (rate >= 0),
  discount     numeric(14, 2) not null default 0 check (discount >= 0),
  tax_name     text check (tax_name is null or length(tax_name) <= 40),
  tax_percent  numeric(5, 2) check (tax_percent is null or tax_percent between 0 and 100),
  tax_amount   numeric(14, 2) not null default 0 check (tax_amount >= 0),
  hsn          text check (hsn is null or length(hsn) <= 12),
  line_total   numeric(18, 2) not null check (line_total >= 0),      -- before GST, like Zoho's "Item Total"
  unique (tenant_id, bill_id, line_no),
  foreign key (tenant_id, bill_id) references order_capture.purchase_bills (tenant_id, id),
  foreign key (tenant_id, item_id) references order_capture.purchase_items (tenant_id, id)
);
create index purchase_bill_lines_bill on order_capture.purchase_bill_lines (tenant_id, bill_id);
create index purchase_bill_lines_item on order_capture.purchase_bill_lines (tenant_id, item_id);

-- 6. Payments made to vendors. PM-0001... per plant (Zoho's payment numbers become PM-…). The mode and "paid from"
--    can be corrected later by the owner (owner, 2026-11-10: Zoho has every payment as Cash / Petty Cash).
create table order_capture.vendor_payments (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         uuid not null,
  source            text not null check (source in ('zoho', 'plantops')),
  number            text not null check (length(number) between 1 and 40),
  ref_no            int check (ref_no is null or ref_no >= 1),
  zoho_payment_id   text check (zoho_payment_id is null or length(zoho_payment_id) between 1 and 60),
  vendor_id         uuid not null,
  vendor_name       text not null check (length(trim(vendor_name)) between 1 and 200),
  payment_date      date not null,
  mode              text not null check (mode in ('cash', 'upi', 'bank', 'cheque', 'other')),
  paid_from         text check (paid_from is null or length(paid_from) <= 100),
  reference         text check (reference is null or length(reference) <= 100),
  amount            numeric(18, 2) not null check (amount > 0),
  note              text check (note is null or length(note) <= 300),
  import_id         uuid,
  created_by        uuid not null,
  created_by_name   text not null,
  created_at        timestamptz not null default now(),
  cancelled_at      timestamptz,
  cancelled_by      uuid,
  cancelled_by_name text,
  cancel_reason     text,
  check ((source = 'plantops') <= (ref_no is not null)),
  check ((source = 'zoho') = (zoho_payment_id is not null)),
  check ((source = 'zoho') = (import_id is not null)),
  check ((cancelled_at is null) = (cancelled_by is null) and (cancelled_by is null) = (cancelled_by_name is null)
         and (cancelled_by_name is null) = (cancel_reason is null)),
  check (cancel_reason is null or length(trim(cancel_reason)) between 3 and 300),
  unique (tenant_id, number),
  unique (tenant_id, ref_no),
  unique (tenant_id, zoho_payment_id),
  unique (tenant_id, id),
  foreign key (tenant_id, vendor_id) references order_capture.vendors (tenant_id, id),
  foreign key (tenant_id, import_id) references order_capture.purchase_imports (tenant_id, id)
);
create index vendor_payments_vendor on order_capture.vendor_payments (tenant_id, vendor_id, payment_date);
create index vendor_payments_date on order_capture.vendor_payments (tenant_id, payment_date);

-- 7. What a payment paid. A negative row undoes an earlier one (cancelled payment or bill); never changed or deleted.
create table order_capture.vendor_payment_allocations (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null,
  payment_id      uuid not null,
  bill_id         uuid not null,
  amount          numeric(18, 2) not null check (amount <> 0),
  allocated_on    date not null,
  created_by      uuid not null,
  created_by_name text not null,
  created_at      timestamptz not null default now(),
  foreign key (tenant_id, payment_id) references order_capture.vendor_payments (tenant_id, id),
  foreign key (tenant_id, bill_id) references order_capture.purchase_bills (tenant_id, id)
);
create index vendor_payment_allocations_bill on order_capture.vendor_payment_allocations (tenant_id, bill_id);
create index vendor_payment_allocations_payment on order_capture.vendor_payment_allocations (tenant_id, payment_id);

-- 8. Row-level security, like every other table.
do $$
declare t text;
begin
  foreach t in array array['purchase_imports', 'vendors', 'purchase_items', 'purchase_bills', 'purchase_bill_lines', 'vendor_payments', 'vendor_payment_allocations'] loop
    execute format('alter table order_capture.%I enable row level security', t);
    execute format('alter table order_capture.%I force row level security', t);
    execute format('create policy tenant_isolation on order_capture.%I using (tenant_id = current_setting(''app.tenant_id'')::uuid) with check (tenant_id = current_setting(''app.tenant_id'')::uuid)', t);
  end loop;
end $$;

-- 9. Grants: read + add; only these columns may change (no DELETE anywhere).
grant select, insert on order_capture.purchase_imports, order_capture.vendors, order_capture.purchase_items, order_capture.purchase_bills,
  order_capture.purchase_bill_lines, order_capture.vendor_payments, order_capture.vendor_payment_allocations to order_app;
-- a vendor's / item's details are edited, or switched off (P2)
grant update (name, company, phone, email, gstin, gst_treatment, state, address, terms, notes, active, updated_at) on order_capture.vendors to order_app;
grant update (name, sku, hsn, unit, rate, gst_percent, description, active, stock_item_id, updated_at) on order_capture.purchase_items to order_app;
-- a purchase bill is cancelled
grant update (cancelled_at, cancelled_by, cancelled_by_name, cancel_reason) on order_capture.purchase_bills to order_app;
-- a payment made gets its real mode / "paid from" (owner), or is cancelled
grant update (mode, paid_from, cancelled_at, cancelled_by, cancelled_by_name, cancel_reason) on order_capture.vendor_payments to order_app;
