#!/usr/bin/env bash
# Replaces every secret PlantOps keeps in Railway for one hosted copy (after a leak, e.g. Railway's 2026-10-21
# incident). See docs/HANDBOOK.md "Changing a secret". Example:
#   ./scripts/rotate-railway-secrets.sh shared
# - Makes new values for: every database password (incl. the postgres superuser and the backup login), the SSO
#   signing key, every module session secret, every module client secret, CRON_SECRET and DROP_CODE_SECRET.
# - Not made here (see HANDBOOK step 4): keys made at a provider, and ORDER_BOT_KEYS / ORDER_CALL_KEYS (each needs
#   the bot's or MacroDroid's copy changed the same night).
# - Step 1 writes .env.railway.<copy>.rotate (never committed): one block per Railway service. Nothing is printed.
#   You stage those values in Railway WITHOUT deploying.
# - Step 2 (after you type ROTATE) changes the passwords and module secret hashes in the database, in one
#   transaction, and updates .env.railway.<copy> (old copy kept as .env.railway.<copy>.before-rotate).
# - Then you deploy the staged Railway changes. Open database connections keep working until the redeploy.
# Afterwards: everyone logs in again, and the Attendance QR must be printed again (ATTEND_SESSION_SECRET).
set -euo pipefail
cd "$(dirname "$0")/.."

COPY="${1:-}"
[[ "$COPY" =~ ^[a-z0-9-]+$ ]] || { echo "Usage: $0 <copy-name>   e.g. $0 shared"; exit 1; }
LOCAL=".env.railway.$COPY"
OUT="$LOCAL.rotate"
OLD="$LOCAL.before-rotate"
[ -f "$LOCAL" ] || { echo "$LOCAL not found - restore it from your password manager first."; exit 1; }
for f in "$OUT" "$OLD"; do
  [ -e "$f" ] && { echo "$f already exists (an earlier run?). Check it, then move it away and run again."; exit 1; }
done
command -v psql >/dev/null || { echo "psql is not installed (sudo apt install postgresql-client)"; exit 1; }

echo "Railway > Postgres service > Variables > DATABASE_PUBLIC_URL (input hidden):"
read -rs ADMIN_URL; echo
[[ "$ADMIN_URL" =~ ^postgres(ql)?:// ]] || { echo "That does not look like a postgres:// address"; exit 1; }
SUPERUSER=$(node -e 'process.stdout.write(decodeURIComponent(new URL(process.argv[1]).username))' "$ADMIN_URL")
# The logins are cluster-wide, the module secrets live in the plantops database: connect there.
PLANTOPS_URL=$(node -e 'const u=new URL(process.argv[1]); u.pathname="/plantops"; process.stdout.write(u.toString())' "$ADMIN_URL")
psql "$PLANTOPS_URL" -qAt -c "select 1" >/dev/null || { echo "Could not connect with that address."; exit 1; }

gen() { openssl rand -hex "$1"; }
umask 077

LOGINS=(plantops_owner platform_app platform_super lab_app doc_app stock_app complaint_app order_app attendance_app jobs_app plantops_backup)
declare -A PW
for l in "${LOGINS[@]}"; do PW[$l]=$(gen 16); done
SUPERUSER_PW=$(gen 24)
MODULES=(LAB_RECORDS DOCUMENT_STORE FLOOR_STOCK COMPLAINT_BOX ORDER_CAPTURE ATTENDANCE_SALARY JOB_APPLICATIONS)
declare -A SECRET
for m in "${MODULES[@]}"; do SECRET[$m]=$(gen 32); done
declare -A SESSION
for p in LAB DOC STOCK COMPLAINT ORDER ATTEND JOBS; do SESSION[$p]=$(gen 32); done
CRON=$(gen 32)
DROP_CODE=$(gen 32)
SSO_KEY=$(node scripts/generate-sso-key.mjs)

inner() { echo "postgres://$1:${PW[$1]}@\${{Postgres.RAILWAY_PRIVATE_DOMAIN}}:5432/plantops"; }
outer() { node -e 'const u=new URL(process.argv[1]); u.username=process.argv[2]; u.password=process.argv[3]; u.pathname="/plantops"; process.stdout.write(u.toString())' "$ADMIN_URL" "$1" "${PW[$1]}"; }

block() { # service, prefix, module key
  cat <<ENV

##### $1  (change only these variables)
MODULE_SECRET_$3=${SECRET[$3]}
$2_DATABASE_URL_APP=$(inner "$4")
$2_SESSION_SECRET=${SESSION[$2]}
CRON_SECRET=$CRON
ENV
}

{
  cat <<ENV
# PlantOps copy "$COPY": new secrets, written $(date -u +%FT%TZ) by scripts/rotate-railway-secrets.sh.
# Stage each block in that Railway service > Variables (edit just these keys), DO NOT deploy yet.
# Never commit. Delete this file once everything is in Railway, GitHub and the password manager.

##### Postgres service  (change both; afterwards check DATABASE_URL / DATABASE_PUBLIC_URL show the new password)
PGPASSWORD=$SUPERUSER_PW
POSTGRES_PASSWORD=$SUPERUSER_PW

##### platform  (change only these variables; DELETE SSO_PREVIOUS_PUBLIC_JWK_B64 if it exists: the old key leaked)
DATABASE_URL_APP=$(inner platform_app)
DATABASE_URL_SUPER=$(inner platform_super)
SSO_PRIVATE_JWK_B64=$SSO_KEY
CRON_SECRET=$CRON
ENV
  block lab-records LAB LAB_RECORDS lab_app
  block document-store DOC DOCUMENT_STORE doc_app
  block floor-stock STOCK FLOOR_STOCK stock_app
  block complaint-box COMPLAINT COMPLAINT_BOX complaint_app
  block order-capture ORDER ORDER_CAPTURE order_app
  # Signs Drop's WhatsApp login codes; a change only cancels codes still waiting (shops stay logged in).
  echo "DROP_CODE_SECRET=$DROP_CODE"
  block attendance-salary ATTEND ATTENDANCE_SALARY attendance_app
  block job-applications JOBS JOB_APPLICATIONS jobs_app
  cat <<ENV

##### GitHub > Settings > Environments > "$COPY" > secrets
# CRON_SECRET = $CRON
# DATABASE_URL_BACKUP = $(outer plantops_backup)

##### cron-job.org: header x-cron-secret on all 13 jobs (HANDBOOK section 10 lists them)
# $CRON
ENV
} > "$OUT"

echo
echo "Step 1 done: new values are in $OUT (not shown here)."
echo "Stage every block in Railway now (Variables, edit those keys only) but do NOT deploy yet."
read -rp "When all eight services + Postgres are staged, type ROTATE to change the database: " answer
[ "$answer" = "ROTATE" ] || { echo "Stopped. Nothing in the database changed. Discard the staged Railway changes and delete $OUT."; exit 1; }

SQL="begin;"
for l in "${LOGINS[@]}"; do SQL+=$(printf "\nALTER ROLE %s PASSWORD '%s';" "$l" "${PW[$l]}"); done
for m in "${MODULES[@]}"; do
  HASH=$(printf '%s' "${SECRET[$m]}" | sha256sum | cut -d' ' -f1)
  SQL+=$(printf "\nupdate platform.modules set client_secret_hash = '%s' where id = '%s';" "$HASH" "${m,,}")
done
SQL+=$(printf "\nALTER ROLE \"%s\" PASSWORD '%s';\ncommit;" "$SUPERUSER" "$SUPERUSER_PW")
# The SQL goes through stdin, so no password appears in the process list or the shell history.
printf '%s\n' "$SQL" | psql "$PLANTOPS_URL" -q -v ON_ERROR_STOP=1 >/dev/null

cp "$LOCAL" "$OLD"
node -e '
  const fs = require("fs");
  const [file, owner, backup, ...pairs] = process.argv.slice(1);
  const set = { DATABASE_URL_OWNER: owner, DATABASE_URL_BACKUP: backup };
  for (let i = 0; i < pairs.length; i += 2) set[`MODULE_SECRET_${pairs[i]}`] = pairs[i + 1];
  const lines = fs.readFileSync(file, "utf8").split("\n").map((line) => {
    const key = line.split("=")[0];
    return key in set ? `${key}=${set[key]}` : line;
  });
  fs.writeFileSync(file, lines.join("\n"));
' "$LOCAL" "$(outer plantops_owner)" "$(outer plantops_backup)" $(for m in "${MODULES[@]}"; do printf '%s %s ' "$m" "${SECRET[$m]}"; done)

echo
echo "Step 2 done: database passwords and module secrets changed; $LOCAL updated (old copy: $OLD)."
echo "Now: deploy the staged changes in Railway, update GitHub and cron-job.org from $OUT, save the new"
echo "$LOCAL in the password manager, then delete $OUT and $OLD."
