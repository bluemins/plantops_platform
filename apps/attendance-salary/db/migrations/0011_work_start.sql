-- Work starts at (v0.35.0; rule 23, approved by the owner 2026-11-01): an optional time per salary setting, minutes after
-- midnight India time (540 = 9:00). Time at the plant before it isn't counted for salary (a scan at 8:50 counts from
-- 9:00); a later IN counts from the IN (worked out in src/lib/salary.ts, nothing stored). Existing rows get null (from the
-- IN, as before). No row changes; grants unchanged (attendance_app SELECT + INSERT on the table covers the new column).
alter table attendance_salary.salary_settings
  add column work_start_minutes integer
    check (work_start_minutes is null or (work_start_minutes between 0 and 1425 and work_start_minutes % 15 = 0));
