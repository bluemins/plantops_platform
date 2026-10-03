-- Business details for each plant (logo, brand color, description, location, phone) and its product list
-- (SKUs). The plant owner edits these; super_admin can too. Plant code and usernames stay super_admin-only.

-- ---------- business profile (one row per plant, created on first save) ----------
create table platform.tenant_profiles (
  tenant_id       uuid primary key references platform.tenants (id),
  logo            bytea check (octet_length(logo) <= 307200),
  logo_type       text check (logo_type in ('image/png', 'image/jpeg', 'image/webp')),
  logo_updated_at timestamptz,
  brand_color     text check (brand_color ~ '^#[0-9a-f]{6}$'),
  description     text check (char_length(description) <= 500),
  address         text check (char_length(address) <= 200),
  city            text check (char_length(city) <= 80),
  state           text check (char_length(state) <= 80),
  pincode         text check (pincode ~ '^[0-9]{6}$'),
  phone           text check (phone ~ '^\+?[0-9][0-9 -]{6,18}$'),
  updated_at      timestamptz not null default now(),
  updated_by      text not null,
  check ((logo is null) = (logo_type is null))
);

-- ---------- products (SKUs). Made inactive, never deleted: other modules will refer to them. ----------
create table platform.tenant_skus (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null references platform.tenants (id),
  name       text not null check (char_length(name) between 1 and 80),
  sku_code   text check (sku_code ~ '^[A-Z0-9._/-]{1,40}$'),
  volume_ml  int not null check (volume_ml between 1 and 100000),
  pack_type  text not null check (pack_type in ('bottle', 'jar', 'pouch', 'cup', 'case', 'other')),
  status     text not null default 'active' check (status in ('active', 'inactive')),
  created_at timestamptz not null default now(),
  created_by text not null,
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  unique (tenant_id, sku_code)
);

-- ---------- row-level security (same pattern as every other plant table) ----------
do $$
declare t text;
begin
  foreach t in array array['tenant_profiles', 'tenant_skus'] loop
    execute format('alter table platform.%I enable row level security', t);
    execute format('alter table platform.%I force row level security', t);
    execute format(
      'create policy tenant_isolation on platform.%I
         using (tenant_id = current_setting(''app.tenant_id'')::uuid)
         with check (tenant_id = current_setting(''app.tenant_id'')::uuid)', t);
  end loop;
end $$;

-- ---------- permissions (no DELETE for anyone) ----------
grant select, insert, update on platform.tenant_profiles, platform.tenant_skus to platform_app, platform_super;
-- The owner may rename the plant, but never change its code, status or hosting.
grant update (name, updated_at) on platform.tenants to platform_app;
