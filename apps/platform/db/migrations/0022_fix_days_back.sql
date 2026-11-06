-- How far back Office staff and Supervisors may add or cancel someone's IN / OUT in Attendance (owner, 2026-11-06).
-- The owner sets it per person on Manage users, next to the role. One row per person; no row = 2 days (FIX_DAYS_DEFAULT
-- in packages/types), so people who already hold the roles need no data copied. Attendance reads it through the user
-- status re-check (every 5 minutes); its own server refuses an older fix. Changes are in the audit log (user.updated).
create table platform.fix_days_back (
  tenant_id  uuid not null,
  user_id    uuid not null,
  days       smallint not null check (days between 0 and 31),
  set_by     text not null,
  set_at     timestamptz not null default now(),
  primary key (tenant_id, user_id),
  foreign key (tenant_id, user_id) references platform.users (tenant_id, id)
);
alter table platform.fix_days_back enable row level security;
alter table platform.fix_days_back force row level security;
create policy tenant_isolation on platform.fix_days_back
  using (tenant_id = current_setting('app.tenant_id')::uuid)
  with check (tenant_id = current_setting('app.tenant_id')::uuid);
-- a change replaces the row (delete + insert), like the "Gets alerts" ticks
grant select, insert, delete on platform.fix_days_back to platform_app, platform_super;
