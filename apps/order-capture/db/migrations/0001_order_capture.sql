-- Order Capture: orders taken by staff on their phones (instead of a WhatsApp message), delivered or cancelled.
-- Plan: docs/ORDER_CAPTURE_PHASE_PLAN.md. Runs as plantops_owner; the app connects as order_app (no BYPASSRLS,
-- never the owner, only this schema).
-- * Every table holds tenant_id with ENABLE + FORCE row-level security and one tenant_isolation policy.
-- * Nothing is ever deleted: order_app has no DELETE anywhere. An order's customer / product copies never change;
--   lines are versioned (a change adds version N+1); history, audit and support views are append-only.
-- * sku_id and user ids are plain references to the platform (no cross-schema key).

grant usage on schema order_capture to order_app;
revoke all on schema order_capture from public;

-- ---------- owner's unit label and default rate per PlantOps product ----------
create table order_capture.product_rates (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null,
  sku_id       uuid not null,
  unit         text not null check (length(trim(unit)) between 1 and 20),
  default_rate numeric(10, 2) check (default_rate is null or default_rate >= 0),   -- blank = typed on each order
  updated_by   uuid not null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (tenant_id, sku_id)
);

-- ---------- customers (one per phone per plant; switched off, never deleted) ----------
create table order_capture.customers (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null,
  name            text not null check (length(trim(name)) between 2 and 100),
  phone_typed     text not null check (length(phone_typed) between 1 and 30),
  phone           text not null check (phone ~ '^[6-9][0-9]{9}$'),    -- normalised Indian mobile
  place           text not null check (length(trim(place)) between 2 and 200),
  active          boolean not null default true,
  created_by      uuid not null,
  created_by_name text not null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (tenant_id, phone),
  unique (tenant_id, id)
);
create index customers_name_idx on order_capture.customers (tenant_id, lower(name));

-- ---------- orders (customer copied in; only status / version / total / delivery fields move) ----------
create table order_capture.orders (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         uuid not null,
  ref_no            int not null check (ref_no >= 1),                     -- shown as O-0001
  request_key       text not null check (length(request_key) between 8 and 64),  -- blocks a double save
  customer_id       uuid not null,
  customer_name     text not null check (length(trim(customer_name)) between 2 and 100),
  customer_phone    text not null check (customer_phone ~ '^[6-9][0-9]{9}$'),
  customer_place    text not null check (length(trim(customer_place)) between 2 and 200),
  status            text not null default 'pending' check (status in ('pending', 'delivered', 'cancelled')),
  version           int not null default 1 check (version >= 1),         -- the current version of the lines
  total             numeric(18, 2) not null check (total >= 0),
  entered_by        uuid not null,
  entered_by_name   text not null,
  created_at        timestamptz not null default now(),
  status_changed_at timestamptz not null default now(),
  delivered_by      uuid,
  delivered_by_name text,
  delivered_at      timestamptz,
  delivery_note     text check (delivery_note is null or length(delivery_note) <= 300),
  invoice_no        text check (invoice_no is null or length(invoice_no) <= 40),
  -- delivered <=> who and when are filled in; note / invoice no. only on a delivered order
  check ((status = 'delivered') = (delivered_at is not null)),
  check ((delivered_at is null) = (delivered_by is null) and (delivered_by is null) = (delivered_by_name is null)),
  check (status = 'delivered' or (delivery_note is null and invoice_no is null)),
  unique (tenant_id, ref_no),
  unique (tenant_id, request_key),
  unique (tenant_id, id),
  foreign key (tenant_id, customer_id) references order_capture.customers (tenant_id, id)
);
create index orders_list_idx on order_capture.orders (tenant_id, status, created_at);
create index orders_customer_idx on order_capture.orders (tenant_id, customer_id, created_at desc);

-- ---------- order lines, one set per version (append-only) ----------
create table order_capture.order_lines (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null,
  order_id     uuid not null,
  version      int not null check (version >= 1),
  line_no      int not null check (line_no between 1 and 50),
  sku_id       uuid not null,
  product_name text not null check (length(trim(product_name)) between 1 and 120),  -- as it was when ordered
  unit         text not null check (length(trim(unit)) between 1 and 20),
  quantity     int not null check (quantity between 1 and 100000),
  rate         numeric(10, 2) not null check (rate >= 0),
  line_total   numeric(18, 2) not null,
  check (line_total = quantity * rate),
  unique (tenant_id, order_id, version, line_no),
  unique (tenant_id, order_id, version, sku_id),          -- each product at most once per order
  foreign key (tenant_id, order_id) references order_capture.orders (tenant_id, id)
);
create index order_lines_idx on order_capture.order_lines (order_id, version);

-- ---------- history: created, changed (new version), delivered, undelivered, cancelled (append-only) ----------
create table order_capture.order_events (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null,
  order_id        uuid not null,
  kind            text not null check (kind in ('created', 'changed', 'delivered', 'undelivered', 'cancelled')),
  version         int not null check (version >= 1),     -- the lines version at this moment
  text            text check (text is null or length(text) <= 300),    -- delivery note or reason
  invoice_no      text check (invoice_no is null or length(invoice_no) <= 40),
  created_by      uuid not null,
  created_by_name text not null,
  created_at      timestamptz not null default now(),
  -- cancelling and undoing "Delivered" need a reason; an invoice no. belongs to a delivery only
  check (kind not in ('cancelled', 'undelivered') or length(trim(coalesce(text, ''))) >= 3),
  check (kind = 'delivered' or invoice_no is null),
  foreign key (tenant_id, order_id) references order_capture.orders (tenant_id, id)
);
create index order_events_idx on order_capture.order_events (order_id, created_at);

-- ---------- support views, audit (rates, customers, uploads, CSV exports) ----------
create table order_capture.support_views (
  id               bigint generated always as identity primary key,
  tenant_id        uuid not null,
  super_admin_id   uuid not null,
  super_admin_name text not null,
  path             text not null,
  at               timestamptz not null default now()
);

create table order_capture.audit_log (
  id        bigint generated always as identity primary key,
  tenant_id uuid not null,
  actor     text not null,
  action    text not null,
  target    text,
  details   jsonb not null default '{}',
  at        timestamptz not null default now()
);
create index audit_log_tenant_idx on order_capture.audit_log (tenant_id, at);

-- ---------- notifications that couldn't reach the platform (N4 outbox, as in the other modules) ----------
create table order_capture.notification_outbox (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null,
  input       jsonb not null,
  attempts    integer not null default 0,
  last_error  text,
  created_at  timestamptz not null default now(),
  sent_at     timestamptz,
  given_up_at timestamptz
);
create index notification_outbox_waiting on order_capture.notification_outbox (tenant_id, created_at)
  where sent_at is null and given_up_at is null;

-- ---------- row-level security on every table ----------
do $$
declare t text;
begin
  foreach t in array array['product_rates', 'customers', 'orders', 'order_lines', 'order_events', 'support_views',
                           'audit_log', 'notification_outbox'] loop
    execute format('alter table order_capture.%I enable row level security', t);
    execute format('alter table order_capture.%I force row level security', t);
    execute format(
      'create policy tenant_isolation on order_capture.%I
         using (tenant_id = current_setting(''app.tenant_id'')::uuid)
         with check (tenant_id = current_setting(''app.tenant_id'')::uuid)', t);
  end loop;
end $$;

-- ---------- the daily job lists plants (ids only), then works inside each plant ----------
create function order_capture.outbox_tenants() returns setof uuid
language sql stable security definer
set search_path = pg_catalog, pg_temp
as $$
  select distinct tenant_id from order_capture.notification_outbox where sent_at is null and given_up_at is null
$$;
revoke all on function order_capture.outbox_tenants() from public;
grant execute on function order_capture.outbox_tenants() to order_app;

-- ---------- permissions for order_app (never DELETE) ----------
grant select, insert on order_capture.product_rates, order_capture.customers, order_capture.orders,
  order_capture.order_lines, order_capture.order_events, order_capture.support_views, order_capture.audit_log,
  order_capture.notification_outbox to order_app;
grant update (unit, default_rate, updated_by, updated_at) on order_capture.product_rates to order_app;
grant update (name, place, active, updated_at) on order_capture.customers to order_app;
grant update (status, version, total, status_changed_at, delivered_by, delivered_by_name, delivered_at,
  delivery_note, invoice_no) on order_capture.orders to order_app;
grant update (attempts, last_error, sent_at, given_up_at) on order_capture.notification_outbox to order_app;
