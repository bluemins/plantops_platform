#!/usr/bin/env bash
# End-to-end check of the SSO handoff against a running platform (pnpm dev), pretending to be a module.
# Usage: scripts/sso-smoke.sh PLANT_CODE USERNAME SECRET [MODULE]
# The module must be registered first (MODULE_URL_LAB_RECORDS / MODULE_SECRET_LAB_RECORDS in .env, then pnpm db:seed).
set -euo pipefail
cd "$(dirname "$0")/.."
set -a; source .env; set +a

PLANT=$1 USERNAME=$2 SECRET=$3 MODULE=${4:-lab_records}
MODULE_SECRET_VAR="MODULE_SECRET_${MODULE^^}"
MODULE_SECRET=${!MODULE_SECRET_VAR:?set $MODULE_SECRET_VAR in .env}
BASE=${PLATFORM_URL:-http://localhost:3000}
JAR=$(mktemp); trap 'rm -f "$JAR"' EXIT

echo "1. log in as $USERNAME"
curl -sf -c "$JAR" -H 'content-type: application/json' \
  -d "{\"plant_code\":\"$PLANT\",\"username\":\"$USERNAME\",\"secret\":\"$SECRET\"}" "$BASE/api/auth/login"; echo

echo "2. tap the $MODULE tile -> one-time code"
REDIRECT=$(curl -sf -b "$JAR" -H 'content-type: application/json' -d "{\"module\":\"$MODULE\"}" "$BASE/api/sso/handoff" | node -pe 'JSON.parse(require("fs").readFileSync(0)).redirect_url')
echo "   $REDIRECT"
CODE=$(node -pe 'new URL(process.argv[1]).searchParams.get("code")' "$REDIRECT")

echo "3. module server exchanges the code for a token"
TOKEN=$(curl -sf -u "$MODULE:$MODULE_SECRET" -H 'content-type: application/json' -d "{\"code\":\"$CODE\"}" "$BASE/api/sso/exchange" | node -pe 'JSON.parse(require("fs").readFileSync(0)).token')

echo "4. module verifies the token with the platform's public key"
cd apps/platform && npx tsx -e "
import { verifyToken } from '@plantops/auth';
verifyToken(process.argv[1], { audience: '$MODULE', keys: { jwksUrl: '$BASE/.well-known/jwks.json' } })
  .then((p) => console.log('   verified:', JSON.stringify(p, null, 2)));
" "$TOKEN"

echo "5. the same code again must fail"
STATUS=$(curl -s -o /dev/null -w '%{http_code}' -u "$MODULE:$MODULE_SECRET" -H 'content-type: application/json' -d "{\"code\":\"$CODE\"}" "$BASE/api/sso/exchange")
echo "   reused code -> HTTP $STATUS (expected 400)"
