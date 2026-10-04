#!/usr/bin/env bash
# Applies new database migrations to one hosted PlantOps copy, from this computer. See docs/DEPLOY.md.
#   ./scripts/railway-migrate.sh shared          migrations only (every release that adds a migration)
#   ./scripts/railway-migrate.sh shared --seed   also super_admin + module registrations (first setup)
# Reads .env.railway.<copy> (written by setup-railway-db.sh) INSTEAD of the local .env, so no local value
# (e.g. a dev module address) can reach the hosted copy.
set -euo pipefail
cd "$(dirname "$0")/.."

COPY="${1:-}"
[[ "$COPY" =~ ^[a-z0-9-]+$ ]] || { echo "Usage: $0 <copy-name> [--seed]"; exit 1; }
FILE="$PWD/.env.railway.$COPY"
[ -f "$FILE" ] || { echo "$FILE not found - restore it from your password manager first."; exit 1; }
export PLANTOPS_ENV_FILE="$FILE"

echo "Migrating copy \"$COPY\"..."
pnpm db:migrate
if [ "${2:-}" = "--seed" ]; then pnpm db:seed; fi
