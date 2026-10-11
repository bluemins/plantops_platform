#!/usr/bin/env bash
# One-time: creates the read-only backup login for a hosted copy (docs/HANDBOOK.md "Backups"). Example:
#   ./scripts/setup-backup-login.sh shared
# - Asks for the copy's Railway Postgres address (DATABASE_PUBLIC_URL); only the superuser can create logins.
# - Creates `plantops_backup` (scripts/setup-backup-login.sql) and gives it SELECT on every schema
#   (scripts/backup-grants.sql, as plantops_owner).
# - Adds DATABASE_URL_BACKUP to .env.railway.<copy>; copy that value into GitHub as the secret of the same name.
# Running it again sets a new password (then update the GitHub secret too).
set -euo pipefail
cd "$(dirname "$0")/.."

COPY="${1:-}"
[[ "$COPY" =~ ^[a-z0-9-]+$ ]] || { echo "Usage: $0 <copy-name>   e.g. $0 shared"; exit 1; }
FILE=".env.railway.$COPY"
[ -f "$FILE" ] || { echo "$FILE not found - restore it from your password manager first."; exit 1; }
command -v psql >/dev/null || { echo "psql is not installed (sudo apt install postgresql-client)"; exit 1; }
OWNER_URL=$(grep -E '^DATABASE_URL_OWNER=' "$FILE" | cut -d= -f2-)
[ -n "$OWNER_URL" ] || { echo "DATABASE_URL_OWNER missing in $FILE"; exit 1; }

echo "Railway > Postgres service > Variables > DATABASE_PUBLIC_URL (input hidden):"
read -rs ADMIN_URL; echo
[[ "$ADMIN_URL" =~ ^postgres(ql)?:// ]] || { echo "That does not look like a postgres:// address"; exit 1; }

PW=$(openssl rand -hex 16)
echo "Creating the backup login..."
psql "$ADMIN_URL" -q -v ON_ERROR_STOP=1 -v pw="$PW" -f scripts/setup-backup-login.sql
echo "Giving it read access to every schema..."
psql "$OWNER_URL" -q -v ON_ERROR_STOP=1 -f scripts/backup-grants.sql

BACKUP_URL=$(node -e 'const u=new URL(process.argv[1]); u.username="plantops_backup"; u.password=process.argv[2]; process.stdout.write(u.toString())' "$OWNER_URL" "$PW")
echo "Checking it can read but not write..."
psql "$BACKUP_URL" -Atq -v ON_ERROR_STOP=1 -c "select count(*) from platform.tenants" >/dev/null
if psql "$BACKUP_URL" -q -c "create table platform.backup_write_test (x int)" >/dev/null 2>&1; then
  echo "ERROR: the backup login could write - stop and check scripts/setup-backup-login.sql"; exit 1
fi

umask 077
grep -v '^DATABASE_URL_BACKUP=' "$FILE" > "$FILE.tmp"
echo "DATABASE_URL_BACKUP=$BACKUP_URL" >> "$FILE.tmp"
mv "$FILE.tmp" "$FILE"

echo
echo "Done. DATABASE_URL_BACKUP is now in $FILE."
echo "Copy that value into GitHub > Settings > Environments > $COPY > secret DATABASE_URL_BACKUP,"
echo "and update the password manager copy of $FILE."
