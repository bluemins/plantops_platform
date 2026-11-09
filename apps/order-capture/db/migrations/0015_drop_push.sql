-- 0015_drop_push.sql — Drop Phase 6: push notifications to shops' phones (docs/CUSTOMER_APP_PHASE_PLAN.md).
-- DRAFT for the owner's review: not applied anywhere yet.
-- New tables only; no existing table, column or grant changes. Backward-compatible: v0.54.x code ignores them.

-- 1. A phone that may receive pushes: one row per login (app session) and Firebase token. A phone that logs out, is
--    switched off, or that Firebase says is gone (404 / UNREGISTERED) is marked removed, never deleted.
create table order_capture.app_devices (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null,
  session_id     uuid not null references order_capture.app_sessions (id),
  fcm_token      text not null check (length(fcm_token) between 20 and 4096),
  created_at     timestamptz not null default now(),
  removed_at     timestamptz,
  remove_reason  text check (remove_reason in ('logout', 'session_ended', 'unregistered', 'replaced')),
  check ((removed_at is null) = (remove_reason is null))
);
-- one live row per token in a plant (the same phone logging in again replaces its old row)
create unique index app_devices_live_token on order_capture.app_devices (tenant_id, fcm_token) where removed_at is null;
create index app_devices_by_session on order_capture.app_devices (tenant_id, session_id);

-- 2. The push outbox: one row per phone and event, sent after the action's answer or by the push job; retried with a
--    growing wait, given up after 3 days. Never amounts, bills, payments or staff names in title / body.
create table order_capture.app_push_outbox (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null,
  device_id    uuid not null references order_capture.app_devices (id),
  kind         text not null check (kind in ('order_received', 'order_delivered', 'new_poll', 'free_box', 'points_ending')),
  dedupe_key   text not null check (length(dedupe_key) between 1 and 200),
  title        text not null check (length(title) between 1 and 80),
  body         text not null check (length(body) between 1 and 300),
  tab          text not null check (tab in ('home', 'points', 'polls')),
  created_at   timestamptz not null default now(),
  tries        int not null default 0 check (tries between 0 and 50),
  next_try_at  timestamptz not null default now(),
  sent_at      timestamptz,
  gave_up_at   timestamptz,
  last_error   text check (last_error is null or length(last_error) <= 300),
  unique (tenant_id, device_id, dedupe_key)
);
create index app_push_outbox_waiting on order_capture.app_push_outbox (tenant_id, next_try_at)
  where sent_at is null and gave_up_at is null;

-- 3. Row-level security like every other table.
alter table order_capture.app_devices enable row level security;
alter table order_capture.app_devices force row level security;
create policy tenant_isolation on order_capture.app_devices
  using (tenant_id = current_setting('app.tenant_id')::uuid) with check (tenant_id = current_setting('app.tenant_id')::uuid);
alter table order_capture.app_push_outbox enable row level security;
alter table order_capture.app_push_outbox force row level security;
create policy tenant_isolation on order_capture.app_push_outbox
  using (tenant_id = current_setting('app.tenant_id')::uuid) with check (tenant_id = current_setting('app.tenant_id')::uuid);

-- 4. The push job finds plants with pushes waiting (plant ids only), like reminder_tenants().
create function order_capture.app_push_tenants() returns setof uuid
language sql stable security definer
set search_path = pg_catalog, pg_temp
as $$
  select distinct tenant_id from order_capture.app_push_outbox where sent_at is null and gave_up_at is null
$$;
revoke all on function order_capture.app_push_tenants() from public;
grant execute on function order_capture.app_push_tenants() to order_app;

-- 5. Grants: read + add; the only changes are a phone's removal and the outbox's retry columns. No DELETE.
grant select, insert on order_capture.app_devices, order_capture.app_push_outbox to order_app;
grant update (removed_at, remove_reason) on order_capture.app_devices to order_app;
grant update (tries, next_try_at, sent_at, gave_up_at, last_error) on order_capture.app_push_outbox to order_app;
