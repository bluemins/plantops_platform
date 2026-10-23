-- Salary types (v0.29.3; owner 2026-10-23, "build"): a third pay basis 'fixed' = salary type PV_SALARY_FIXED_MONTHLY,
-- the full monthly salary whatever the attendance (no cuts, no overtime, no paid leave). 'per_day' is
-- PV_SALARY_DAY_STAFF and 'monthly' PV_SALARY_MONTHLY_STAFF (names in src/lib/salary.ts). Only the two checks on
-- pay_basis change; no row changes; grants unchanged (attendance_app SELECT + INSERT).
alter table attendance_salary.salary_settings drop constraint salary_settings_pay_basis_check;
alter table attendance_salary.salary_settings add constraint salary_settings_pay_basis_check
  check (pay_basis in ('monthly', 'per_day', 'fixed'));

alter table attendance_salary.salary_settings drop constraint salary_settings_pay_basis_fields;
alter table attendance_salary.salary_settings add constraint salary_settings_pay_basis_fields check (
  (pay_basis = 'monthly' and monthly_paise is not null and day_rate_paise is null)
  or (pay_basis = 'per_day' and day_rate_paise is not null and monthly_paise is null and paid_leave_halfdays = 0)
  or (pay_basis = 'fixed' and monthly_paise is not null and day_rate_paise is null and paid_leave_halfdays = 0 and not gets_overtime)
);
