-- Day marks (v0.26.0; docs/DAY_MARKS_PLAN.md, approved by the owner 2026-10-19): the owner marks one person on one date
-- ON (a full present day) or OFF (a paid day off, not absent, no paid leave used), or Clear (back to the IN / OUT
-- marks). No times, no reason. Append-only: attendance_app may SELECT and INSERT only; the newest row for a person and
-- day wins, so every change stays in the history. user ids are plain references to the platform; names are copied.
create table attendance_salary.day_marks (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null,
  user_id      uuid not null,
  user_name    text not null check (length(trim(user_name)) between 1 and 100),
  day          date not null,
  mark         text not null check (mark in ('on', 'off', 'clear')),
  created_by   uuid not null,
  created_by_name text not null check (length(trim(created_by_name)) between 1 and 100),
  created_at   timestamptz not null default now(),
  unique (tenant_id, id)
);
create index day_marks_user_day_idx on attendance_salary.day_marks (tenant_id, user_id, day, created_at);

alter table attendance_salary.day_marks enable row level security;
alter table attendance_salary.day_marks force row level security;
create policy tenant_isolation on attendance_salary.day_marks
  using (tenant_id = current_setting('app.tenant_id')::uuid)
  with check (tenant_id = current_setting('app.tenant_id')::uuid);

grant select, insert on attendance_salary.day_marks to attendance_app;
