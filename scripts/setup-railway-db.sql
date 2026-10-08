-- One-time setup of a hosted PlantOps copy (Railway), run as the Postgres superuser by setup-railway-db.sh.
-- Same logins and rules as the local setup (setup-local-db.sql, setup-module-db.sql):
--   plantops_owner  owns tables, runs migrations (BYPASSRLS: also used by SECURITY DEFINER functions)
--   platform_app    every plant-user request; always subject to row-level security
--   platform_super  super_admin routes only; BYPASSRLS
--   lab_app, doc_app, stock_app  one login per module; never the owner, always under row-level security
-- Each module's tables and exact permissions come from its migrations (run as plantops_owner).
SELECT 'CREATE ROLE plantops_owner' WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'plantops_owner') \gexec
SELECT 'CREATE ROLE platform_app' WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'platform_app') \gexec
SELECT 'CREATE ROLE platform_super' WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'platform_super') \gexec
SELECT 'CREATE ROLE lab_app' WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'lab_app') \gexec
SELECT 'CREATE ROLE doc_app' WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'doc_app') \gexec
SELECT 'CREATE ROLE stock_app' WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'stock_app') \gexec

ALTER ROLE plantops_owner LOGIN BYPASSRLS PASSWORD :'owner_pw';
ALTER ROLE platform_app LOGIN NOBYPASSRLS PASSWORD :'app_pw';
ALTER ROLE platform_super LOGIN BYPASSRLS PASSWORD :'super_pw';
ALTER ROLE lab_app LOGIN NOBYPASSRLS PASSWORD :'lab_pw';
ALTER ROLE doc_app LOGIN NOBYPASSRLS PASSWORD :'doc_pw';
ALTER ROLE stock_app LOGIN NOBYPASSRLS PASSWORD :'stock_pw';

SELECT 'CREATE DATABASE plantops OWNER plantops_owner' WHERE NOT EXISTS (SELECT 1 FROM pg_database WHERE datname = 'plantops') \gexec
