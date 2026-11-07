-- Make bill with Zoho-like fields and "Needs GST invoice" → Zoho (owner, 2026-11-07; docs/BILL_FIELDS_PHASE_PLAN.md,
-- approved with the mock-ups). Existing bills and customers are untouched: every new column is empty / false / the old
-- behaviour for them. A bill's amounts stay fixed once saved (no new UPDATE on them); the only new changeable bill
-- columns are "sent to Zoho" (once). No DELETE anywhere.

-- 1. Bills: the new fields. GST bills keep the place of supply, the customer's GSTIN (optional: a person may want a GST
--    invoice without one), whether the rates included GST, and the CGST / SGST / IGST totals (= tax_total).
alter table order_capture.bills
  add column terms text check (terms in ('receipt', 'net7', 'net15', 'net30', 'eom')),
  add column salesperson_id uuid,
  add column vehicle text check (vehicle is null or length(trim(vehicle)) between 1 and 30),
  add column reference_no text check (reference_no is null or length(trim(reference_no)) between 1 and 50),
  add column private_note text check (private_note is null or length(private_note) <= 500),
  add column needs_gst boolean not null default false,
  add column gstin text check (gstin is null or gstin ~ '^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$'),
  add column place_of_supply text check (place_of_supply is null or place_of_supply ~ '^[0-9]{2}$'),
  add column tax_inclusive boolean,
  add column cgst numeric(18, 2) not null default 0 check (cgst >= 0),
  add column sgst numeric(18, 2) not null default 0 check (sgst >= 0),
  add column igst numeric(18, 2) not null default 0 check (igst >= 0),
  add column sent_to_zoho_at timestamptz,
  add column sent_to_zoho_by uuid,
  add column sent_to_zoho_by_name text,
  add constraint bills_gst_needs_place check (not needs_gst or (place_of_supply is not null and tax_inclusive is not null)),
  add constraint bills_tax_split check (tax_total = cgst + sgst + igst or source = 'zoho'),
  add constraint bills_sent_only_gst check (sent_to_zoho_at is null or needs_gst),
  add constraint bills_sent_together check ((sent_to_zoho_at is null) = (sent_to_zoho_by is null)
                                            and (sent_to_zoho_by is null) = (sent_to_zoho_by_name is null));
create index bills_gst_queue on order_capture.bills (tenant_id, bill_date) where needs_gst and zoho_gst_invoice_no is null;

-- 2. Bill lines: the amount before GST (null on bills without GST and on old bills).
alter table order_capture.bill_lines
  add column taxable numeric(18, 2) check (taxable is null or taxable >= 0);

-- 3. Customers: GSTIN and GST state, saved the first time a GST bill is made (owner / Accounts may change them later).
alter table order_capture.customers
  add column gstin text check (gstin is null or gstin ~ '^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$'),
  add column state_code text check (state_code is null or state_code ~ '^[0-9]{2}$');

-- 4. Bill settings, one row per plant (no row = rates include GST, due on receipt, no notes).
create table order_capture.bill_settings (
  tenant_id         uuid primary key,
  rates_include_gst boolean not null default true,
  default_terms     text not null default 'receipt' check (default_terms in ('receipt', 'net7', 'net15', 'net30', 'eom')),
  default_notes     text check (default_notes is null or length(default_notes) <= 2000),
  updated_by        uuid not null,
  updated_by_name   text not null,
  updated_at        timestamptz not null default now()
);
alter table order_capture.bill_settings enable row level security;
alter table order_capture.bill_settings force row level security;
create policy tenant_isolation on order_capture.bill_settings
  using (tenant_id = current_setting('app.tenant_id')::uuid)
  with check (tenant_id = current_setting('app.tenant_id')::uuid);

-- 5. Grants.
grant update (sent_to_zoho_at, sent_to_zoho_by, sent_to_zoho_by_name) on order_capture.bills to order_app;
grant update (gstin, state_code) on order_capture.customers to order_app;
grant select, insert on order_capture.bill_settings to order_app;
grant update (rates_include_gst, default_terms, default_notes, updated_by, updated_by_name, updated_at)
  on order_capture.bill_settings to order_app;
