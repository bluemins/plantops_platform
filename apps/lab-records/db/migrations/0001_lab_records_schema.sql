-- Phase 3: Lab Records' own schema. Runs as plantops_owner (owns the tables, never used by the app).
-- The app connects as lab_app (scripts/setup-lab-db.sh): no BYPASSRLS, never the owner, and it may only
-- use this schema - never the platform's (CLAUDE.md "Row-level security rules").
grant usage on schema lab_records to lab_app;
revoke all on schema lab_records from public;
