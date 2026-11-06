-- What Zoho said about each linked product at the last "Import Zoho items" (owner, 2026-11-06: "remember my edits so
-- the next import from the same Zoho keeps them"). On the next import a field changes only when Zoho changed it since
-- then; an edit the owner made in PlantOps stays otherwise. The link (Zoho's Item ID) also finds a product whose SKU code
-- the owner changed in PlantOps. One row per linked product; refreshed by each import (UPDATE); never deleted.
create table platform.zoho_item_links (
  tenant_id     uuid not null,
  sku_id        uuid not null,
  zoho_item_id  text not null check (length(zoho_item_id) between 1 and 60),
  zoho_sku      text not null,
  zoho_name     text not null,
  zoho_hsn      text,
  zoho_cost     numeric(12, 2),
  zoho_active   boolean not null,
  imported_at   timestamptz not null default now(),
  imported_by   text not null,
  primary key (tenant_id, sku_id),
  unique (tenant_id, zoho_item_id),
  foreign key (tenant_id, sku_id) references platform.tenant_skus (tenant_id, id)
);
alter table platform.zoho_item_links enable row level security;
alter table platform.zoho_item_links force row level security;
create policy tenant_isolation on platform.zoho_item_links
  using (tenant_id = current_setting('app.tenant_id')::uuid)
  with check (tenant_id = current_setting('app.tenant_id')::uuid);
grant select, insert, update on platform.zoho_item_links to platform_app, platform_super;
