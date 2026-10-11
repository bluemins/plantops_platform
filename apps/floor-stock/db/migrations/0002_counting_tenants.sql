-- Notifications (approved 2026-10-11): the 8 pm "count not done" reminder must look at every plant that counts,
-- not only plants with emails waiting (stock_tenants()). Like stock_tenants(): plant ids only, nothing else; the
-- job then works inside each plant with row-level security as usual.
create function floor_stock.counting_tenants() returns setof uuid
language sql stable security definer
set search_path = pg_catalog, pg_temp
as $$
  select distinct tenant_id from floor_stock.items where status = 'active'
$$;
revoke all on function floor_stock.counting_tenants() from public;
grant execute on function floor_stock.counting_tenants() to stock_app;
