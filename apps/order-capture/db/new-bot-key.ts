// Makes a new WhatsApp bot key (docs/WHATSAPP_CONTRACT.md 3.6). Prints the key ONCE (for the bot's Railway variable
// ORDER_CAPTURE_BOT_KEY) and the entry to add to ORDER_BOT_KEYS on order-capture, which holds only its SHA-256.
//   pnpm --filter order-capture bot:key <plant tenant uuid> [label]
// Rotation: add the new entry next to the old one (both work) → set the new key on the bot → check → remove the old entry.
import { randomBytes, randomUUID } from "node:crypto";
import { hashBotKey } from "../src/server/bot";

const [tenantId, label = "WhatsApp bot"] = process.argv.slice(2);
if (!tenantId || !/^[0-9a-f-]{36}$/i.test(tenantId)) {
  console.error("Usage: pnpm --filter order-capture bot:key <plant tenant uuid> [label]");
  process.exit(1);
}
const key = `ocb_${randomBytes(32).toString("base64url")}`;
const entry = { id: randomUUID(), tenant_id: tenantId, sha256: hashBotKey(key), label, products: ["PV_BM_1", "PV_BM_500", "PV_BM_250"] };
console.log("\nKey for the bot (Railway → whatsappbot → ORDER_CAPTURE_BOT_KEY). Shown once, never stored here:\n");
console.log(`  ${key}\n`);
console.log("Entry for order-capture's ORDER_BOT_KEYS (a JSON list; keep other entries while rotating). Check `products`:\n");
console.log(`  ${JSON.stringify(entry)}\n`);
