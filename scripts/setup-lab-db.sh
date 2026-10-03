#!/usr/bin/env bash
# One-time local setup for the Lab Records module (Phase 3), after scripts/setup-local-db.sh.
# - Creates the `lab_app` database login (asks for your sudo password: only the postgres superuser can).
# - Adds the Lab Records lines to .env (database URLs + the module's own session secret). Values are
#   never printed. Safe to run again: it sets a new database password and keeps the session secret.
set -euo pipefail
cd "$(dirname "$0")/.."

if [ ! -f .env ]; then
  echo "No .env yet - run scripts/setup-local-db.sh first."
  exit 1
fi

LAB_PW=$(openssl rand -hex 16)
sudo -u postgres psql -q -v ON_ERROR_STOP=1 -v lab_pw="$LAB_PW" -f scripts/setup-lab-db.sql

url() { echo "postgres://lab_app:$LAB_PW@localhost:5432/$1"; }
SESSION=$(grep -E '^LAB_SESSION_SECRET=' .env | cut -d= -f2- || true)
[ -n "$SESSION" ] || SESSION=$(openssl rand -hex 32)

# Rewrite only our own lines; everything else in .env stays as it is.
grep -vE '^(# Lab Records module|LAB_DATABASE_URL_APP|TEST_LAB_DATABASE_URL_APP|LAB_SESSION_SECRET)' .env > .env.tmp || true
cat >> .env.tmp <<ENV
# Lab Records module (scripts/setup-lab-db.sh)
LAB_DATABASE_URL_APP=$(url plantops)
TEST_LAB_DATABASE_URL_APP=$(url plantops_test)
LAB_SESSION_SECRET=$SESSION
ENV
chmod 600 .env.tmp
mv .env.tmp .env

echo "Done: lab_app login ready, Lab Records lines added to .env."
echo "Next: pnpm db:migrate"
