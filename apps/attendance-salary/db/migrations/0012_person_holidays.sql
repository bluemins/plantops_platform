-- A person's own holiday list (v0.53.0; rule 24, approved by the owner 2026-11-09 for Ramu at plant 001). The owner adds
-- holidays one person at a time: a date, a name, Paid or not, and an optional choice group ("Oct–Dec"). A Paid holiday
-- is a paid day off (worked = the day + 1 extra day's pay); in each choice group the owner may mark ONE festival that is
-- not Paid as the person's choice leave (paid if not worked). Worked out in src/lib/salary.ts, nothing stored.
--
-- Append-only, like day_marks: every change is a new row and the newest row for a person and day wins.
--   add      = the day is a holiday (name, paid, choice_group); a later add replaces it
--   remove   = the day is no holiday any more (and its choice leave goes with it)
--   choice   = the day (a holiday not Paid, with a group) is the person's choice leave
--   unchoice = it is not any more
-- attendance_app may SELECT and INSERT only. user ids are plain references to the platform; names are copied.
create table attendance_salary.person_holidays (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null,
  user_id         uuid not null,
  user_name       text not null check (length(trim(user_name)) between 1 and 100),
  day             date not null,
  action          text not null check (action in ('add', 'remove', 'choice', 'unchoice')),
  name            text check (name is null or length(trim(name)) between 1 and 60),
  paid            boolean,
  choice_group    text check (choice_group is null or length(trim(choice_group)) between 1 and 30),
  created_by      uuid not null,
  created_by_name text not null check (length(trim(created_by_name)) between 1 and 100),
  created_at      timestamptz not null default now(),
  check (
    (action = 'add' and name is not null and paid is not null)
    or (action <> 'add' and name is null and paid is null and choice_group is null)
  ),
  check (not (action = 'add' and paid and choice_group is not null)),
  unique (tenant_id, id)
);
create index person_holidays_user_day_idx on attendance_salary.person_holidays (tenant_id, user_id, day, created_at);

alter table attendance_salary.person_holidays enable row level security;
alter table attendance_salary.person_holidays force row level security;
create policy tenant_isolation on attendance_salary.person_holidays
  using (tenant_id = current_setting('app.tenant_id')::uuid)
  with check (tenant_id = current_setting('app.tenant_id')::uuid);

grant select, insert on attendance_salary.person_holidays to attendance_app;
