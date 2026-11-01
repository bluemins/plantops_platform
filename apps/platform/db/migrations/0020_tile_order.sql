-- Launcher tile order per person (owner, 2026-11-01): "Arrange tiles" on the launcher saves the order of the tiles
-- this person can open, the same on every phone / PC they log in from. One row per person; no row = the usual order.
-- Modules not in the list (switched on later) follow in the usual order; locked tiles always stay last. A plain
-- display choice: nothing else reads it, and access is still checked by each module.
create table platform.tile_order (
  tenant_id  uuid not null,
  user_id    uuid not null,
  modules    text[] not null check (cardinality(modules) between 1 and 20),
  updated_at timestamptz not null default now(),
  primary key (tenant_id, user_id),
  foreign key (tenant_id, user_id) references platform.users (tenant_id, id)
);
alter table platform.tile_order enable row level security;
alter table platform.tile_order force row level security;
create policy tenant_isolation on platform.tile_order
  using (tenant_id = current_setting('app.tenant_id')::uuid)
  with check (tenant_id = current_setting('app.tenant_id')::uuid);
-- delete = "Back to the usual order"
grant select, insert, delete on platform.tile_order to platform_app;
grant update (modules, updated_at) on platform.tile_order to platform_app;
