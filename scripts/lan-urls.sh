#!/usr/bin/env bash
# Phone testing on the same Wi-Fi: prints the addresses to put in .env and on the super_admin Modules screen.
# Needs WSL "mirrored" networking (see README "Testing on your phone").
set -euo pipefail

mode=$(wslinfo --networking-mode 2>/dev/null || echo unknown)
if [[ "$mode" != "mirrored" ]]; then
  echo "WSL networking is '$mode', so phones can't reach this PC yet."
  echo "Do the one-time Windows setup in README.md -> 'Testing on your phone', then run this again."
  exit 1
fi

ip=$(ip -4 route get 1.1.1.1 2>/dev/null | awk '{for (i = 1; i <= NF; i++) if ($i == "src") print $(i + 1)}')
if [[ -z "$ip" ]]; then
  echo "Could not find this PC's Wi-Fi address. Is it connected to Wi-Fi?"
  exit 1
fi

cat <<OUT
This PC's Wi-Fi address: $ip

1. In .env, set:
     PLATFORM_URL=http://$ip:3000
     MODULE_URL_LAB_RECORDS=http://$ip:3001
     MODULE_URL_FLOOR_STOCK=http://$ip:3002

2. Start with:   pnpm dev:lan

3. As super_admin, open http://$ip:3000/super/modules and set these URLs:
     Lab Records  -> http://$ip:3001
     Floor Stock  -> http://$ip:3002
   (or run: pnpm db:seed)

4. On the phone (same Wi-Fi), open:   http://$ip:3000
   Lab Records direct link:           http://$ip:3001

Back to this PC only: put the localhost addresses back in .env (and the Modules screen / pnpm db:seed).
OUT
