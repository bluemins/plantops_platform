-- "Ask for DA" on a field duty (v0.24.0, owner 2026-10-17): the person may claim TA for the km without DA for that day
-- (e.g. ate at home). salary_claims gets wants_da: yes / no on a field duty, empty on an expense. Every field duty
-- already saved asked for DA (that was the only way before), so they are set to yes here (as the migration owner);
-- nothing counted or paid changes. Grants unchanged: attendance_app keeps SELECT + INSERT only, so a claim's choice is
-- fixed once sent, like the rest of the claim.
alter table attendance_salary.salary_claims
  add column wants_da boolean;

update attendance_salary.salary_claims set wants_da = true where kind = 'field_duty';

alter table attendance_salary.salary_claims
  add constraint salary_claims_wants_da_check check ((kind = 'field_duty') = (wants_da is not null));
