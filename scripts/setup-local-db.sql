-- One-time local setup, run as the postgres superuser by setup-local-db.sh.
-- Creates the three PlantOps database logins and the dev + test databases.
--   plantops_owner  owns tables, runs migrations (BYPASSRLS: also used by SECURITY DEFINER functions)
--   platform_app    every plant-user request; always subject to row-level security
--   platform_super  super_admin routes only; BYPASSRLS
SELECT 'CREATE ROLE plantops_owner' WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'plantops_owner') \gexec
SELECT 'CREATE ROLE platform_app' WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'platform_app') \gexec
SELECT 'CREATE ROLE platform_super' WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'platform_super') \gexec

ALTER ROLE plantops_owner LOGIN BYPASSRLS PASSWORD :'owner_pw';
ALTER ROLE platform_app LOGIN NOBYPASSRLS PASSWORD :'app_pw';
ALTER ROLE platform_super LOGIN BYPASSRLS PASSWORD :'super_pw';

SELECT 'CREATE DATABASE plantops OWNER plantops_owner' WHERE NOT EXISTS (SELECT 1 FROM pg_database WHERE datname = 'plantops') \gexec
SELECT 'CREATE DATABASE plantops_test OWNER plantops_owner' WHERE NOT EXISTS (SELECT 1 FROM pg_database WHERE datname = 'plantops_test') \gexec
