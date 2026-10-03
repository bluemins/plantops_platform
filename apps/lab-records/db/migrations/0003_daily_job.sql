-- Phase 3 step 4: the daily reminder job runs for every plant, but lab_app can only ever see one plant at a
-- time (row-level security). This function, run as the owner, returns ONLY the ids of plants that use Lab
-- Records - no plant data. The job then works on each plant inside its own withTenant() transaction.
create function lab_records.lab_tenants() returns setof uuid
language sql stable security definer
set search_path = pg_catalog, pg_temp
as $$
  select distinct tenant_id from lab_records.parameters
$$;

revoke all on function lab_records.lab_tenants() from public;
grant execute on function lab_records.lab_tenants() to lab_app;
