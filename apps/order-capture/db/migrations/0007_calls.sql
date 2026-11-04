-- Phone calls (owner, 2026-11-04; docs/CALLS_PHASE_PLAN.md "Database"): every ring to the order phone, who attended a
-- number, and the owner's "Not an order number" list. Three new tables, append-only (SELECT + INSERT for order_app,
-- nothing is ever changed or deleted). No existing table changes. Backward-compatible: v0.35.x code ignores them.

-- 1. One row per event the order phone sends. A ring = an 'incoming' row, or a 'missed' row with no ring_id (MacroDroid
--    lost the incoming). A 'missed' with ring_id marks that incoming ring as missed. Never the call audio or contacts.
create table order_capture.call_events (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null,
  key_id      uuid not null,                       -- the ORDER_CALL_KEYS entry that sent it
  phone       text not null check (phone ~ '^([0-9]{1,15}|hidden)$'),  -- 10-digit mobile, landline digits, or hidden
  event       text not null check (event in ('incoming', 'missed')),
  ring_id     uuid,                                -- for 'missed': the incoming ring it marks
  created_at  timestamptz not null default now(),
  unique (tenant_id, id),
  check (ring_id is null or event = 'missed'),
  foreign key (tenant_id, ring_id) references order_capture.call_events (tenant_id, id)
);
create index call_events_by_phone on order_capture.call_events (tenant_id, phone, created_at);
create index call_events_by_time on order_capture.call_events (tenant_id, created_at);

-- 2. Attended: covers that number's events with created_at <= upto. A later ring is waiting again.
create table order_capture.call_attended (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         uuid not null,
  phone             text not null check (phone ~ '^([0-9]{1,15}|hidden)$'),
  upto              timestamptz not null,
  outcome           text not null check (outcome in ('known', 'new_customer', 'wrong_number')),
  customer_id       uuid,                          -- null for a wrong number or a landline / hidden number
  attended_by       uuid not null,
  attended_by_name  text not null,
  created_at        timestamptz not null default now(),
  -- 'known' = a customer, or just Attended for a landline / hidden number (no customer)
  check (outcome <> 'wrong_number' or customer_id is null),
  check (outcome <> 'new_customer' or customer_id is not null),
  foreign key (tenant_id, customer_id) references order_capture.customers (tenant_id, id)
);
create index call_attended_by_phone on order_capture.call_attended (tenant_id, phone, created_at);

-- 3. "Not an order number" (owner only): kept as a history so nothing is deleted. A number is on the list when its
--    newest row is 'add'. Hidden numbers can't be listed.
create table order_capture.ignored_number_changes (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid not null,
  phone            text not null check (phone ~ '^[0-9]{1,15}$'),
  action           text not null check (action in ('add', 'remove')),
  label            text check (label is null or char_length(label) between 1 and 40),
  changed_by       uuid not null,
  changed_by_name  text not null,
  created_at       timestamptz not null default now(),
  check ((action = 'add') = (label is not null))
);
create index ignored_number_changes_by_phone on order_capture.ignored_number_changes (tenant_id, phone, created_at);

-- 4. Row-level security, like every other table.
alter table order_capture.call_events enable row level security;
alter table order_capture.call_events force row level security;
create policy tenant_isolation on order_capture.call_events
  using (tenant_id = current_setting('app.tenant_id')::uuid) with check (tenant_id = current_setting('app.tenant_id')::uuid);
alter table order_capture.call_attended enable row level security;
alter table order_capture.call_attended force row level security;
create policy tenant_isolation on order_capture.call_attended
  using (tenant_id = current_setting('app.tenant_id')::uuid) with check (tenant_id = current_setting('app.tenant_id')::uuid);
alter table order_capture.ignored_number_changes enable row level security;
alter table order_capture.ignored_number_changes force row level security;
create policy tenant_isolation on order_capture.ignored_number_changes
  using (tenant_id = current_setting('app.tenant_id')::uuid) with check (tenant_id = current_setting('app.tenant_id')::uuid);

-- 5. Grants: read + add only (no UPDATE, no DELETE).
grant select, insert on order_capture.call_events, order_capture.call_attended, order_capture.ignored_number_changes to order_app;
