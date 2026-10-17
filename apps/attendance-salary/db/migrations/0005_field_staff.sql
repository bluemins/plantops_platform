-- Claims only for field staff (Phase C, v0.22.1). Plan: docs/ATTENDANCE_ROLES_PHASE_PLAN.md "Database".
-- salary_settings gets the owner's "Field staff" tick: only a ticked person may send their own claims, and a TA / DA
-- rate needs the tick. Rows that already have a rate are ticked once here (as the migration owner, BYPASSRLS), so
-- everyone set up for field duty in v0.22.0 keeps working. Grants unchanged: attendance_app keeps SELECT + INSERT only.
alter table attendance_salary.salary_settings
  add column field_staff boolean not null default false;

update attendance_salary.salary_settings set field_staff = true
 where km_rate_paise is not null or da_day_paise is not null;

alter table attendance_salary.salary_settings
  add constraint salary_settings_rates_need_field_staff
  check (field_staff or (km_rate_paise is null and da_day_paise is null));
