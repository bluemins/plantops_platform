-- Attendance & Salary v1 (attendance only): IN / OUT marks by QR scan + location check, owner fixes.
-- Plan: docs/ATTENDANCE_PHASE_PLAN.md. Runs as plantops_owner; the app connects as attendance_app (no BYPASSRLS,
-- never the owner, only this schema).
-- * Every table holds tenant_id with ENABLE + FORCE row-level security and one tenant_isolation policy.
-- * Nothing is ever deleted: attendance_app has no DELETE anywhere. A mark never changes; a fix is a new owner mark
--   and / or a cancel (once per mark). Audit and support views are append-only.
-- * A scan stores the distance and the phone's accuracy, NEVER its coordinates. Only the plant's own point is stored.
-- * user ids are plain references to the platform (no cross-schema key); each mark keeps a copy of the name.

grant usage on schema attendance_salary to attendance_app;
revoke all on schema attendance_salary from public;

-- ---------- one row per plant: location, circle, QR key (hash only) ----------
create table attendance_salary.plant_settings (
  tenant_id       uuid primary key,
  lat             numeric(9, 6) check (lat between -90 and 90),
  lng             numeric(9, 6) check (lng between -180 and 180),
  radius_m        int not null default 200 check (radius_m between 50 and 2000),
  qr_key_hash     text check (qr_key_hash ~ '^[0-9a-f]{64}$'),           -- sha-256 of the key on the printed QR
  qr_made_at      timestamptz,
  updated_by      uuid not null,
  updated_by_name text not null check (length(trim(updated_by_name)) between 1 and 100),
  updated_at      timestamptz not null default now(),
  check ((lat is null) = (lng is null)),
  check ((qr_key_hash is null) = (qr_made_at is null))
);

-- ---------- marks: IN / OUT by scan or added by the owner (never changed) ----------
create table attendance_salary.punches (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null,
  user_id         uuid not null,                                         -- the worker
  user_name       text not null check (length(trim(user_name)) between 1 and 100),
  kind            text not null check (kind in ('in', 'out')),
  at              timestamptz not null,                                  -- the server's time (or the owner's fix)
  source          text not null check (source in ('scan', 'owner')),
  distance_m      int check (distance_m between 0 and 20000000),
  accuracy_m      int check (accuracy_m between 0 and 100000),
  reason          text check (reason is null or length(reason) <= 300),
  created_by      uuid not null,
  created_by_name text not null check (length(trim(created_by_name)) between 1 and 100),
  created_at      timestamptz not null default now(),
  -- a scan: by the worker, with distance and accuracy, no reason; an owner mark: a reason, no distance
  check (source <> 'scan' or (distance_m is not null and accuracy_m is not null and reason is null and created_by = user_id)),
  check (source <> 'owner' or (length(trim(coalesce(reason, ''))) >= 3 and distance_m is null and accuracy_m is null)),
  unique (tenant_id, id)
);
create index punches_user_idx on attendance_salary.punches (tenant_id, user_id, at);
create index punches_day_idx on attendance_salary.punches (tenant_id, at);

-- ---------- the owner cancels a mark (once per mark; the mark stays, crossed out) ----------
create table attendance_salary.punch_cancels (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null,
  punch_id        uuid not null,
  reason          text not null check (length(trim(reason)) >= 3 and length(reason) <= 300),
  created_by      uuid not null,
  created_by_name text not null check (length(trim(created_by_name)) between 1 and 100),
  created_at      timestamptz not null default now(),
  unique (tenant_id, punch_id),
  foreign key (tenant_id, punch_id) references attendance_salary.punches (tenant_id, id)
);

-- ---------- support views, audit (settings, new QR, fixes, CSV exports) ----------
create table attendance_salary.support_views (
  id               bigint generated always as identity primary key,
  tenant_id        uuid not null,
  super_admin_id   uuid not null,
  super_admin_name text not null,
  path             text not null,
  at               timestamptz not null default now()
);

create table attendance_salary.audit_log (
  id        bigint generated always as identity primary key,
  tenant_id uuid not null,
  actor     text not null,
  action    text not null,
  target    text,
  details   jsonb not null default '{}',
  at        timestamptz not null default now()
);
create index audit_log_tenant_idx on attendance_salary.audit_log (tenant_id, at);

-- ---------- notifications that couldn't reach the platform (N4 outbox, as in the other modules) ----------
create table attendance_salary.notification_outbox (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null,
  input       jsonb not null,
  attempts    integer not null default 0,
  last_error  text,
  created_at  timestamptz not null default now(),
  sent_at     timestamptz,
  given_up_at timestamptz
);
create index notification_outbox_waiting on attendance_salary.notification_outbox (tenant_id, created_at)
  where sent_at is null and given_up_at is null;

-- ---------- row-level security on every table ----------
do $$
declare t text;
begin
  foreach t in array array['plant_settings', 'punches', 'punch_cancels', 'support_views', 'audit_log',
                           'notification_outbox'] loop
    execute format('alter table attendance_salary.%I enable row level security', t);
    execute format('alter table attendance_salary.%I force row level security', t);
    execute format(
      'create policy tenant_isolation on attendance_salary.%I
         using (tenant_id = current_setting(''app.tenant_id'')::uuid)
         with check (tenant_id = current_setting(''app.tenant_id'')::uuid)', t);
  end loop;
end $$;

-- ---------- the daily job lists plants (ids only), then works inside each plant ----------
create function attendance_salary.outbox_tenants() returns setof uuid
language sql stable security definer
set search_path = pg_catalog, pg_temp
as $$
  select distinct tenant_id from attendance_salary.notification_outbox where sent_at is null and given_up_at is null
$$;
revoke all on function attendance_salary.outbox_tenants() from public;
grant execute on function attendance_salary.outbox_tenants() to attendance_app;

-- plants with a mark in the last 3 days (the morning "no exit" job looks at yesterday)
create function attendance_salary.attendance_tenants() returns setof uuid
language sql stable security definer
set search_path = pg_catalog, pg_temp
as $$
  select distinct tenant_id from attendance_salary.punches where at > now() - interval '3 days'
$$;
revoke all on function attendance_salary.attendance_tenants() from public;
grant execute on function attendance_salary.attendance_tenants() to attendance_app;

-- ---------- permissions for attendance_app (never DELETE) ----------
grant select, insert on attendance_salary.plant_settings, attendance_salary.punches, attendance_salary.punch_cancels,
  attendance_salary.support_views, attendance_salary.audit_log, attendance_salary.notification_outbox to attendance_app;
grant update (lat, lng, radius_m, qr_key_hash, qr_made_at, updated_by, updated_by_name, updated_at)
  on attendance_salary.plant_settings to attendance_app;
grant update (attempts, last_error, sent_at, given_up_at) on attendance_salary.notification_outbox to attendance_app;
