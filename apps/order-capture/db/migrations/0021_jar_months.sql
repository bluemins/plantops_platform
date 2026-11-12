-- Cash book step C5 (owner, 2026-11-12; docs/CASHBOOK_PHASE_PLAN.md section 9, approved "Yes, as described"): the
-- monthly 20 L "Remaining" import. Each month the owner uploads the other 20 L app's Remaining Payment report again;
-- per 20 L customer (Ref. No.) the sheet's Remaining is compared with what PlantOps shows due on that customer's 20 L
-- bills (the OB20 opening bill + earlier month bills). The other app also records the payments collected in PlantOps,
-- so its Remaining is the true balance (owner, 2026-11-12):
--   sheet higher → a '20 L month' bill for the difference (J20-<ref>-<YYYY-MM>, no lines, due the same day: owner)
--   the same     → nothing (matches)
--   sheet lower / negative → flagged, nothing saved
--   a customer who also buys boxes or holds two 20 L refs → left for the owner (owner: "always leave them for me"); the
--   owner may type that month's amount in the preview, which bills it.
-- A month is imported again only after the owner undoes it (cancels its month bills, while none has a payment).
-- One widened check and one new check on bills, two columns on jar_imports, one new table. Nothing is deleted.
-- Backward-compatible: v0.67.x code never writes the new values.

-- 1. Bills: 'jar_month' = a 20 L month bill (no lines, no B-number, no Zoho ids); always a customer's, never an order's.
alter table order_capture.bills drop constraint bills_source_check;
alter table order_capture.bills add constraint bills_source_check check (source in ('zoho', 'plantops', 'opening', 'jar_month'));
alter table order_capture.bills add constraint bills_jar_month_customer check (source <> 'jar_month' or (customer_id is not null and order_id is null));

-- 2. An import is the first one (opening balances) or a month update for one month (its first day).
alter table order_capture.jar_imports add column kind text not null default 'opening' check (kind in ('opening', 'month'));
alter table order_capture.jar_imports add column month date check (month is null or extract(day from month) = 1);
alter table order_capture.jar_imports add constraint jar_imports_month check ((kind = 'month') = (month is not null));
create index jar_imports_month_idx on order_capture.jar_imports (tenant_id, month) where kind = 'month';

-- 3. One row per 20 L customer per month update: both numbers as they were and what happened.
create table order_capture.jar_month_lines (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid not null,
  import_id        uuid not null,
  jar_customer_id  uuid not null,
  customer_id      uuid not null,
  source_ref       text not null check (length(source_ref) between 1 and 60),
  sheet_due        numeric(18, 2) not null,
  plantops_due     numeric(18, 2) not null,
  action           text not null check (action in ('billed', 'matches', 'flagged', 'left')),
  -- why it was flagged / left: lower (sheet below PlantOps), negative (sheet below 0), mixed (also buys boxes or shares
  -- the customer with another 20 L ref), typed (billed with the owner's own amount)
  reason           text check (reason is null or reason in ('lower', 'negative', 'mixed', 'typed')),
  billed           numeric(18, 2) check (billed is null or billed > 0),
  bill_id          uuid,
  created_at       timestamptz not null default now(),
  check ((action = 'billed') = (bill_id is not null) and (bill_id is null) = (billed is null)),
  check (action <> 'flagged' or reason in ('lower', 'negative')),
  unique (tenant_id, import_id, jar_customer_id),
  unique (tenant_id, id),
  foreign key (tenant_id, import_id) references order_capture.jar_imports (tenant_id, id),
  foreign key (tenant_id, jar_customer_id) references order_capture.jar_customers (tenant_id, id),
  foreign key (tenant_id, customer_id) references order_capture.customers (tenant_id, id),
  foreign key (tenant_id, bill_id) references order_capture.bills (tenant_id, id)
);
create index jar_month_lines_customer on order_capture.jar_month_lines (tenant_id, jar_customer_id);

-- 4. Row-level security, like every other table.
alter table order_capture.jar_month_lines enable row level security;
alter table order_capture.jar_month_lines force row level security;
create policy tenant_isolation on order_capture.jar_month_lines using (tenant_id = current_setting('app.tenant_id')::uuid) with check (tenant_id = current_setting('app.tenant_id')::uuid);

-- 5. Grants: read + add only (no UPDATE, no DELETE).
grant select, insert on order_capture.jar_month_lines to order_app;
