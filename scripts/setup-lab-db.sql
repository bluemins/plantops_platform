-- One-time local setup for the Lab Records module, run as the postgres superuser by setup-lab-db.sh.
--   lab_app  every Lab Records request; always subject to row-level security, never owns tables.
-- Tables in schema lab_records are created by the module's migrations (as plantops_owner), which also
-- grant lab_app exactly what it may do (SELECT/INSERT only on lab result tables: append-only).
SELECT 'CREATE ROLE lab_app' WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'lab_app') \gexec
ALTER ROLE lab_app LOGIN NOBYPASSRLS PASSWORD :'lab_pw';
