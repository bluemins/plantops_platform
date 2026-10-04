#!/usr/bin/env bash
# One-time setup of a hosted PlantOps copy (Railway). See docs/DEPLOY.md. Example:
#   ./scripts/setup-railway-db.sh shared
# - Asks for the copy's Railway Postgres address (DATABASE_PUBLIC_URL), its three web addresses and the
#   super_admin email.
# - Creates the five database logins and the `plantops` database (scripts/setup-railway-db.sql).
# - Generates every secret for this copy and writes two files (never committed, matched by .env.* in .gitignore):
#     .env.railway.<copy>        used from this computer: migrations, seed (scripts/railway-migrate.sh)
#     .env.railway.<copy>.paste  one block per Railway service, for its Variables > Raw Editor
# - Runs all migrations and creates the super_admin + module registrations (pnpm db:migrate && pnpm db:seed).
# Refuses to run twice for the same copy: new passwords would no longer match what Railway already has.
set -euo pipefail
cd "$(dirname "$0")/.."

COPY="${1:-}"
[[ "$COPY" =~ ^[a-z0-9-]+$ ]] || { echo "Usage: $0 <copy-name>   e.g. $0 shared  (lowercase letters, digits, -)"; exit 1; }
LOCAL=".env.railway.$COPY"
PASTE="$LOCAL.paste"
for f in "$LOCAL" "$PASTE"; do
  [ -e "$f" ] && { echo "$f already exists - this copy was set up before. Not overwriting."; exit 1; }
done
command -v psql >/dev/null || { echo "psql is not installed (sudo apt install postgresql-client)"; exit 1; }

echo "Railway > Postgres service > Variables > DATABASE_PUBLIC_URL (input hidden):"
read -rs ADMIN_URL; echo
[[ "$ADMIN_URL" =~ ^postgres(ql)?:// ]] || { echo "That does not look like a postgres:// address"; exit 1; }
ask() { local answer; read -rp "$1 [$2]: " answer; echo "${answer:-$2}"; }
APP_HOST=$(ask "Platform address" "app.bluemins.life")
LAB_HOST=$(ask "Lab Records address" "lab.bluemins.life")
DOC_HOST=$(ask "Document Store address" "docs.bluemins.life")
SUPER_EMAIL=$(ask "super_admin login email" "")
[ -n "$SUPER_EMAIL" ] || { echo "The super_admin email is required"; exit 1; }

gen() { openssl rand -hex "$1"; }
OWNER_PW=$(gen 16); APP_PW=$(gen 16); SUPER_PW=$(gen 16); LAB_PW=$(gen 16); DOC_PW=$(gen 16)
SUPER_ADMIN_PW=$(gen 12)
LAB_SESSION=$(gen 32); DOC_SESSION=$(gen 32)
LAB_SECRET=$(gen 32); DOC_SECRET=$(gen 32)
CRON=$(gen 32)
SSO_KEY=$(node scripts/generate-sso-key.mjs)

echo "Creating database logins and the plantops database..."
psql "$ADMIN_URL" -q -v ON_ERROR_STOP=1 \
  -v owner_pw="$OWNER_PW" -v app_pw="$APP_PW" -v super_pw="$SUPER_PW" -v lab_pw="$LAB_PW" -v doc_pw="$DOC_PW" \
  -f scripts/setup-railway-db.sql

# From this computer: Railway's public proxy address, same host/port as the admin address.
OWNER_URL=$(node -e 'const u=new URL(process.argv[1]); u.username="plantops_owner"; u.password=process.argv[2]; u.pathname="/plantops"; process.stdout.write(u.toString())' "$ADMIN_URL" "$OWNER_PW")
# Inside Railway: private network; Railway fills in ${{Postgres.RAILWAY_PRIVATE_DOMAIN}} itself.
inner() { echo "postgres://$1:$2@\${{Postgres.RAILWAY_PRIVATE_DOMAIN}}:5432/plantops"; }

umask 077
cat > "$LOCAL" <<ENV
# PlantOps copy "$COPY" on Railway - written by scripts/setup-railway-db.sh. Never commit; keep a copy in
# your password manager. Used by scripts/railway-migrate.sh $COPY.
DATABASE_URL_OWNER=$OWNER_URL
SUPER_ADMIN_EMAIL=$SUPER_EMAIL
SUPER_ADMIN_PASSWORD=$SUPER_ADMIN_PW
MODULE_URL_LAB_RECORDS=https://$LAB_HOST
MODULE_SECRET_LAB_RECORDS=$LAB_SECRET
MODULE_URL_DOCUMENT_STORE=https://$DOC_HOST
MODULE_SECRET_DOCUMENT_STORE=$DOC_SECRET
ENV

cat > "$PASTE" <<ENV
# PlantOps copy "$COPY": paste each block into that Railway service > Variables > Raw Editor.
# Never commit. Delete this file once pasted (the values live in Railway and your password manager).

##### platform  (domain: $APP_HOST, port 3000)
PORT=3000
PLATFORM_URL=https://$APP_HOST
DATABASE_URL_APP=$(inner platform_app "$APP_PW")
DATABASE_URL_SUPER=$(inner platform_super "$SUPER_PW")
SSO_PRIVATE_JWK_B64=$SSO_KEY

##### lab-records  (domain: $LAB_HOST, port 3001)
PORT=3001
PLATFORM_URL=https://$APP_HOST
MODULE_URL_LAB_RECORDS=https://$LAB_HOST
MODULE_SECRET_LAB_RECORDS=$LAB_SECRET
LAB_DATABASE_URL_APP=$(inner lab_app "$LAB_PW")
LAB_SESSION_SECRET=$LAB_SESSION
CRON_SECRET=$CRON

##### document-store  (domain: $DOC_HOST, port 3003; volume mounted at /data)
PORT=3003
PLATFORM_URL=https://$APP_HOST
MODULE_URL_DOCUMENT_STORE=https://$DOC_HOST
MODULE_SECRET_DOCUMENT_STORE=$DOC_SECRET
DOC_DATABASE_URL_APP=$(inner doc_app "$DOC_PW")
DOC_SESSION_SECRET=$DOC_SESSION
DOC_STORAGE_DIR=/data/documents
RAILWAY_RUN_UID=0
CRON_SECRET=$CRON

##### GitHub > Settings > Environments > "$COPY" (daily reminder jobs, .github/workflows/daily.yml)
# variable LAB_URL   = https://$LAB_HOST
# variable DOCS_URL  = https://$DOC_HOST
# secret   CRON_SECRET = $CRON
ENV

echo "Running migrations and creating the super_admin..."
bash scripts/railway-migrate.sh "$COPY" --seed

echo
echo "Done. Copy \"$COPY\" is set up."
echo "  $LOCAL        keep (needed for future migrations); also save it in your password manager"
echo "  $PASTE  paste into Railway and GitHub (docs/DEPLOY.md steps 4 and 8), then delete it"
echo "super_admin: $SUPER_EMAIL - password is SUPER_ADMIN_PASSWORD in $LOCAL (change it after first login)"
