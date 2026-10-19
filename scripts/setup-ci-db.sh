#!/usr/bin/env bash
# Test database for GitHub Actions (.github/workflows/ci.yml); not for this computer (use setup-local-db.sh there).
# - Creates the same logins as setup-local-db.sh + setup-module-db.sh, through the superuser in the PG* variables
#   (the throwaway Postgres container of the CI run), with fresh random passwords.
# - Writes .env with the TEST_* lines the tests read. The tests rebuild every schema from the migrations themselves.
set -euo pipefail
cd "$(dirname "$0")/.."

[ ! -f .env ] || { echo ".env already exists - this script is for CI runs only."; exit 1; }

gen() { openssl rand -hex 16; }
OWNER_PW=$(gen); APP_PW=$(gen); SUPER_PW=$(gen)
psql -q -v ON_ERROR_STOP=1 -v owner_pw="$OWNER_PW" -v app_pw="$APP_PW" -v super_pw="$SUPER_PW" -f scripts/setup-local-db.sql

HOST="${PGHOST:-localhost}:${PGPORT:-5432}"
url() { echo "postgres://$1:$2@$HOST/plantops_test"; }
{
  echo "# CI only - written by scripts/setup-ci-db.sh"
  echo "TEST_DATABASE_URL_OWNER=$(url plantops_owner "$OWNER_PW")"
  echo "TEST_DATABASE_URL_APP=$(url platform_app "$APP_PW")"
  echo "TEST_DATABASE_URL_SUPER=$(url platform_super "$SUPER_PW")"
} > .env

# module login + .env prefix, as in setup-module-db.sh
for pair in lab_app:LAB doc_app:DOC stock_app:STOCK complaint_app:COMPLAINT order_app:ORDER attendance_app:ATTEND jobs_app:JOBS; do
  LOGIN="${pair%%:*}"; PREFIX="${pair##*:}"; PW=$(gen)
  psql -q -v ON_ERROR_STOP=1 -v login="$LOGIN" -v pw="$PW" -f scripts/setup-module-db.sql
  echo "TEST_${PREFIX}_DATABASE_URL_APP=$(url "$LOGIN" "$PW")" >> .env
done
chmod 600 .env
echo "Done: CI test database and .env ready."
