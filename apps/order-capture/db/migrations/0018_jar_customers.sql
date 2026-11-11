-- Cash book step C2 (owner, 2026-11-11; docs/CASHBOOK_PHASE_PLAN.md section 6a, approved): the plant's 20 L customers
-- imported from the owner's 20 L pending report (Pure Pani "Remaining Payment"), each with what they owe as an opening
-- balance bill, and collections in the cash book.
-- A collection (owner 2026-11-11): the cash goes into the cash book at once (one 'collection' entry for the cash part);
-- each customer line WAITS in Sales as "collected, not posted yet". Only when the owner or Accounts posts a line is a
-- payment made on the customer's account and set against bills ("it should not update the billing directly"). A line
-- can instead be turned down with a reason (not a customer payment). Nothing is deleted or changed afterwards.
-- Four new tables; two existing checks widened (bills.source, cash_entries.kind). Backward-compatible: v0.63.x code
-- never writes the new values.

-- 1. Bills: 'opening' = a balance owed from before PlantOps, brought in from another app's report (here the 20 L pending
--    report). Numbered OB20-<that app's ref>; no B-number (ref_no stays null), no Zoho ids, no lines: sales reports leave
--    it out, Receivables and the customer's statement count it, like Zoho's OB-... bills.
alter table order_capture.bills drop constraint bills_source_check;
alter table order_capture.bills add constraint bills_source_check check (source in ('zoho', 'plantops', 'opening'));
alter table order_capture.bills add constraint bills_opening_customer check (source <> 'opening' or (customer_id is not null and order_id is null));

-- 2. One row per 20 L import (file name, counts, total; the file itself is never stored).
create table order_capture.jar_imports (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid not null,
  file_name        text not null check (length(file_name) between 1 and 200),
  counts           jsonb not null default '{}',
  total_due        numeric(18, 2) not null check (total_due >= 0),
  imported_by      uuid not null,
  imported_by_name text not null,
  created_at       timestamptz not null default now(),
  unique (tenant_id, id)
);

-- 3. The "20 L" mark on a Sales customer: the other app's reference, group and payment preference, and the opening
--    bill made at import (null when nothing was owed). The same reference is never imported twice.
create table order_capture.jar_customers (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid not null,
  customer_id      uuid not null,
  source_ref       text not null check (length(trim(source_ref)) between 1 and 60),
  source_name      text not null check (length(trim(source_name)) between 1 and 200),
  group_name       text check (group_name is null or length(group_name) <= 60),
  payment_pref     text check (payment_pref is null or length(payment_pref) <= 30),
  opening_bill_id  uuid,
  opening_due      numeric(18, 2) not null default 0 check (opening_due >= 0),
  import_id        uuid not null,
  created_by       uuid not null,
  created_by_name  text not null,
  created_at       timestamptz not null default now(),
  check ((opening_bill_id is null) = (opening_due = 0)),
  unique (tenant_id, source_ref),
  unique (tenant_id, id),
  foreign key (tenant_id, customer_id) references order_capture.customers (tenant_id, id),
  foreign key (tenant_id, opening_bill_id) references order_capture.bills (tenant_id, id),
  foreign key (tenant_id, import_id) references order_capture.jar_imports (tenant_id, id)
);
create index jar_customers_customer on order_capture.jar_customers (tenant_id, customer_id);

-- 4. Cash entries: 'collection' = cash collected from customers (money in); its customer lines are below.
alter table order_capture.cash_entries drop constraint cash_entries_kind_check;
alter table order_capture.cash_entries add constraint cash_entries_kind_check
  check (kind in ('expense', 'staff_out', 'staff_in', 'owner_in', 'owner_out', 'bank_deposit', 'other_in', 'other_out', 'collection'));

-- 5. A collection's customer lines, as typed. One save = one batch; the cash lines' total is the batch's cash entry
--    (null when every line was online: that money went to the bank, not the box).
create table order_capture.collection_lines (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid not null,
  batch_id         uuid not null,
  line_no          int not null check (line_no between 1 and 200),
  cash_entry_id    uuid,
  customer_id      uuid not null,
  amount           numeric(14, 2) not null check (amount > 0 and amount <= 10000000),
  mode             text not null check (mode in ('cash', 'upi')),
  work_date        date not null,
  note             text check (note is null or length(note) <= 300),
  created_by       uuid not null,
  created_by_name  text not null,
  created_at       timestamptz not null default now(),
  check (mode = 'upi' or cash_entry_id is not null),
  unique (tenant_id, batch_id, line_no),
  unique (tenant_id, id),
  foreign key (tenant_id, cash_entry_id) references order_capture.cash_entries (tenant_id, id),
  foreign key (tenant_id, customer_id) references order_capture.customers (tenant_id, id)
);
create index collection_lines_entry on order_capture.collection_lines (tenant_id, cash_entry_id);
create index collection_lines_customer on order_capture.collection_lines (tenant_id, customer_id);

-- 6. What the owner / Accounts did with a line: 'posted' (the payment made, possibly on another customer picked at
--    posting) or 'turned_down' (reason). A line is posted again only after its payment was cancelled (checked by the
--    app under a lock); every attempt stays on record.
create table order_capture.collection_posts (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid not null,
  line_id          uuid not null,
  outcome          text not null check (outcome in ('posted', 'turned_down')),
  payment_id       uuid,
  reason           text check (reason is null or length(trim(reason)) between 3 and 300),
  created_by       uuid not null,
  created_by_name  text not null,
  created_at       timestamptz not null default now(),
  check ((outcome = 'posted') = (payment_id is not null)),
  check ((outcome = 'turned_down') = (reason is not null)),
  unique (tenant_id, payment_id),
  unique (tenant_id, id),
  foreign key (tenant_id, line_id) references order_capture.collection_lines (tenant_id, id),
  foreign key (tenant_id, payment_id) references order_capture.payments (tenant_id, id)
);
create index collection_posts_line on order_capture.collection_posts (tenant_id, line_id);

-- 7. Row-level security, like every other table.
do $$
declare t text;
begin
  foreach t in array array['jar_imports', 'jar_customers', 'collection_lines', 'collection_posts'] loop
    execute format('alter table order_capture.%I enable row level security', t);
    execute format('alter table order_capture.%I force row level security', t);
    execute format('create policy tenant_isolation on order_capture.%I using (tenant_id = current_setting(''app.tenant_id'')::uuid) with check (tenant_id = current_setting(''app.tenant_id'')::uuid)', t);
  end loop;
end $$;

-- 8. Grants: read + add only (no UPDATE, no DELETE).
grant select, insert on order_capture.jar_imports, order_capture.jar_customers, order_capture.collection_lines, order_capture.collection_posts to order_app;
