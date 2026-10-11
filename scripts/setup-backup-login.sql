-- Creates the read-only backup login, run as the Postgres superuser by setup-backup-login.sh (once per copy).
--   plantops_backup  used only by the nightly pg_dump (.github/workflows/backup.yml). Reads every plant's data:
--                    BYPASSRLS so row-level security doesn't hide rows from the dump. It is given SELECT only
--                    (scripts/backup-grants.sql), and its sessions are read-only, so it can never change data.
SELECT 'CREATE ROLE plantops_backup' WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'plantops_backup') \gexec
ALTER ROLE plantops_backup LOGIN BYPASSRLS NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT PASSWORD :'pw';
ALTER ROLE plantops_backup SET default_transaction_read_only = on;
GRANT CONNECT ON DATABASE plantops TO plantops_backup;
