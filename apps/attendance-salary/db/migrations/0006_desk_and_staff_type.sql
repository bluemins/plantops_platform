-- Office staff, Supervisor, Permanent / Temporary (v0.23.0). Plan: docs/ATTENDANCE_ROLES_PHASE_PLAN.md "Database".
-- No rows change. Grants: attendance_app keeps SELECT + INSERT only on punches / salary_settings; on plant_settings it
-- may also UPDATE the new not_marked_hour column (owner's OK 2026-10-17), like the other settings columns.

-- punches: a third source 'desk' = Office staff's "Mark for someone" (office phone's location, no reason, never
-- yourself). 'owner' keeps meaning "a fix" (by the owner or by Office staff).
alter table attendance_salary.punches drop constraint punches_source_check;
alter table attendance_salary.punches
  add constraint punches_source_check check (source in ('scan', 'owner', 'desk')),
  add constraint punches_desk_check check (source <> 'desk' or (distance_m is not null and accuracy_m is not null
                                           and reason is null and created_by <> user_id));

-- salary_settings: Permanent / Temporary (saved rows read as permanent)
alter table attendance_salary.salary_settings
  add column staff_type text not null default 'permanent' check (staff_type in ('permanent', 'temporary'));

-- plant_settings: hour of the morning "not marked" alert, 8-11 IST; null = Off
alter table attendance_salary.plant_settings
  add column not_marked_hour smallint default 10 check (not_marked_hour between 8 and 11);
grant update (not_marked_hour) on attendance_salary.plant_settings to attendance_app;
