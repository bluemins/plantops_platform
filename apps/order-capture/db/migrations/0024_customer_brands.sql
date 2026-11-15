-- Brands a customer buys (owner, 2026-11-15; approved with the mock-up): New order and Change order list only these
-- brands' products for the customer, with "Show all brands" for a one-off. Kept as a history like app_access_changes:
-- the newest row per customer is the current setting; an empty list (or no row) = every brand. '' in the list = the
-- products with no brand on Rates ("Other"). One new table with FORCE RLS; order_app SELECT + INSERT only, nothing is
-- ever changed or deleted. No existing table, column or grant changes; older code ignores the table.
create table order_capture.customer_brand_changes (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid not null,
  customer_id      uuid not null,
  brands           text[] not null default '{}' check (cardinality(brands) <= 30),
  changed_by       uuid not null,
  changed_by_name  text not null,
  created_at       timestamptz not null default now(),
  foreign key (tenant_id, customer_id) references order_capture.customers (tenant_id, id)
);
create index customer_brand_changes_by_customer on order_capture.customer_brand_changes (tenant_id, customer_id, created_at);

alter table order_capture.customer_brand_changes enable row level security;
alter table order_capture.customer_brand_changes force row level security;
create policy tenant_isolation on order_capture.customer_brand_changes
  using (tenant_id = current_setting('app.tenant_id')::uuid) with check (tenant_id = current_setting('app.tenant_id')::uuid);

grant select, insert on order_capture.customer_brand_changes to order_app;
