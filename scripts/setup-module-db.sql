-- One-time local setup for a module app, run as the postgres superuser by setup-module-db.sh.
-- Creates the module's own database login: never the table owner, no BYPASSRLS (always under row-level
-- security). Its tables and exact permissions come from the module's migrations (run as plantops_owner).
SELECT format('CREATE ROLE %I', :'login') WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = :'login') \gexec
SELECT format('ALTER ROLE %I LOGIN NOBYPASSRLS PASSWORD %L', :'login', :'pw') \gexec
