-- Cash book link (owner, 2026-11-12; docs/CASHBOOK_PHASE_PLAN.md section 9 C4, approved "Yes, as described"): advances
-- given from Sales' cash book arrive here through POST /api/cashbook/v1/advances (key atc_..., plant bound to the key).
-- source_ref = the cash book's number ("C-0123", "C-0130", "C-0123/cancel"): a second send of the same entry finds the
-- row already saved instead of adding it again. Null for advances typed in Attendance itself.
-- One new column; grants unchanged (attendance_app already has SELECT + INSERT on the table, nothing else).
alter table attendance_salary.salary_advances
  add column source_ref text check (source_ref is null or length(trim(source_ref)) between 1 and 40);
create unique index salary_advances_source_ref on attendance_salary.salary_advances (tenant_id, source_ref) where source_ref is not null;
