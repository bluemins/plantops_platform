-- Phase 5: Floor Stock - the plant's daily end-of-day count: today's production (finished goods) and the closing
-- stock of every item. Runs as plantops_owner (owns the tables, never used by the app). The app connects as
-- stock_app (scripts/setup-module-db.sh): no BYPASSRLS, never the owner, only this schema.
--
-- * Every table holds tenant_id with ENABLE + FORCE row-level security and one tenant_isolation policy.
-- * Counts are APPEND-ONLY: one count per plant per day; a correction is a new count_versions row with a reason.
--   stock_app has SELECT + INSERT, column UPDATE only where listed, and no DELETE anywhere.
-- * Sections and items are the plant's own list. They are switched off, never deleted, so old counts still show.
-- * sku_id and user ids are plain references to the platform (no cross-schema key).
-- * Sold / used / received and "below limit" are worked out from the counts when a screen opens; never stored.

grant usage on schema floor_stock to stock_app;
revoke all on schema floor_stock from public;

-- ---------- the plant's sections and items ----------
create table floor_stock.sections (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null,
  name            text not null check (length(trim(name)) between 1 and 60),
  -- 'finished': its items are finished goods, entered as today's production AND counted as closing stock
  kind            text not null check (kind in ('finished', 'stock')),
  sort_order      int not null default 0,
  status          text not null default 'active' check (status in ('active', 'off')),
  created_by      uuid not null,
  created_by_name text not null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (tenant_id, id)
);
create unique index sections_name_uq on floor_stock.sections (tenant_id, lower(trim(name)));

create table floor_stock.items (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null,
  section_id      uuid not null,
  name            text not null check (length(trim(name)) between 1 and 80),
  unit            text not null check (length(trim(unit)) between 1 and 20),        -- box, pcs, pkt, bundle ...
  second_unit     text check (second_unit is null or length(trim(second_unit)) between 1 and 20), -- count, damaged
  sku_id          uuid,                                                             -- the platform product, if any
  min_level       numeric(12, 2) check (min_level is null or min_level >= 0),       -- the owner's limit
  sort_order      int not null default 0,
  status          text not null default 'active' check (status in ('active', 'off')),
  created_by      uuid not null,
  created_by_name text not null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (tenant_id, id),
  foreign key (tenant_id, section_id) references floor_stock.sections (tenant_id, id)
);
create unique index items_name_uq on floor_stock.items (section_id, lower(trim(name)));

-- ---------- daily counts (append-only) ----------
create table floor_stock.counts (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null,
  count_date date not null,
  created_at timestamptz not null default now(),
  unique (tenant_id, count_date),
  unique (tenant_id, id)
);

create table floor_stock.count_versions (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null,
  count_id        uuid not null,
  version         int not null check (version >= 1),
  reason          text,
  entered_by      uuid not null,
  entered_by_name text not null,
  entered_at      timestamptz not null default now(),
  check (version = 1 or length(trim(coalesce(reason, ''))) >= 3),   -- a correction says why
  unique (count_id, version),
  unique (tenant_id, id),
  foreign key (tenant_id, count_id) references floor_stock.counts (tenant_id, id)
);

-- One row per line typed. An item may have several stock lines (different remarks / party names).
-- Name and units are copied from the item, so the record reads the same after the item is renamed.
create table floor_stock.count_lines (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null,
  version_id  uuid not null,
  item_id     uuid not null,
  kind        text not null check (kind in ('production', 'stock')),
  line_no     smallint not null check (line_no between 1 and 20),
  item_name   text not null,
  unit        text not null,
  second_unit text,
  qty         numeric(12, 2) not null check (qty >= 0),
  second_qty  numeric(12, 2) check (second_qty is null or second_qty >= 0),
  remark      text check (remark is null or length(remark) <= 120),
  check (kind = 'stock' or second_qty is null),
  unique (version_id, item_id, kind, line_no),
  foreign key (tenant_id, version_id) references floor_stock.count_versions (tenant_id, id),
  foreign key (tenant_id, item_id) references floor_stock.items (tenant_id, id)
);
create index count_lines_item_idx on floor_stock.count_lines (item_id);

-- ---------- low-stock emails (outbox; each item reported once per day per owner) ----------
create table floor_stock.low_stock_alerts (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         uuid not null,
  count_date        date not null,
  item_id           uuid not null,
  item_name         text not null,
  qty               numeric(12, 2) not null,
  min_level         numeric(12, 2) not null,
  recipient_user_id uuid not null,
  recipient_name    text not null,
  email             text,
  status            text not null default 'pending' check (status in ('pending', 'sent', 'failed', 'skipped')),
  error             text,
  created_at        timestamptz not null default now(),
  sent_at           timestamptz,
  unique (tenant_id, count_date, item_id, recipient_user_id),
  foreign key (tenant_id, item_id) references floor_stock.items (tenant_id, id)
);

-- ---------- support views, audit ----------
create table floor_stock.support_views (
  id               bigint generated always as identity primary key,
  tenant_id        uuid not null,
  super_admin_id   uuid not null,
  super_admin_name text not null,
  path             text not null,
  at               timestamptz not null default now()
);

create table floor_stock.audit_log (
  id        bigint generated always as identity primary key,
  tenant_id uuid not null,
  actor     text not null,
  action    text not null,
  target    text,
  details   jsonb not null default '{}',
  at        timestamptz not null default now()
);
create index audit_log_tenant_idx on floor_stock.audit_log (tenant_id, at);

-- ---------- row-level security on every table ----------
do $$
declare t text;
begin
  foreach t in array array['sections', 'items', 'counts', 'count_versions', 'count_lines', 'low_stock_alerts',
                           'support_views', 'audit_log'] loop
    execute format('alter table floor_stock.%I enable row level security', t);
    execute format('alter table floor_stock.%I force row level security', t);
    execute format(
      'create policy tenant_isolation on floor_stock.%I
         using (tenant_id = current_setting(''app.tenant_id'')::uuid)
         with check (tenant_id = current_setting(''app.tenant_id'')::uuid)', t);
  end loop;
end $$;

-- ---------- the daily job lists plants (ids only), then works inside each plant ----------
create function floor_stock.stock_tenants() returns setof uuid
language sql stable security definer
set search_path = pg_catalog, pg_temp
as $$
  select distinct tenant_id from floor_stock.low_stock_alerts where status = 'pending'
$$;
revoke all on function floor_stock.stock_tenants() from public;
grant execute on function floor_stock.stock_tenants() to stock_app;

-- ---------- permissions for stock_app (never DELETE) ----------
grant select, insert on floor_stock.counts, floor_stock.count_versions, floor_stock.count_lines,
  floor_stock.support_views, floor_stock.audit_log to stock_app;
grant select, insert on floor_stock.sections, floor_stock.items, floor_stock.low_stock_alerts to stock_app;
grant update (name, sort_order, status, updated_at) on floor_stock.sections to stock_app;
grant update (section_id, name, unit, second_unit, sku_id, min_level, sort_order, status, updated_at)
  on floor_stock.items to stock_app;
grant update (status, error, sent_at) on floor_stock.low_stock_alerts to stock_app;
