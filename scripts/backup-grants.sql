-- Read access for the backup login (scripts/setup-backup-login.sql) to every PlantOps schema, run as plantops_owner.
-- Run by setup-backup-login.sh and again after every migration (railway-migrate.sh), so a new module's schema is
-- covered too. SELECT only - never INSERT, UPDATE or DELETE. Does nothing where the backup login doesn't exist.
DO $$
DECLARE s text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'plantops_backup') THEN RETURN; END IF;
  FOR s IN SELECT nspname FROM pg_namespace WHERE nspowner = (SELECT oid FROM pg_roles WHERE rolname = current_user) LOOP
    EXECUTE format('GRANT USAGE ON SCHEMA %I TO plantops_backup', s);
    EXECUTE format('GRANT SELECT ON ALL TABLES IN SCHEMA %I TO plantops_backup', s);
    EXECUTE format('GRANT SELECT ON ALL SEQUENCES IN SCHEMA %I TO plantops_backup', s);
  END LOOP;
  -- tables a later migration adds to an existing schema
  EXECUTE 'ALTER DEFAULT PRIVILEGES GRANT SELECT ON TABLES TO plantops_backup';
  EXECUTE 'ALTER DEFAULT PRIVILEGES GRANT SELECT ON SEQUENCES TO plantops_backup';
END $$;
