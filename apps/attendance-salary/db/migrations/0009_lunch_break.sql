-- Lunch break and short days (v0.29.1; rule 21, approved by the owner 2026-10-23): a salary setting gets the lunch break
-- taken off the time at the plant. shift_minutes stays the full day's WORK (e.g. 8 h); a day with less work is a short
-- day whose hours count ÷ the work hours (worked out in src/lib/salary.ts, nothing stored). Existing rows get 0 (no
-- break), so their work stays their time at the plant. No row changes; grants unchanged (attendance_app SELECT +
-- INSERT on the table, which covers the new column).
alter table attendance_salary.salary_settings
  add column lunch_minutes integer not null default 0
    check (lunch_minutes between 0 and 180 and lunch_minutes % 15 = 0);
