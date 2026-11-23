-- Promise to pay (owner, 2026-11-23): Accounts notes when a customer said they will pay, on the Accounts desk.
-- A follow-up record only: it never changes a bill, a payment or what is due. Append-only: a new date is a new row and
-- the old one stays. Whether a promise was kept is worked out from payments, never stored.
-- One new table; order_app gets SELECT + INSERT only. Older code ignores it.
create table order_capture.payment_promises (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null,
  customer_id     uuid,
  zoho_contact_id uuid,
  promised_on     date not null,
  amount          numeric(14, 2) check (amount is null or amount > 0),
  note            text check (note is null or length(trim(note)) between 1 and 200),
  created_by      uuid not null,
  created_by_name text not null check (length(trim(created_by_name)) between 1 and 100),
  created_at      timestamptz not null default now(),
  unique (tenant_id, id),
  check ((customer_id is null) <> (zoho_contact_id is null)),
  foreign key (tenant_id, customer_id) references order_capture.customers (tenant_id, id),
  foreign key (tenant_id, zoho_contact_id) references order_capture.zoho_contacts (tenant_id, id)
);
create index payment_promises_tenant on order_capture.payment_promises (tenant_id, created_at);

alter table order_capture.payment_promises enable row level security;
alter table order_capture.payment_promises force row level security;
create policy tenant_isolation on order_capture.payment_promises
  using (tenant_id = current_setting('app.tenant_id')::uuid)
  with check (tenant_id = current_setting('app.tenant_id')::uuid);

grant select, insert on order_capture.payment_promises to order_app;
