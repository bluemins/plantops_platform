-- Sales ledger: bills, payments and what each payment paid, plus Zoho's contacts and an import log (owner, 2026-11-06;
-- docs/ZOHO_IMPORT_PHASE_PLAN.md section 5, approved). The flow: order -> delivered -> bill -> payment(s) -> the order
-- shows "Closed" when its bill is fully paid. A PlantOps bill is a statement of account, never a tax invoice; Zoho stays
-- the place for GST invoices (its number is kept on the bill). Imported Zoho invoices are bills with source 'zoho'.
--
-- Money is never stored as a running figure: a bill's due, a payment's unused amount and a customer's balance are worked
-- out from these rows (src/lib/ledger.ts). Nothing is deleted. A mistake is a cancellation with a reason (bills,
-- payments) or a reversing allocation row; only the link / cancel columns listed in section 7 can change.
-- Seven new tables; no existing table changes. Backward-compatible: v0.37.x code ignores them.

-- 1. One row per "Import from Zoho" (counts + file names; the files themselves are never stored).
create table order_capture.zoho_imports (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid not null,
  files            jsonb not null default '{}',
  counts           jsonb not null default '{}',
  export_date      date,                                -- "amount due as of" for the Zoho balances
  imported_by      uuid not null,
  imported_by_name text not null,
  created_at       timestamptz not null default now(),
  unique (tenant_id, id)
);

-- 2. Zoho contacts. Linked to an Order Capture customer when the mobile is known; "no phone yet" otherwise.
create table order_capture.zoho_contacts (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid not null,
  zoho_contact_id  text not null check (length(zoho_contact_id) between 1 and 60),
  name             text not null check (length(trim(name)) between 1 and 200),
  company          text check (company is null or length(company) <= 200),
  mobile_typed     text check (mobile_typed is null or length(mobile_typed) between 1 and 30),
  mobile           text check (mobile is null or mobile ~ '^[6-9][0-9]{9}$'),
  gstin            text check (gstin is null or gstin ~ '^[0-9A-Z]{15}$'),
  zoho_status      text check (zoho_status is null or length(zoho_status) <= 30),
  customer_id      uuid,
  import_id        uuid not null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  check ((mobile is null) = (mobile_typed is null)),
  unique (tenant_id, zoho_contact_id),
  unique (tenant_id, id),
  foreign key (tenant_id, customer_id) references order_capture.customers (tenant_id, id),
  foreign key (tenant_id, import_id) references order_capture.zoho_imports (tenant_id, id)
);
create index zoho_contacts_customer on order_capture.zoho_contacts (tenant_id, customer_id);

-- 3. Bills. source 'zoho' = an imported Zoho invoice (number = Zoho's INV-…); 'plantops' = made here (B-0001…).
--    The customer is an Order Capture customer or (imported, no phone yet) a Zoho contact.
create table order_capture.bills (
  id                  uuid primary key default gen_random_uuid(),
  tenant_id           uuid not null,
  source              text not null check (source in ('zoho', 'plantops')),
  number              text not null check (length(number) between 1 and 40),
  ref_no              int check (ref_no is null or ref_no >= 1),          -- B-0001 for source 'plantops'
  zoho_invoice_id     text check (zoho_invoice_id is null or length(zoho_invoice_id) between 1 and 60),
  bill_date           date not null,
  due_date            date,
  customer_id         uuid,
  zoho_contact_id     uuid,
  customer_name       text not null check (length(trim(customer_name)) between 1 and 200),   -- as billed
  order_id            uuid,
  sub_total           numeric(18, 2) not null,
  discount            numeric(18, 2) not null default 0 check (discount >= 0),
  adjustment          numeric(18, 2) not null default 0,
  tax_total           numeric(18, 2) not null default 0 check (tax_total >= 0),
  total               numeric(18, 2) not null check (total >= 0),
  notes               text check (notes is null or length(notes) <= 2000),
  salesperson         text check (salesperson is null or length(salesperson) <= 100),
  zoho_gst_invoice_no text check (zoho_gst_invoice_no is null or length(zoho_gst_invoice_no) between 1 and 40),
  zoho_status         text check (zoho_status is null or length(zoho_status) <= 30),
  zoho_balance        numeric(18, 2),                  -- Zoho's amount due at the export (checked at import)
  import_id           uuid,
  created_by          uuid not null,
  created_by_name     text not null,
  created_at          timestamptz not null default now(),
  cancelled_at        timestamptz,
  cancelled_by        uuid,
  cancelled_by_name   text,
  cancel_reason       text,
  check (num_nonnulls(customer_id, zoho_contact_id) = 1),
  check ((source = 'plantops') = (ref_no is not null)),
  check ((source = 'zoho') = (zoho_invoice_id is not null)),
  check ((source = 'zoho') = (import_id is not null)),
  check ((cancelled_at is null) = (cancelled_by is null) and (cancelled_by is null) = (cancelled_by_name is null)
         and (cancelled_by_name is null) = (cancel_reason is null)),
  check (cancel_reason is null or length(trim(cancel_reason)) between 3 and 300),
  unique (tenant_id, number),
  unique (tenant_id, ref_no),
  unique (tenant_id, zoho_invoice_id),
  unique (tenant_id, id),
  foreign key (tenant_id, customer_id) references order_capture.customers (tenant_id, id),
  foreign key (tenant_id, zoho_contact_id) references order_capture.zoho_contacts (tenant_id, id),
  foreign key (tenant_id, order_id) references order_capture.orders (tenant_id, id),
  foreign key (tenant_id, import_id) references order_capture.zoho_imports (tenant_id, id)
);
-- one bill per order (a cancelled bill gives its order up, so a new bill can be made)
create unique index bills_one_per_order on order_capture.bills (tenant_id, order_id) where order_id is not null and cancelled_at is null;
create index bills_customer on order_capture.bills (tenant_id, customer_id, bill_date);
create index bills_contact on order_capture.bills (tenant_id, zoho_contact_id, bill_date);
create index bills_date on order_capture.bills (tenant_id, bill_date);

-- 4. Bill lines exactly as billed (Zoho's lines may repeat a product, have decimals, discount and tax).
create table order_capture.bill_lines (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null,
  bill_id      uuid not null,
  line_no      int not null check (line_no between 1 and 500),
  sku_id       uuid,                                    -- the PlantOps product when the code matched
  sku_code     text check (sku_code is null or length(sku_code) <= 40),
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
  line_total   numeric(18, 2) not null check (line_total >= 0),
  unique (tenant_id, bill_id, line_no),
  foreign key (tenant_id, bill_id) references order_capture.bills (tenant_id, id)
);
create index bill_lines_bill on order_capture.bill_lines (tenant_id, bill_id);

-- 5. Payments received. source 'zoho' = imported (Zoho's payment number); 'plantops' = received here (P-0001…).
create table order_capture.payments (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         uuid not null,
  source            text not null check (source in ('zoho', 'plantops')),
  number            text not null check (length(number) between 1 and 40),
  ref_no            int check (ref_no is null or ref_no >= 1),            -- P-0001 for source 'plantops'
  zoho_payment_id   text check (zoho_payment_id is null or length(zoho_payment_id) between 1 and 60),
  payment_date      date not null,
  customer_id       uuid,
  zoho_contact_id   uuid,
  customer_name     text not null check (length(trim(customer_name)) between 1 and 200),
  mode              text not null check (mode in ('cash', 'upi', 'bank', 'cheque', 'other')),
  reference         text check (reference is null or length(reference) <= 100),
  deposit_to        text check (deposit_to is null or length(deposit_to) <= 100),
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
  check (num_nonnulls(customer_id, zoho_contact_id) = 1),
  check ((source = 'plantops') = (ref_no is not null)),
  check ((source = 'zoho') = (zoho_payment_id is not null)),
  check ((source = 'zoho') = (import_id is not null)),
  check ((cancelled_at is null) = (cancelled_by is null) and (cancelled_by is null) = (cancelled_by_name is null)
         and (cancelled_by_name is null) = (cancel_reason is null)),
  check (cancel_reason is null or length(trim(cancel_reason)) between 3 and 300),
  unique (tenant_id, number),
  unique (tenant_id, ref_no),
  unique (tenant_id, zoho_payment_id),
  unique (tenant_id, id),
  foreign key (tenant_id, customer_id) references order_capture.customers (tenant_id, id),
  foreign key (tenant_id, zoho_contact_id) references order_capture.zoho_contacts (tenant_id, id),
  foreign key (tenant_id, import_id) references order_capture.zoho_imports (tenant_id, id)
);
create index payments_customer on order_capture.payments (tenant_id, customer_id, payment_date);
create index payments_contact on order_capture.payments (tenant_id, zoho_contact_id, payment_date);
create index payments_date on order_capture.payments (tenant_id, payment_date);

-- 6. What a payment paid. A negative row undoes an earlier one (cancelled payment or bill); never changed or deleted.
create table order_capture.payment_allocations (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null,
  payment_id      uuid not null,
  bill_id         uuid not null,
  amount          numeric(18, 2) not null check (amount <> 0),
  allocated_on    date not null,
  created_by      uuid not null,
  created_by_name text not null,
  created_at      timestamptz not null default now(),
  foreign key (tenant_id, payment_id) references order_capture.payments (tenant_id, id),
  foreign key (tenant_id, bill_id) references order_capture.bills (tenant_id, id)
);
create index payment_allocations_bill on order_capture.payment_allocations (tenant_id, bill_id);
create index payment_allocations_payment on order_capture.payment_allocations (tenant_id, payment_id);

-- 7. Part of a bill settled without money: 'zoho_closed' (closed in Zoho with no payment in the export, e.g. a credit
--    note), later 'write_off' / 'discount' with a reason. Never changed or deleted.
create table order_capture.bill_adjustments (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null,
  bill_id         uuid not null,
  kind            text not null check (kind in ('zoho_closed', 'write_off', 'discount')),
  amount          numeric(18, 2) not null check (amount > 0),
  reason          text not null check (length(trim(reason)) between 3 and 300),
  adjusted_on     date not null,
  import_id       uuid,
  created_by      uuid not null,
  created_by_name text not null,
  created_at      timestamptz not null default now(),
  check ((kind = 'zoho_closed') = (import_id is not null)),
  foreign key (tenant_id, bill_id) references order_capture.bills (tenant_id, id),
  foreign key (tenant_id, import_id) references order_capture.zoho_imports (tenant_id, id)
);
create index bill_adjustments_bill on order_capture.bill_adjustments (tenant_id, bill_id);

-- 8. Row-level security, like every other table.
do $$
declare t text;
begin
  foreach t in array array['zoho_imports', 'zoho_contacts', 'bills', 'bill_lines', 'payments', 'payment_allocations', 'bill_adjustments'] loop
    execute format('alter table order_capture.%I enable row level security', t);
    execute format('alter table order_capture.%I force row level security', t);
    execute format('create policy tenant_isolation on order_capture.%I using (tenant_id = current_setting(''app.tenant_id'')::uuid) with check (tenant_id = current_setting(''app.tenant_id'')::uuid)', t);
  end loop;
end $$;

-- 9. Grants: read + add; only these columns may change (no DELETE anywhere).
grant select, insert on order_capture.zoho_imports, order_capture.zoho_contacts, order_capture.bills, order_capture.bill_lines,
  order_capture.payments, order_capture.payment_allocations, order_capture.bill_adjustments to order_app;
-- a Zoho contact gets linked to a customer, or the owner adds its phone
grant update (customer_id, mobile, mobile_typed, updated_at) on order_capture.zoho_contacts to order_app;
-- a bill is linked to its order, gets its Zoho GST invoice no., or is cancelled
grant update (order_id, zoho_gst_invoice_no, cancelled_at, cancelled_by, cancelled_by_name, cancel_reason) on order_capture.bills to order_app;
-- a payment is cancelled
grant update (cancelled_at, cancelled_by, cancelled_by_name, cancel_reason) on order_capture.payments to order_app;
