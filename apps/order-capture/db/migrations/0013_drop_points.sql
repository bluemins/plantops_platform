-- Drop (customer app) Phase 3: points (owner, 2026-11-09; docs/CUSTOMER_APP_PHASE_PLAN.md "Points tab", D8–D10).
-- Two new tables with FORCE RLS: the points settings (a dated history) and the shops' free-box requests. Points
-- earned for purchases are NOT stored: they are worked out from bills and payments when asked, so they can never drift
-- from the ledger. Points stay completely separate from billing (owner): no existing table, column or grant changes,
-- and a free box asked with points is never an order line or on a bill. Backward-compatible: v0.50.x ignores both.

-- 1. Points settings, kept as a history: the newest row whose effective_from has come is the setting in force on a
--    day (a later change of the ₹ per point applies from its own date only). start_date null = points off.
create table order_capture.points_settings (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         uuid not null,
  effective_from    date not null,
  start_date        date,
  rupees_per_point  numeric(8, 2) not null default 20 check (rupees_per_point > 0 and rupees_per_point <= 10000),
  late_days         int not null default 5 check (late_days between 0 and 60),          -- paid within N days of delivery
  poll_points       int not null default 10 check (poll_points between 0 and 1000),
  redeem_months     int[] not null default '{7,8,9,10,11,12,1}'
                    check (cardinality(redeem_months) <= 12 and redeem_months <@ '{1,2,3,4,5,6,7,8,9,10,11,12}'),
  rewards           jsonb not null default '[]' check (jsonb_typeof(rewards) = 'array' and jsonb_array_length(rewards) <= 10),
  changed_by        uuid not null,
  changed_by_name   text not null,
  created_at        timestamptz not null default now()
);
create index points_settings_by_date on order_capture.points_settings (tenant_id, effective_from, created_at);

-- 2. Free boxes asked with points. The state is worked out, not stored: asked (no order yet) -> on an order -> spent
--    when that order is delivered; the points come back when the order is cancelled or staff cancel the request.
--    order_id (when staff add it to an order) and the cancellation are each set once, never changed (trigger below).
create table order_capture.points_redemptions (
  id                 uuid primary key default gen_random_uuid(),
  tenant_id          uuid not null,
  customer_id        uuid not null,
  sku_id             uuid not null,
  label              text not null check (length(trim(label)) between 1 and 100),
  points             int not null check (points > 0 and points <= 1000000),
  year_end           date not null,                       -- the points year it was asked in (ends 31 January)
  asked_by_phone     text not null check (asked_by_phone ~ '^[6-9][0-9]{9}$'),
  request_key        text not null check (request_key ~ '^[A-Za-z0-9_-]{8,64}$'),
  created_at         timestamptz not null default now(),
  order_id           uuid,
  added_by           uuid,
  added_by_name      text,
  added_at           timestamptz,
  cancelled_at       timestamptz,
  cancelled_by       uuid,
  cancelled_by_name  text,
  cancel_reason      text check (cancel_reason is null or length(trim(cancel_reason)) between 3 and 300),
  unique (tenant_id, request_key),
  check ((order_id is null) = (added_at is null) and (added_at is null) = (added_by is null) and (added_by is null) = (added_by_name is null)),
  check ((cancelled_at is null) = (cancelled_by is null) and (cancelled_by is null) = (cancelled_by_name is null)
         and (cancelled_by_name is null) = (cancel_reason is null)),
  foreign key (tenant_id, customer_id) references order_capture.customers (tenant_id, id),
  foreign key (tenant_id, order_id) references order_capture.orders (tenant_id, id)
);
create index points_redemptions_by_customer on order_capture.points_redemptions (tenant_id, customer_id, created_at);
create index points_redemptions_by_order on order_capture.points_redemptions (tenant_id, order_id) where order_id is not null;

create function order_capture.points_redemption_once() returns trigger
language plpgsql as $$
begin
  if (OLD.order_id is not null and NEW.order_id is distinct from OLD.order_id)
     or (OLD.added_at is not null and (NEW.added_at, NEW.added_by, NEW.added_by_name) is distinct from (OLD.added_at, OLD.added_by, OLD.added_by_name)) then
    raise exception 'a free-box request is added to an order only once' using errcode = 'check_violation';
  end if;
  if OLD.cancelled_at is not null and (NEW.cancelled_at, NEW.cancelled_by, NEW.cancelled_by_name, NEW.cancel_reason)
       is distinct from (OLD.cancelled_at, OLD.cancelled_by, OLD.cancelled_by_name, OLD.cancel_reason) then
    raise exception 'a free-box request is cancelled only once' using errcode = 'check_violation';
  end if;
  return NEW;
end
$$;
create trigger points_redemptions_set_once before update on order_capture.points_redemptions
  for each row execute function order_capture.points_redemption_once();

-- 3. Row-level security like every other table; order_app reads and adds rows, and may only fill in the order link
--    and the cancellation of a request. Nothing is deleted.
alter table order_capture.points_settings enable row level security;
alter table order_capture.points_settings force row level security;
create policy tenant_isolation on order_capture.points_settings
  using (tenant_id = current_setting('app.tenant_id')::uuid) with check (tenant_id = current_setting('app.tenant_id')::uuid);
alter table order_capture.points_redemptions enable row level security;
alter table order_capture.points_redemptions force row level security;
create policy tenant_isolation on order_capture.points_redemptions
  using (tenant_id = current_setting('app.tenant_id')::uuid) with check (tenant_id = current_setting('app.tenant_id')::uuid);

grant select, insert on order_capture.points_settings, order_capture.points_redemptions to order_app;
grant update (order_id, added_by, added_by_name, added_at, cancelled_at, cancelled_by, cancelled_by_name, cancel_reason)
  on order_capture.points_redemptions to order_app;
