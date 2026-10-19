-- Error log (STABILITY_PLAN B-09, option B, approved by the owner 2026-10-19): server errors of the platform and
-- every module, for super_admin only (/super/errors). Plants never see it.
-- Stored: when, which app, method + path (no query string), what kind of request, the error message (≤ 500), the
-- first lines of the code trace (≤ 2000), and which plant / user hit it. Never form contents, cookies, phones, money.
create table platform.error_log (
  id        bigint generated always as identity primary key,
  at        timestamptz not null default now(),
  app       text not null check (app ~ '^[a-z_]{1,40}$'),
  method    text not null check (method ~ '^[A-Z]{1,10}$'),
  path      text not null check (length(path) between 1 and 300),
  kind      text not null check (kind in ('api', 'page', 'action', 'proxy')),
  message   text not null check (length(message) between 1 and 500),
  stack     text check (length(stack) <= 2000),
  tenant_id uuid references platform.tenants (id),
  user_id   uuid
);
create index error_log_at on platform.error_log (at);

-- Plant logins never read or write it: FORCE RLS with a policy that matches no row. super_admin reads it through
-- platform_super (BYPASSRLS, SELECT only).
alter table platform.error_log enable row level security;
alter table platform.error_log force row level security;
create policy no_plant_access on platform.error_log using (false) with check (false);
grant select on platform.error_log to platform_super;

-- Writing goes only through this function (the platform's own errors, and those modules send to
-- POST /api/m/errors). At most 20 rows per app per minute, so an error in a loop can't fill the database.
-- Returns true when the row was kept.
create function platform.log_error(
  p_app text, p_method text, p_path text, p_kind text, p_message text, p_stack text, p_tenant_id uuid, p_user_id uuid
) returns boolean
language plpgsql volatile security definer
set search_path = pg_catalog, pg_temp
as $$
begin
  if (select count(*) from platform.error_log where app = p_app and at > now() - interval '1 minute') >= 20 then
    return false;
  end if;
  insert into platform.error_log (app, method, path, kind, message, stack, tenant_id, user_id)
  values (p_app, p_method, p_path, p_kind, p_message, p_stack,
          (select id from platform.tenants where id = p_tenant_id), p_user_id);
  return true;
end
$$;
revoke all on function platform.log_error(text, text, text, text, text, text, uuid, uuid) from public;
grant execute on function platform.log_error(text, text, text, text, text, text, uuid, uuid) to platform_app;

-- Rows older than 30 days are removed by the platform's daily job, through this function only.
create function platform.purge_old_errors() returns integer
language sql volatile security definer
set search_path = pg_catalog, pg_temp
as $$
  with gone as (
    delete from platform.error_log where at < now() - interval '30 days' returning 1
  )
  select count(*)::int from gone
$$;
revoke all on function platform.purge_old_errors() from public;
grant execute on function platform.purge_old_errors() to platform_app;
