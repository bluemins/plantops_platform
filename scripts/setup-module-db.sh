#!/usr/bin/env bash
# One-time local setup for a module app (after scripts/setup-local-db.sh). Example (Document Store):
#   ./scripts/setup-module-db.sh document_store doc_app DOC 3003
# - Creates the module's database login (asks for your sudo password: only the postgres superuser can).
# - Adds the module's lines to .env: <PREFIX>_DATABASE_URL_APP, TEST_<PREFIX>_DATABASE_URL_APP,
#   <PREFIX>_SESSION_SECRET, and (if missing) MODULE_URL_<ID> + MODULE_SECRET_<ID> on the same host as
#   PLATFORM_URL. Values are never printed. Safe to run again: new database password, secrets kept.
# Then: pnpm db:migrate && pnpm db:seed (registers the module's URL + secret with the platform).
set -euo pipefail
cd "$(dirname "$0")/.."

if [ $# -ne 4 ]; then
  echo "Usage: $0 <module_id> <db_login> <ENV_PREFIX> <port>   e.g. $0 document_store doc_app DOC 3003"
  exit 1
fi
MODULE="$1"; LOGIN="$2"; PREFIX="$3"; PORT="$4"
[[ "$MODULE" =~ ^[a-z_]+$ && "$LOGIN" =~ ^[a-z_]+$ && "$PREFIX" =~ ^[A-Z]+$ && "$PORT" =~ ^[0-9]+$ ]] || { echo "Invalid arguments"; exit 1; }
[ -f .env ] || { echo "No .env yet - run scripts/setup-local-db.sh first."; exit 1; }

PW=$(openssl rand -hex 16)
sudo -u postgres psql -q -v ON_ERROR_STOP=1 -v login="$LOGIN" -v pw="$PW" -f scripts/setup-module-db.sql

ID_UP=$(echo "$MODULE" | tr '[:lower:]' '[:upper:]')
get() { grep -E "^$1=" .env | cut -d= -f2- || true; }
SESSION=$(get "${PREFIX}_SESSION_SECRET"); [ -n "$SESSION" ] || SESSION=$(openssl rand -hex 32)
MURL=$(get "MODULE_URL_${ID_UP}")
if [ -z "$MURL" ]; then
  HOST=$(node -e 'const u=new URL(process.argv[1]); process.stdout.write(u.protocol+"//"+u.hostname)' "$(get PLATFORM_URL)")
  MURL="$HOST:$PORT"
fi
MSECRET=$(get "MODULE_SECRET_${ID_UP}"); [ -n "$MSECRET" ] || MSECRET=$(openssl rand -hex 32)
url() { echo "postgres://$LOGIN:$PW@localhost:5432/$1"; }

# Rewrite only this module's lines; everything else in .env stays as it is.
grep -vE "^(# ${MODULE} module|${PREFIX}_DATABASE_URL_APP|TEST_${PREFIX}_DATABASE_URL_APP|${PREFIX}_SESSION_SECRET|MODULE_URL_${ID_UP}|MODULE_SECRET_${ID_UP})=?" .env > .env.tmp || true
cat >> .env.tmp <<ENV
# ${MODULE} module (scripts/setup-module-db.sh)
${PREFIX}_DATABASE_URL_APP=$(url plantops)
TEST_${PREFIX}_DATABASE_URL_APP=$(url plantops_test)
${PREFIX}_SESSION_SECRET=$SESSION
MODULE_URL_${ID_UP}=$MURL
MODULE_SECRET_${ID_UP}=$MSECRET
ENV
chmod 600 .env.tmp
mv .env.tmp .env
echo "Done: $LOGIN login ready, $MODULE lines added to .env (module URL $MURL)."
echo "Next: pnpm db:migrate && pnpm db:seed"
