-- Notifications N4 (approved by the owner 2026-10-11).
-- 1. Each person's choice per kind of notification: no row = phone + bell (normal), 'bell' = bell only, 'off' =
--    not at all. Urgent kinds ignore it (checked in the app). Deleting a row = back to normal; it never touches a
--    notification.
create table platform.notification_prefs (
  tenant_id  uuid not null references platform.tenants (id),
  user_id    uuid not null references platform.users (id),
  kind       text not null check (length(kind) between 1 and 60),
  mode       text not null check (mode in ('bell', 'off')),
  updated_at timestamptz not null default now(),
  primary key (tenant_id, user_id, kind)
);
alter table platform.notification_prefs enable row level security;
alter table platform.notification_prefs force row level security;
create policy tenant_isolation on platform.notification_prefs
  using (tenant_id = current_setting('app.tenant_id')::uuid)
  with check (tenant_id = current_setting('app.tenant_id')::uuid);
grant select, insert, delete on platform.notification_prefs to platform_app;
grant update (mode, updated_at) on platform.notification_prefs to platform_app;

-- 2. Notifications older than 90 days are removed by the platform's daily job, only through this function: the
--    app login itself still has no DELETE on notifications. Returns how many rows were removed.
create function platform.purge_old_notifications() returns integer
language sql volatile security definer
set search_path = pg_catalog, pg_temp
as $$
  with gone as (
    delete from platform.notifications where created_at < now() - interval '90 days' returning 1
  )
  select count(*)::int from gone
$$;
revoke all on function platform.purge_old_notifications() from public;
grant execute on function platform.purge_old_notifications() to platform_app;
