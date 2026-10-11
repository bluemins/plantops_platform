-- "Can make" (approved by the owner 2026-10-11, docs/FLOOR_STOCK_CAN_MAKE_PLAN.md): how many boxes of each finished
-- product today's stock is enough for. The owner says what 1 counted unit of a material holds ("1 packet of
-- Preform 18.5 g = 25,000 g") and what 1 bottle of a product needs ("18.5 g preform + 1 cap + 1 label").
--
-- * New tables only: no existing table is altered (items, counts and their permissions stay as they are).
-- * Each table holds tenant_id with ENABLE + FORCE row-level security and the usual tenant_isolation policy.
-- * Nothing is deleted: stock_app has no DELETE; a recipe line taken out is switched off.
-- * "Can make" itself is worked out when a screen opens and never stored.
-- * Owner-only editing is checked by the app (src/server/recipes.ts): the database can't tell owner from store keeper.

-- What 1 counted unit of a stock item holds. No row = the item's unit already is single pieces.
create table floor_stock.material_contents (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid not null,
  item_id          uuid not null,
  content_qty      numeric(12, 2) not null check (content_qty > 0),
  content_measure  text not null check (content_measure in ('pcs', 'g', 'kg', 'ml', 'L', 'm')),
  -- the item's second number (labels: bundle + count) is loose pieces, added to the total
  second_is_pieces boolean not null default false,
  -- taken off the stock before working it out (0.01 = 0.01 %)
  damage_pct       numeric(6, 4) not null default 0 check (damage_pct >= 0 and damage_pct < 100),
  updated_by       uuid not null,
  updated_by_name  text not null,
  updated_at       timestamptz not null default now(),
  unique (tenant_id, item_id),
  foreign key (tenant_id, item_id) references floor_stock.items (tenant_id, id)
);

-- One recipe per finished product. Bottles per box come from the linked PlantOps product; case_size is used only
-- for an item without a product link.
create table floor_stock.recipes (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null,
  product_item_id uuid not null,
  case_size       int check (case_size is null or case_size > 0),
  status          text not null default 'active' check (status in ('active', 'off')),
  created_by      uuid not null,
  created_by_name text not null,
  created_at      timestamptz not null default now(),
  updated_by      uuid not null,
  updated_by_name text not null,
  updated_at      timestamptz not null default now(),
  unique (tenant_id, product_item_id),
  unique (tenant_id, id),
  foreign key (tenant_id, product_item_id) references floor_stock.items (tenant_id, id)
);

-- What 1 bottle (1 piece of the product) needs of one material.
create table floor_stock.recipe_lines (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid not null,
  recipe_id        uuid not null,
  material_item_id uuid not null,
  qty              numeric(12, 2) not null check (qty > 0),
  measure          text not null check (measure in ('pcs', 'g', 'kg', 'ml', 'L', 'm')),
  status           text not null default 'active' check (status in ('active', 'off')),
  created_by       uuid not null,
  created_by_name  text not null,
  created_at       timestamptz not null default now(),
  updated_by       uuid not null,
  updated_by_name  text not null,
  updated_at       timestamptz not null default now(),
  unique (recipe_id, material_item_id),
  foreign key (tenant_id, recipe_id) references floor_stock.recipes (tenant_id, id),
  foreign key (tenant_id, material_item_id) references floor_stock.items (tenant_id, id)
);
create index recipe_lines_material_idx on floor_stock.recipe_lines (material_item_id);

-- ---------- row-level security ----------
do $$
declare t text;
begin
  foreach t in array array['material_contents', 'recipes', 'recipe_lines'] loop
    execute format('alter table floor_stock.%I enable row level security', t);
    execute format('alter table floor_stock.%I force row level security', t);
    execute format(
      'create policy tenant_isolation on floor_stock.%I
         using (tenant_id = current_setting(''app.tenant_id'')::uuid)
         with check (tenant_id = current_setting(''app.tenant_id'')::uuid)', t);
  end loop;
end $$;

-- ---------- permissions for stock_app (never DELETE) ----------
grant select, insert on floor_stock.material_contents, floor_stock.recipes, floor_stock.recipe_lines to stock_app;
grant update (content_qty, content_measure, second_is_pieces, damage_pct, updated_by, updated_by_name, updated_at)
  on floor_stock.material_contents to stock_app;
grant update (case_size, status, updated_by, updated_by_name, updated_at) on floor_stock.recipes to stock_app;
grant update (qty, measure, status, updated_by, updated_by_name, updated_at) on floor_stock.recipe_lines to stock_app;
