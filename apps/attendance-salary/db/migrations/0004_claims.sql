-- Claims (Salary extras, Part B). Plan: docs/SALARY_EXTRAS_PHASE_PLAN.md "Database".
-- TA / DA rates on salary_settings, and three new append-only tables: attendance_app may SELECT and INSERT only, never
-- UPDATE or DELETE. A claim's details never change; its status is its newest decision (none = waiting). Money in whole
-- paise; km in tenths. user ids are plain references to the platform; each row keeps a copy of the name.

-- ---------- TA / DA rates per person, from a month (blank = none) ----------
alter table attendance_salary.salary_settings
  add column km_rate_paise int check (km_rate_paise > 0 and km_rate_paise <= 100000),    -- TA per km, ≤ ₹1,000
  add column da_day_paise  int check (da_day_paise > 0 and da_day_paise <= 10000000);    -- DA per day, ≤ ₹1 lakh

-- ---------- one claim: field duty (km + where) or an expense (amount + what for) on one date ----------
create table attendance_salary.salary_claims (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null,
  user_id         uuid not null,
  user_name       text not null check (length(trim(user_name)) between 1 and 100),
  kind            text not null check (kind in ('field_duty', 'expense')),
  on_date         date not null,
  km_tenths       int check (km_tenths between 0 and 99999),                       -- 0-9,999.9 km
  amount_paise    bigint check (amount_paise > 0 and amount_paise <= 100000000),    -- ≤ ₹10 lakh
  note            text not null check (length(trim(note)) between 3 and 200),
  created_by      uuid not null,                     -- ≠ user_id: entered by the owner on the person's behalf
  created_by_name text not null check (length(trim(created_by_name)) between 1 and 100),
  created_at      timestamptz not null default now(),
  check ((kind = 'field_duty' and km_tenths is not null and amount_paise is null)
      or (kind = 'expense' and amount_paise is not null and km_tenths is null)),
  unique (tenant_id, id),
  unique (tenant_id, user_id, id)
);
create index salary_claims_user_idx on attendance_salary.salary_claims (tenant_id, user_id, on_date);

-- ---------- decisions; the newest is the claim's status (none = waiting) ----------
create table attendance_salary.salary_claim_decisions (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null,
  claim_id        uuid not null,
  decision        text not null check (decision in ('approved', 'rejected', 'withdrawn', 'cancelled')),
  reason          text check (reason is null or (length(trim(reason)) >= 3 and length(reason) <= 300)),
  created_by      uuid not null,
  created_by_name text not null check (length(trim(created_by_name)) between 1 and 100),
  created_at      timestamptz not null default now(),
  check ((decision in ('rejected', 'cancelled')) = (reason is not null)),   -- a reason exactly for these two
  unique (tenant_id, id),
  foreign key (tenant_id, claim_id) references attendance_salary.salary_claims (tenant_id, id)
);
-- decided once (approved / not approved / withdrawn), and cancelled once
create unique index salary_claim_decided_once on attendance_salary.salary_claim_decisions (tenant_id, claim_id)
  where decision in ('approved', 'rejected', 'withdrawn');
create unique index salary_claim_cancelled_once on attendance_salary.salary_claim_decisions (tenant_id, claim_id)
  where decision = 'cancelled';
create index salary_claim_decisions_claim_idx on attendance_salary.salary_claim_decisions (tenant_id, claim_id);

-- ---------- bill photos (files on disk / S3; never replaced or deleted) ----------
create table attendance_salary.salary_claim_files (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null,
  claim_id        uuid not null,
  storage_key     text not null unique,
  content_type    text not null check (content_type in ('image/jpeg', 'image/png', 'image/webp')),
  size_bytes      int not null check (size_bytes between 1 and 10485760),             -- 10 MB
  sha256          text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  created_by      uuid not null,
  created_by_name text not null check (length(trim(created_by_name)) between 1 and 100),
  created_at      timestamptz not null default now(),
  unique (tenant_id, id),
  foreign key (tenant_id, claim_id) references attendance_salary.salary_claims (tenant_id, id)
);
create index salary_claim_files_claim_idx on attendance_salary.salary_claim_files (tenant_id, claim_id);

-- ---------- row-level security on every new table ----------
do $$
declare t text;
begin
  foreach t in array array['salary_claims', 'salary_claim_decisions', 'salary_claim_files'] loop
    execute format('alter table attendance_salary.%I enable row level security', t);
    execute format('alter table attendance_salary.%I force row level security', t);
    execute format(
      'create policy tenant_isolation on attendance_salary.%I
         using (tenant_id = current_setting(''app.tenant_id'')::uuid)
         with check (tenant_id = current_setting(''app.tenant_id'')::uuid)', t);
  end loop;
end $$;

-- ---------- permissions for attendance_app: read and add only ----------
grant select, insert on attendance_salary.salary_claims, attendance_salary.salary_claim_decisions,
  attendance_salary.salary_claim_files to attendance_app;
