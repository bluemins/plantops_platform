-- Per-day pay (Salary extras, Part A). Plan: docs/SALARY_EXTRAS_PHASE_PLAN.md "Database".
-- salary_settings gets a pay basis and a day rate. Rows already saved become 'monthly' and stay valid; no data is
-- rewritten. Grants unchanged: attendance_app keeps SELECT + INSERT only.
alter table attendance_salary.salary_settings
  add column pay_basis text not null default 'monthly' check (pay_basis in ('monthly', 'per_day')),
  add column day_rate_paise int check (day_rate_paise > 0 and day_rate_paise <= 10000000),      -- ≤ ₹1 lakh a day
  alter column monthly_paise drop not null,                                  -- its check (> 0, ≤ ₹1 crore) stays
  add constraint salary_settings_pay_basis_fields check (
       (pay_basis = 'monthly' and monthly_paise is not null and day_rate_paise is null)
    or (pay_basis = 'per_day' and day_rate_paise is not null and monthly_paise is null and paid_leave_halfdays = 0));
