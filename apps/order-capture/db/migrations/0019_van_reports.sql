-- Cash book step C3 (owner, 2026-11-11; docs/CASHBOOK_PHASE_PLAN.md section 3.2, approved "Approve 0019"): the van
-- report. One report per vehicle trip: boxes sold per product (grouped by brand, rate from Rates), "not paid" lines (credit
-- given), "collected from customers" lines (C2's collection_lines, batch_id = the report), online, meal, tiffin, diesel,
-- toll, and the cash handed in. The cash handed in is one 'van' cash book entry; the arithmetic is never stored as a
-- running figure except the report's own worked-out "cash to hand in", kept as it was when saved.
-- "Not paid" lines WAIT in To post like collections (owner 2026-11-11): posting makes the bill on the customer's account.
-- Load out / returned per product are optional placeholders (owner 2026-11-11). Nothing is deleted; a wrong report is
-- cancelled by cancelling its cash entry (owner, reason). Four new tables; one existing check widened (cash_entries.kind).

-- 1. Cash entries: 'van' = the cash a van handed in (money in).
alter table order_capture.cash_entries drop constraint cash_entries_kind_check;
alter table order_capture.cash_entries add constraint cash_entries_kind_check
  check (kind in ('expense', 'staff_out', 'staff_in', 'owner_in', 'owner_out', 'bank_deposit', 'other_in', 'other_out', 'collection', 'van'));

-- 2. The report, one per van trip, with its own sums as saved (paise-exact numerics).
create table order_capture.van_reports (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid not null,
  cash_entry_id    uuid not null,
  vehicle_id       uuid not null,
  work_date        date not null,
  person_user_id   uuid,
  person_name      text not null check (length(trim(person_name)) between 1 and 100),
  sales            numeric(14, 2) not null check (sales >= 0),
  not_paid         numeric(14, 2) not null default 0 check (not_paid >= 0),
  collected_cash   numeric(14, 2) not null default 0 check (collected_cash >= 0),
  collected_online numeric(14, 2) not null default 0 check (collected_online >= 0),
  online           numeric(14, 2) not null default 0 check (online >= 0),
  meal             numeric(14, 2) not null default 0 check (meal >= 0),
  tiffin           numeric(14, 2) not null default 0 check (tiffin >= 0),
  diesel           numeric(14, 2) not null default 0 check (diesel >= 0),
  toll             numeric(14, 2) not null default 0 check (toll >= 0),
  expected         numeric(14, 2) not null,
  handed_in        numeric(14, 2) not null check (handed_in > 0),
  difference       numeric(14, 2) not null,
  note             text check (note is null or length(note) <= 300),
  created_by       uuid not null,
  created_by_name  text not null,
  created_at       timestamptz not null default now(),
  check (expected = sales - not_paid + collected_cash - online - meal - tiffin - diesel - toll),
  check (difference = handed_in - expected),
  unique (tenant_id, cash_entry_id),
  unique (tenant_id, id),
  foreign key (tenant_id, cash_entry_id) references order_capture.cash_entries (tenant_id, id),
  foreign key (tenant_id, vehicle_id) references order_capture.cash_vehicles (tenant_id, id)
);
create index van_reports_day on order_capture.van_reports (tenant_id, work_date);

-- 3. What the van sold, per product (a copy of the name, brand and unit as they were); optional loaded / returned boxes.
create table order_capture.van_report_lines (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid not null,
  report_id        uuid not null,
  line_no          int not null check (line_no between 1 and 200),
  sku_id           uuid not null,
  product_name     text not null check (length(trim(product_name)) between 1 and 200),
  brand            text not null default '' check (length(brand) <= 60),
  unit             text not null check (length(unit) between 1 and 20),
  quantity         int not null check (quantity between 0 and 100000),
  rate             numeric(10, 2) not null check (rate >= 0),
  amount           numeric(14, 2) not null check (amount = quantity * rate),
  loaded           int check (loaded is null or loaded between 0 and 100000),
  returned         int check (returned is null or returned between 0 and 100000),
  check (quantity > 0 or loaded is not null or returned is not null),
  unique (tenant_id, report_id, line_no),
  unique (tenant_id, report_id, sku_id),
  foreign key (tenant_id, report_id) references order_capture.van_reports (tenant_id, id)
);

-- 4. "Not paid" lines: credit given to a customer on the trip. Each waits until posted (a bill) or turned down.
create table order_capture.van_credit_lines (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid not null,
  report_id        uuid not null,
  line_no          int not null check (line_no between 1 and 200),
  customer_id      uuid not null,
  amount           numeric(14, 2) not null check (amount > 0 and amount <= 10000000),
  note             text check (note is null or length(note) <= 300),
  created_at       timestamptz not null default now(),
  unique (tenant_id, report_id, line_no),
  unique (tenant_id, id),
  foreign key (tenant_id, report_id) references order_capture.van_reports (tenant_id, id),
  foreign key (tenant_id, customer_id) references order_capture.customers (tenant_id, id)
);
create index van_credit_lines_customer on order_capture.van_credit_lines (tenant_id, customer_id);

-- 5. What the owner / Accounts did with a "not paid" line: 'billed' (the bill made, maybe on another customer) or
--    'turned_down' (reason). Billed again only after that bill was cancelled (checked by the app under a lock).
create table order_capture.van_credit_posts (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid not null,
  credit_line_id   uuid not null,
  outcome          text not null check (outcome in ('billed', 'turned_down')),
  bill_id          uuid,
  reason           text check (reason is null or length(trim(reason)) between 3 and 300),
  created_by       uuid not null,
  created_by_name  text not null,
  created_at       timestamptz not null default now(),
  check ((outcome = 'billed') = (bill_id is not null)),
  check ((outcome = 'turned_down') = (reason is not null)),
  unique (tenant_id, bill_id),
  foreign key (tenant_id, credit_line_id) references order_capture.van_credit_lines (tenant_id, id),
  foreign key (tenant_id, bill_id) references order_capture.bills (tenant_id, id)
);
create index van_credit_posts_line on order_capture.van_credit_posts (tenant_id, credit_line_id);

-- 6. Row-level security, like every other table.
do $$
declare t text;
begin
  foreach t in array array['van_reports', 'van_report_lines', 'van_credit_lines', 'van_credit_posts'] loop
    execute format('alter table order_capture.%I enable row level security', t);
    execute format('alter table order_capture.%I force row level security', t);
    execute format('create policy tenant_isolation on order_capture.%I using (tenant_id = current_setting(''app.tenant_id'')::uuid) with check (tenant_id = current_setting(''app.tenant_id'')::uuid)', t);
  end loop;
end $$;

-- 7. Grants: read + add only (no UPDATE, no DELETE).
grant select, insert on order_capture.van_reports, order_capture.van_report_lines, order_capture.van_credit_lines, order_capture.van_credit_posts to order_app;
