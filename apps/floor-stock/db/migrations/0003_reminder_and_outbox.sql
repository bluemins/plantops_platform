-- Notifications N4, part 1: the retry outbox (approved by the owner 2026-10-11): an app notification that couldn't reach the platform
-- (unreachable, too slow, 5xx) waits here and the daily / evening jobs send it again (kit.retryOutbox in
-- packages/module-kit). Only failures are stored, so the table stays small; rows are never deleted.
create table floor_stock.notification_outbox (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null,
  input       jsonb not null,
  attempts    integer not null default 0,
  last_error  text,
  created_at  timestamptz not null default now(),
  sent_at     timestamptz,
  given_up_at timestamptz
);
create index notification_outbox_waiting on floor_stock.notification_outbox (tenant_id, created_at)
  where sent_at is null and given_up_at is null;

alter table floor_stock.notification_outbox enable row level security;
alter table floor_stock.notification_outbox force row level security;
create policy tenant_isolation on floor_stock.notification_outbox
  using (tenant_id = current_setting('app.tenant_id')::uuid)
  with check (tenant_id = current_setting('app.tenant_id')::uuid);

grant select, insert on floor_stock.notification_outbox to stock_app;
grant update (attempts, last_error, sent_at, given_up_at) on floor_stock.notification_outbox to stock_app;

-- the retry job lists plants with waiting notifications (ids only), then works inside each plant as usual
create function floor_stock.outbox_tenants() returns setof uuid
language sql stable security definer
set search_path = pg_catalog, pg_temp
as $$
  select distinct tenant_id from floor_stock.notification_outbox where sent_at is null and given_up_at is null
$$;
revoke all on function floor_stock.outbox_tenants() from public;
grant execute on function floor_stock.outbox_tenants() to stock_app;

-- The owner's choice of when the "Today's stock count is not done yet" reminder goes out (N4): a whole hour from
-- 17:00 to 23:00 India time, or 'off'. No row = 20:00 (the default since N1).
create table floor_stock.plant_settings (
  tenant_id       uuid primary key,
  count_reminder  text not null default '20:00'
                  check (count_reminder in ('17:00','18:00','19:00','20:00','21:00','22:00','23:00','off')),
  updated_by      uuid not null,
  updated_by_name text not null,
  updated_at      timestamptz not null default now()
);
alter table floor_stock.plant_settings enable row level security;
alter table floor_stock.plant_settings force row level security;
create policy tenant_isolation on floor_stock.plant_settings
  using (tenant_id = current_setting('app.tenant_id')::uuid)
  with check (tenant_id = current_setting('app.tenant_id')::uuid);
grant select, insert on floor_stock.plant_settings to stock_app;
grant update (count_reminder, updated_by, updated_by_name, updated_at) on floor_stock.plant_settings to stock_app;
