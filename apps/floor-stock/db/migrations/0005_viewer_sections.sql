-- Stock viewer (owner, 2026-10-19; docs/VIEW_ROLES_PHASE_PLAN.md): a platform role that opens Floor Stock read-only.
-- The owner picks, per viewer, which sections they see; everything they see (day page, item history, "Can make",
-- their alerts) is limited to those sections. A Stock viewer with no section switched on sees no stock.
--
-- * New table only: no existing table is altered.
-- * tenant_id with ENABLE + FORCE row-level security and the usual tenant_isolation policy.
-- * Nothing is deleted: stock_app has no DELETE; a section taken away is switched off (status 'off').
-- * Owner-only editing is checked by the app (src/server/viewers.ts): the database can't tell owner from store keeper.
-- * user_id is the PlantOps user (a plain reference, no cross-database foreign key); the platform re-checks the role.
create table floor_stock.viewer_sections (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null,
  user_id         uuid not null,
  section_id      uuid not null,
  status          text not null default 'on' check (status in ('on', 'off')),
  changed_by      uuid not null,
  changed_by_name text not null,
  changed_at      timestamptz not null default now(),
  unique (tenant_id, user_id, section_id),
  foreign key (tenant_id, section_id) references floor_stock.sections (tenant_id, id)
);

alter table floor_stock.viewer_sections enable row level security;
alter table floor_stock.viewer_sections force row level security;
create policy tenant_isolation on floor_stock.viewer_sections
  using (tenant_id = current_setting('app.tenant_id')::uuid)
  with check (tenant_id = current_setting('app.tenant_id')::uuid);

-- ---------- permissions for stock_app (never DELETE) ----------
grant select, insert on floor_stock.viewer_sections to stock_app;
grant update (status, changed_by, changed_by_name, changed_at) on floor_stock.viewer_sections to stock_app;
