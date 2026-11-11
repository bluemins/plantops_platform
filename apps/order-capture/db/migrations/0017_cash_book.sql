-- Cash book (petty cash) inside Sales, step C1 (owner, 2026-11-10; docs/CASHBOOK_PHASE_PLAN.md, approved): the plant's
-- expense categories and vehicles, every cash entry (expense, staff cash, money in / out) and each day's close (the cash
-- counted in the box). Cash in hand is never stored as a running figure: expected = the last close's count + entries
-- since. Nothing is deleted; a wrong entry is cancelled with a reason, a wrong close is a new version with a reason.
-- Four new tables + one function; no existing table changes. Backward-compatible: v0.60.x code ignores them.
-- Later steps (van reports, 20 L customers, the Attendance link) add their own tables in later migrations.

-- 1. The plant's own lists: expense categories (Diesel, Meal, ...) and vehicles (Mini, Pickup). Switched off, never deleted.
create table order_capture.expense_categories (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid not null,
  name             text not null check (length(trim(name)) between 1 and 60),
  sort             int not null default 0,
  active           boolean not null default true,
  created_by       uuid not null,
  created_by_name  text not null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (tenant_id, id)
);
create unique index expense_categories_name on order_capture.expense_categories (tenant_id, lower(trim(name)));

create table order_capture.cash_vehicles (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid not null,
  name             text not null check (length(trim(name)) between 1 and 40),
  sort             int not null default 0,
  active           boolean not null default true,
  created_by       uuid not null,
  created_by_name  text not null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (tenant_id, id)
);
create unique index cash_vehicles_name on order_capture.cash_vehicles (tenant_id, lower(trim(name)));

-- 2. Cash entries, numbered C-0001... per plant. cash_date = the day the money went into / out of the box (the cash
--    book's day); work_date = the day it was for ("for 7 Nov" when reported late). Amount always positive; `direction`
--    says in or out. person_* = the staff member for staff cash (a platform user id when known, else a typed name).
create table order_capture.cash_entries (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         uuid not null,
  ref_no            int not null check (ref_no >= 1),
  cash_date         date not null,
  work_date         date not null,
  kind              text not null check (kind in ('expense', 'staff_out', 'staff_in', 'owner_in', 'owner_out', 'bank_deposit', 'other_in', 'other_out')),
  direction         text not null check (direction in ('in', 'out')),
  amount            numeric(14, 2) not null check (amount > 0 and amount <= 10000000),
  category_id       uuid,
  vehicle_id        uuid,
  person_user_id    uuid,
  person_name       text check (person_name is null or length(trim(person_name)) between 1 and 100),
  staff_purpose     text check (staff_purpose is null or staff_purpose in ('advance', 'plant', 'salary')),
  paid_to           text check (paid_to is null or length(paid_to) <= 100),
  note              text check (note is null or length(note) <= 300),
  created_by        uuid not null,
  created_by_name   text not null,
  created_at        timestamptz not null default now(),
  cancelled_at      timestamptz,
  cancelled_by      uuid,
  cancelled_by_name text,
  cancel_reason     text,
  check (work_date <= cash_date and work_date >= cash_date - 31),
  check ((kind in ('expense', 'staff_out', 'owner_out', 'bank_deposit', 'other_out')) = (direction = 'out')),
  check ((kind = 'expense') = (category_id is not null)),
  check ((kind in ('staff_out', 'staff_in')) = (person_name is not null)),
  check ((kind = 'staff_out') = (staff_purpose is not null)),
  check ((cancelled_at is null) = (cancelled_by is null) and (cancelled_by is null) = (cancelled_by_name is null)
         and (cancelled_by_name is null) = (cancel_reason is null)),
  check (cancel_reason is null or length(trim(cancel_reason)) between 3 and 300),
  unique (tenant_id, ref_no),
  unique (tenant_id, id),
  foreign key (tenant_id, category_id) references order_capture.expense_categories (tenant_id, id),
  foreign key (tenant_id, vehicle_id) references order_capture.cash_vehicles (tenant_id, id)
);
create index cash_entries_day on order_capture.cash_entries (tenant_id, cash_date);

-- 3. Closing a day: the cash counted in the box. Version 1 = the close; 2, 3... = corrections (reason required). The
--    plant's first close is its opening balance (`opening`). A difference other than zero needs a reason.
create table order_capture.cash_closes (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid not null,
  cash_date        date not null,
  version          int not null check (version >= 1),
  opening          boolean not null default false,
  counted          numeric(14, 2) not null check (counted >= 0 and counted <= 100000000),
  expected         numeric(14, 2) not null,
  difference       numeric(14, 2) not null,
  reason           text check (reason is null or length(trim(reason)) between 3 and 300),
  created_by       uuid not null,
  created_by_name  text not null,
  created_at       timestamptz not null default now(),
  check (difference = counted - expected),
  check (version = 1 or reason is not null),
  check (difference = 0 or reason is not null or opening),
  check (not opening or (version = 1 and difference = 0)),
  unique (tenant_id, cash_date, version),
  unique (tenant_id, id)
);

-- 4. Row-level security, like every other table.
do $$
declare t text;
begin
  foreach t in array array['expense_categories', 'cash_vehicles', 'cash_entries', 'cash_closes'] loop
    execute format('alter table order_capture.%I enable row level security', t);
    execute format('alter table order_capture.%I force row level security', t);
    execute format('create policy tenant_isolation on order_capture.%I using (tenant_id = current_setting(''app.tenant_id'')::uuid) with check (tenant_id = current_setting(''app.tenant_id'')::uuid)', t);
  end loop;
end $$;

-- 5. The daily job lists plants that have started a cash book (ids only), then works inside each plant.
create function order_capture.cash_tenants() returns setof uuid
language sql stable security definer
set search_path = pg_catalog, pg_temp
as $$
  select distinct tenant_id from order_capture.cash_closes
$$;
revoke all on function order_capture.cash_tenants() from public;
grant execute on function order_capture.cash_tenants() to order_app;

-- 6. Grants: read + add; only these columns may change (no DELETE anywhere).
grant select, insert on order_capture.expense_categories, order_capture.cash_vehicles, order_capture.cash_entries, order_capture.cash_closes to order_app;
-- a category / vehicle is renamed, re-ordered or switched off (owner)
grant update (name, sort, active, updated_at) on order_capture.expense_categories to order_app;
grant update (name, sort, active, updated_at) on order_capture.cash_vehicles to order_app;
-- a cash entry is cancelled (owner, with a reason)
grant update (cancelled_at, cancelled_by, cancelled_by_name, cancel_reason) on order_capture.cash_entries to order_app;
