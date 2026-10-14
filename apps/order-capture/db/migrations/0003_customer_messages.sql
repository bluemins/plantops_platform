-- WhatsApp thank-you to the customer when an order is marked delivered (owner, 2026-10-14). Sent through the owner's
-- Twilio account with the plant's own approved template; the "Delivered" panel has a tick box (ticked by default).
-- One row per message: written as 'pending' in the same transaction that marks the order delivered, then 'sent' or
-- 'failed' once Twilio answers. One thank-you per order ever (unique), so Undo + Delivered again never sends twice.
-- order_app may only move the sending columns; nothing is deleted.
create table order_capture.customer_messages (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         uuid not null,
  order_id          uuid not null,
  kind              text not null check (kind in ('delivery_thanks')),
  to_phone          text not null check (to_phone ~ '^[6-9][0-9]{9}$'),
  status            text not null default 'pending' check (status in ('pending', 'sent', 'failed')),
  provider_sid      text check (provider_sid is null or length(provider_sid) <= 64),
  error             text check (error is null or length(error) <= 300),
  attempts          integer not null default 0 check (attempts >= 0),
  requested_by      uuid not null,
  requested_by_name text not null,
  created_at        timestamptz not null default now(),
  sent_at           timestamptz,
  check ((status = 'sent') = (sent_at is not null)),
  unique (tenant_id, order_id, kind),
  foreign key (tenant_id, order_id) references order_capture.orders (tenant_id, id)
);
create index customer_messages_waiting on order_capture.customer_messages (tenant_id, created_at) where status = 'pending';

alter table order_capture.customer_messages enable row level security;
alter table order_capture.customer_messages force row level security;
create policy tenant_isolation on order_capture.customer_messages
  using (tenant_id = current_setting('app.tenant_id')::uuid)
  with check (tenant_id = current_setting('app.tenant_id')::uuid);

-- the daily job lists plants with messages waiting (ids only), then works inside each plant
create function order_capture.message_tenants() returns setof uuid
language sql stable security definer
set search_path = pg_catalog, pg_temp
as $$
  select distinct tenant_id from order_capture.customer_messages where status = 'pending'
$$;
revoke all on function order_capture.message_tenants() from public;
grant execute on function order_capture.message_tenants() to order_app;

grant select, insert on order_capture.customer_messages to order_app;
grant update (status, provider_sid, error, attempts, sent_at) on order_capture.customer_messages to order_app;
