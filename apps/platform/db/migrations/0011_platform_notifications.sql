-- Notifications N3 (approved by the owner 2026-10-11): events from PlantOps itself (a staff member locked out,
-- plan changes, plan renewal coming up) go into the same inbox. They belong to no module, so module_id may be
-- null; their link is a platform path. "nulls not distinct" keeps the once-per-person dedupe for them too
-- (Postgres 15+).
alter table platform.notifications alter column module_id drop not null;
alter table platform.notifications drop constraint notifications_tenant_id_user_id_module_id_dedupe_key_key;
alter table platform.notifications
  add constraint notifications_once unique nulls not distinct (tenant_id, user_id, module_id, dedupe_key);

-- The platform's daily job: plants renewing within the next 30 days (India date). Like resolve_tenant(): only
-- ids and the date, so the job runs on the app login with row-level security and never on the super_admin login.
create function platform.renewal_tenants() returns table (tenant_id uuid, renews_on date)
language sql stable security definer
set search_path = pg_catalog, pg_temp
as $$
  select p.tenant_id, p.renews_on
    from platform.tenant_plans p
    join platform.tenants t on t.id = p.tenant_id
   where t.status = 'active'
     and p.renews_on is not null
     and p.renews_on between (now() at time zone 'Asia/Kolkata')::date
                         and (now() at time zone 'Asia/Kolkata')::date + 30
$$;
revoke all on function platform.renewal_tenants() from public;
grant execute on function platform.renewal_tenants() to platform_app;
