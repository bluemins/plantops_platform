-- Field day log (Attendance & Salary, v0.73.0). Plan: docs/FIELD_DAY_PHASE_PLAN.md "Database" (approved by the owner
-- 2026-11-15, with the photo pointed to by its start / end row and corrections pointing to the row they replace).
-- Field staff record their day: start (location, place, meter km + photo), each shop visited (location, customer from
-- Sales or a typed shop, meeting notes), end (location, place, km + photo). Documentation only: nothing here is
-- counted in claims or pay. Append-only: attendance_app may SELECT and INSERT only. user and customer ids are plain
-- references (platform / Sales); names are copied.

-- ---------- meter photos (files on disk / S3; never replaced or deleted) ----------
create table attendance_salary.field_event_files (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null,
  user_id         uuid not null,                       -- whose field day it is for
  storage_key     text not null unique,
  content_type    text not null check (content_type in ('image/jpeg', 'image/png', 'image/webp')),
  size_bytes      int not null check (size_bytes between 1 and 10485760),
  sha256          text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  created_by      uuid not null,
  created_by_name text not null check (length(trim(created_by_name)) between 1 and 100),
  created_at      timestamptz not null default now(),
  unique (tenant_id, id)
);

-- ---------- one moment of a field day: start, a shop visited, or end ----------
create table attendance_salary.field_events (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null,
  user_id         uuid not null,
  user_name       text not null check (length(trim(user_name)) between 1 and 100),
  on_date         date not null,                       -- India date of the day's start
  kind            text not null check (kind in ('start', 'visit', 'end')),
  lat             numeric(9,6) check (lat between -90 and 90),
  lng             numeric(9,6) check (lng between -180 and 180),
  accuracy_m      int check (accuracy_m between 0 and 100000),
  place_text      text check (place_text is null or length(trim(place_text)) between 1 and 100),
  km_tenths       int check (km_tenths between 0 and 99999999),          -- 0-9,999,999.9 km
  photo_file_id   uuid,
  corrects_id     uuid,                                -- a correction: the start / end row it replaces
  reason          text check (reason is null or (length(trim(reason)) >= 3 and length(reason) <= 300)),
  customer_id     uuid,                                -- Sales customer (plain reference)
  customer_name   text check (customer_name is null or length(trim(customer_name)) between 1 and 100),
  customer_place  text check (customer_place is null or length(trim(customer_place)) between 1 and 100),
  customer_phone  text check (customer_phone is null or customer_phone ~ '^[6-9][0-9]{9}$'),  -- typed shop only
  save_location   boolean,                             -- visit: "Save this location as the shop's location" ticked
  note            text check (note is null or length(trim(note)) between 1 and 300),          -- meeting notes
  created_by      uuid not null,
  created_by_name text not null check (length(trim(created_by_name)) between 1 and 100),
  created_at      timestamptz not null default now(),
  -- start / end: km and a photo; a visit: neither
  check ((kind in ('start', 'end')) = (km_tenths is not null)),
  check ((kind in ('start', 'end')) = (photo_file_id is not null)),
  -- a visit names a shop; customer fields only on visits; a phone only for a typed shop; the tick only for a customer
  check ((kind = 'visit') = (customer_name is not null)),
  check (kind = 'visit' or (customer_id is null and customer_place is null and customer_phone is null and save_location is null and note is null)),
  check (customer_phone is null or customer_id is null),
  check (save_location is null or customer_id is not null),
  -- location: lat, lng and accuracy all or none
  check ((lat is null) = (lng is null) and (lat is null) = (accuracy_m is null)),
  -- corrections: start / end only, with a reason exactly then
  check (corrects_id is null or kind in ('start', 'end')),
  check ((corrects_id is not null) = (reason is not null)),
  unique (tenant_id, id),
  foreign key (tenant_id, photo_file_id) references attendance_salary.field_event_files (tenant_id, id),
  foreign key (tenant_id, corrects_id) references attendance_salary.field_events (tenant_id, id)
);
create index field_events_user_day_idx on attendance_salary.field_events (tenant_id, user_id, on_date, created_at);
create index field_events_day_idx on attendance_salary.field_events (tenant_id, on_date);

-- ---------- a visit removed, with a reason; once per visit ----------
create table attendance_salary.field_event_cancels (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null,
  event_id        uuid not null,
  reason          text not null check (length(trim(reason)) >= 3 and length(reason) <= 300),
  created_by      uuid not null,
  created_by_name text not null check (length(trim(created_by_name)) between 1 and 100),
  created_at      timestamptz not null default now(),
  unique (tenant_id, event_id),
  foreign key (tenant_id, event_id) references attendance_salary.field_events (tenant_id, id)
);

-- ---------- row-level security on every new table ----------
do $$
declare t text;
begin
  foreach t in array array['field_event_files', 'field_events', 'field_event_cancels'] loop
    execute format('alter table attendance_salary.%I enable row level security', t);
    execute format('alter table attendance_salary.%I force row level security', t);
    execute format(
      'create policy tenant_isolation on attendance_salary.%I
         using (tenant_id = current_setting(''app.tenant_id'')::uuid)
         with check (tenant_id = current_setting(''app.tenant_id'')::uuid)', t);
  end loop;
end $$;

-- ---------- permissions for attendance_app: read and add only ----------
grant select, insert on attendance_salary.field_event_files, attendance_salary.field_events,
  attendance_salary.field_event_cancels to attendance_app;
