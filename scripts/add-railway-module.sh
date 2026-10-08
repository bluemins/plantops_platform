#!/usr/bin/env bash
# Adds one new module app to a hosted PlantOps copy that was set up BEFORE that module existed. See
# docs/DEPLOY.md, "Adding a module to a running copy". Example (Floor Stock on the shared copy):
#   ./scripts/add-railway-module.sh shared floor_stock stock_app STOCK 3002 stock.bluemins.life
# - Creates the module's database login on the copy (asks for Railway's DATABASE_PUBLIC_URL; input hidden).
# - Adds MODULE_URL_<ID> + MODULE_SECRET_<ID> to .env.railway.<copy> (kept on this computer, never committed).
# - Runs the module's migrations, then registers ONLY this module's address + secret with the platform
#   (the other modules' registrations are left exactly as they are).
# - Writes .env.railway.<copy>.<module>.paste: the new Railway service's variables. Delete it once pasted.
# Refuses to run twice for the same module: a new secret would no longer match what Railway already has.
set -euo pipefail
cd "$(dirname "$0")/.."

if [ $# -ne 6 ]; then
  echo "Usage: $0 <copy> <module_id> <db_login> <ENV_PREFIX> <port> <address>"
  echo "  e.g. $0 shared floor_stock stock_app STOCK 3002 stock.bluemins.life"
  exit 1
fi
COPY="$1"; MODULE="$2"; LOGIN="$3"; PREFIX="$4"; PORT="$5"; HOST="$6"
[[ "$COPY" =~ ^[a-z0-9-]+$ && "$MODULE" =~ ^[a-z_]+$ && "$LOGIN" =~ ^[a-z_]+$ && "$PREFIX" =~ ^[A-Z]+$ && "$PORT" =~ ^[0-9]+$ && "$HOST" =~ ^[a-z0-9.-]+$ ]] || { echo "Invalid arguments"; exit 1; }
APP_DIR="apps/$(echo "$MODULE" | tr _ -)"
ID_UP=$(echo "$MODULE" | tr '[:lower:]' '[:upper:]')
LOCAL="$PWD/.env.railway.$COPY"
PASTE=".env.railway.$COPY.$MODULE.paste"
[ -d "$APP_DIR" ] || { echo "$APP_DIR not found"; exit 1; }
[ -f "$LOCAL" ] || { echo "$LOCAL not found - restore it from your password manager first."; exit 1; }
grep -q "^MODULE_URL_${ID_UP}=" "$LOCAL" && { echo "$MODULE is already in $LOCAL - it was added before. Not overwriting."; exit 1; }
[ -e "$PASTE" ] && { echo "$PASTE already exists. Not overwriting."; exit 1; }
command -v psql >/dev/null || { echo "psql is not installed (sudo apt install postgresql-client)"; exit 1; }

echo "Railway > Postgres service > Variables > DATABASE_PUBLIC_URL (input hidden):"
read -rs ADMIN_URL; echo
[[ "$ADMIN_URL" =~ ^postgres(ql)?:// ]] || { echo "That does not look like a postgres:// address"; exit 1; }
read -rp "Platform address [app.bluemins.life]: " APP_HOST; APP_HOST="${APP_HOST:-app.bluemins.life}"

gen() { openssl rand -hex "$1"; }
PW=$(gen 16); SESSION=$(gen 32); SECRET=$(gen 32)

echo "Creating the $LOGIN database login..."
ADMIN_DB=$(node -e 'const u=new URL(process.argv[1]); u.pathname="/plantops"; process.stdout.write(u.toString())' "$ADMIN_URL")
psql "$ADMIN_DB" -q -v ON_ERROR_STOP=1 -v login="$LOGIN" -v pw="$PW" -f scripts/setup-module-db.sql

umask 077
cat >> "$LOCAL" <<ENV
MODULE_URL_${ID_UP}=https://$HOST
MODULE_SECRET_${ID_UP}=$SECRET
ENV

echo "Running $MODULE migrations..."
PLANTOPS_ENV_FILE="$LOCAL" pnpm --filter "@plantops/$(echo "$MODULE" | tr _ -)" db:migrate

echo "Registering $MODULE with the platform..."
OWNER_URL=$(grep -E '^DATABASE_URL_OWNER=' "$LOCAL" | cut -d= -f2-)
HASH=$(printf %s "$SECRET" | sha256sum | cut -d' ' -f1)
# (psql fills in :'name' only in what it reads, not in -c)
psql "$OWNER_URL" -q -v ON_ERROR_STOP=1 -v id="$MODULE" -v url="https://$HOST" -v hash="$HASH" <<'SQL'
update platform.modules set base_url = :'url', client_secret_hash = :'hash' where id = :'id';
SQL

inner() { echo "postgres://$1:$2@\${{Postgres.RAILWAY_PRIVATE_DOMAIN}}:5432/plantops"; }
cat > "$PASTE" <<ENV
# PlantOps copy "$COPY": the new $APP_DIR service > Variables > Raw Editor. Never commit; delete once pasted.
##### $(basename "$APP_DIR")  (domain: $HOST, port $PORT)
PORT=$PORT
RAILWAY_DOCKERFILE_PATH=$APP_DIR/Dockerfile
PLATFORM_URL=https://$APP_HOST
MODULE_URL_${ID_UP}=https://$HOST
MODULE_SECRET_${ID_UP}=$SECRET
${PREFIX}_DATABASE_URL_APP=$(inner "$LOGIN" "$PW")
${PREFIX}_SESSION_SECRET=$SESSION
# Copy these three from the document-store service (same values):
CRON_SECRET=
BREVO_API_KEY=
MAIL_FROM=
ENV

echo
echo "Done. $MODULE is ready on copy \"$COPY\" (database, migrations, platform registration)."
echo "  $LOCAL  now also holds MODULE_URL_${ID_UP} / MODULE_SECRET_${ID_UP}: update your password manager copy"
echo "  $PASTE  paste into the new Railway service (docs/DEPLOY.md), fill in the 3 empty lines, then delete it"
