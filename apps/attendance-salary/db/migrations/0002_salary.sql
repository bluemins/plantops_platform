-- Salary (Attendance & Salary v2). Plan: docs/SALARY_PHASE_PLAN.md ("Database").
-- Five new tables, all append-only: attendance_app may SELECT and INSERT only, never UPDATE or DELETE. Nothing worked
-- out is stored except the frozen figures of a month ticked Paid. Money in whole paise. user ids are plain
-- references to the platform; each row keeps a copy of the name.

-- ---------- salary settings per person; the newest row for a person and from_month wins ----------
create table attendance_salary.salary_settings (
  id                  uuid primary key default gen_random_uuid(),
  tenant_id           uuid not null,
  user_id             uuid not null,
  user_name           text not null check (length(trim(user_name)) between 1 and 100),
  from_month          date not null check (extract(day from from_month) = 1),
  monthly_paise       bigint not null check (monthly_paise > 0 and monthly_paise <= 1000000000),  -- ≤ ₹1 crore
  shift_minutes       int not null check (shift_minutes between 60 and 960 and shift_minutes % 30 = 0),
  paid_leave_halfdays int not null default 4 check (paid_leave_halfdays between 0 and 20),       -- 4 = 2 days
  gets_overtime       boolean not null,
  ot_rate_paise       int check (ot_rate_paise > 0),
  joined_on           date,
  left_on             date,
  reason              text check (reason is null or (length(trim(reason)) >= 3 and length(reason) <= 300)),
  created_by          uuid not null,
  created_by_name     text not null check (length(trim(created_by_name)) between 1 and 100),
  created_at          timestamptz not null default now(),
  check (gets_overtime = (ot_rate_paise is not null)),       -- a rate exactly when overtime is on
  check (left_on is null or joined_on is null or left_on >= joined_on),
  unique (tenant_id, id)
);
create index salary_settings_user_idx on attendance_salary.salary_settings (tenant_id, user_id, from_month);

-- ---------- advances; a correction is a negative entry linked to an earlier one of the same person ----------
create table attendance_salary.salary_advances (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null,
  user_id         uuid not null,
  user_name       text not null check (length(trim(user_name)) between 1 and 100),
  on_date         date not null,
  amount_paise    bigint not null check (amount_paise <> 0 and abs(amount_paise) <= 1000000000),
  note            text check (note is null or length(note) <= 200),
  corrects_id     uuid,
  reason          text check (reason is null or (length(trim(reason)) >= 3 and length(reason) <= 300)),
  created_by      uuid not null,
  created_by_name text not null check (length(trim(created_by_name)) between 1 and 100),
  created_at      timestamptz not null default now(),
  -- an advance: positive, not linked, no reason; a correction: negative, linked, with a reason
  check ((amount_paise > 0 and corrects_id is null and reason is null)
      or (amount_paise < 0 and corrects_id is not null and reason is not null)),
  unique (tenant_id, id),
  unique (tenant_id, user_id, id),
  foreign key (tenant_id, user_id, corrects_id) references attendance_salary.salary_advances (tenant_id, user_id, id)
);
create index salary_advances_user_idx on attendance_salary.salary_advances (tenant_id, user_id, on_date);

-- ---------- "Can see own salary"; the newest row for a person wins, no row = off ----------
create table attendance_salary.salary_visibility (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null,
  user_id         uuid not null,
  user_name       text not null check (length(trim(user_name)) between 1 and 100),
  can_see         boolean not null,
  created_by      uuid not null,
  created_by_name text not null check (length(trim(created_by_name)) between 1 and 100),
  created_at      timestamptz not null default now(),
  unique (tenant_id, id)
);
create index salary_visibility_user_idx on attendance_salary.salary_visibility (tenant_id, user_id, created_at);

-- ---------- a month ticked Paid, with its frozen calculation ----------
create table attendance_salary.salary_payments (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null,
  user_id         uuid not null,
  user_name       text not null check (length(trim(user_name)) between 1 and 100),
  month           date not null check (extract(day from month) = 1),
  paid_on         date not null,
  paid_paise      bigint not null check (paid_paise >= 0),
  remaining_paise bigint not null,
  figures         jsonb not null check (jsonb_typeof(figures) = 'object'),
  note            text check (note is null or length(note) <= 200),
  created_by      uuid not null,
  created_by_name text not null check (length(trim(created_by_name)) between 1 and 100),
  created_at      timestamptz not null default now(),
  check (paid_paise = greatest(remaining_paise, 0)),          -- the remaining, or 0 when it was negative
  unique (tenant_id, id)
);
create index salary_payments_user_idx on attendance_salary.salary_payments (tenant_id, user_id, month);

-- ---------- undoing a payment (once per payment; the payment row stays) ----------
create table attendance_salary.salary_payment_undos (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null,
  payment_id      uuid not null,
  reason          text not null check (length(trim(reason)) >= 3 and length(reason) <= 300),
  created_by      uuid not null,
  created_by_name text not null check (length(trim(created_by_name)) between 1 and 100),
  created_at      timestamptz not null default now(),
  unique (tenant_id, id),
  unique (tenant_id, payment_id),
  foreign key (tenant_id, payment_id) references attendance_salary.salary_payments (tenant_id, id)
);

-- ---------- row-level security on every new table ----------
do $$
declare t text;
begin
  foreach t in array array['salary_settings', 'salary_advances', 'salary_visibility', 'salary_payments',
                           'salary_payment_undos'] loop
    execute format('alter table attendance_salary.%I enable row level security', t);
    execute format('alter table attendance_salary.%I force row level security', t);
    execute format(
      'create policy tenant_isolation on attendance_salary.%I
         using (tenant_id = current_setting(''app.tenant_id'')::uuid)
         with check (tenant_id = current_setting(''app.tenant_id'')::uuid)', t);
  end loop;
end $$;

-- ---------- plants with at least one person on salary (plant ids only), for the month-end review job ----------
create function attendance_salary.salary_tenants() returns setof uuid
language sql stable security definer
set search_path = pg_catalog, pg_temp
as $$
  select distinct tenant_id from attendance_salary.salary_settings
$$;
revoke all on function attendance_salary.salary_tenants() from public;
grant execute on function attendance_salary.salary_tenants() to attendance_app;

-- ---------- permissions for attendance_app: read and add only ----------
grant select, insert on attendance_salary.salary_settings, attendance_salary.salary_advances,
  attendance_salary.salary_visibility, attendance_salary.salary_payments, attendance_salary.salary_payment_undos
  to attendance_app;
