-- Office staff and Supervisor (Attendance & Salary). Plan: docs/ATTENDANCE_ROLES_PHASE_PLAN.md.
-- Office staff: marks for people without a phone, fixes times, gives advances (never salaries). Supervisor: Today board
-- read-only and IN / OUT alerts. Both work only in Attendance; neither is tracked or paid unless they also hold Plant staff.
insert into platform.roles (id, module_id, label) values
  ('office_staff', 'attendance_salary', 'Office staff'),
  ('supervisor',   'attendance_salary', 'Supervisor');
