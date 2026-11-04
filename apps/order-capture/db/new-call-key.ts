// Makes a new key for the order phone (docs/CALLS_PHASE_PLAN.md). Prints the key ONCE (for MacroDroid's HTTP header
// `Authorization: Bearer occ_…`) and the COMPLETE value for order-capture's ORDER_CALL_KEYS, which holds only its
// SHA-256 (docs/STABILITY_PLAN.md section 6 item 5: always the whole value, never a fragment).
//   pnpm --filter order-capture call:key <plant tenant uuid> [label]
// With the current value in the shell (ORDER_CALL_KEYS='…' pnpm …) the new entry is added to it; else it is a list of one.
// Rotation: add the new entry next to the old one (both work) → put the new key in MacroDroid → test call → remove the old.
import { randomBytes, randomUUID } from "node:crypto";
import { hashCallKey } from "../src/server/calls";

const [tenantId, label = "Order phone"] = process.argv.slice(2);
if (!tenantId || !/^[0-9a-f-]{36}$/i.test(tenantId)) {
  console.error("Usage: pnpm --filter order-capture call:key <plant tenant uuid> [label]");
  process.exit(1);
}
let current: unknown[] = [];
const raw = process.env.ORDER_CALL_KEYS?.trim();
if (raw) {
  try {
    const value: unknown = JSON.parse(raw);
    if (!Array.isArray(value)) throw new Error("not a list");
    current = value;
  } catch (err) {
    console.error(`ORDER_CALL_KEYS in this shell is not a JSON list (${(err as Error).message}); fix it or leave it unset.`);
    process.exit(1);
  }
}
const key = `occ_${randomBytes(32).toString("base64url")}`;
const entry = { id: randomUUID(), tenant_id: tenantId, sha256: hashCallKey(key), label };
console.log("\nKey for the order phone (MacroDroid → HTTP request → header Authorization: Bearer <key>). Shown once, never stored:\n");
console.log(`  ${key}\n`);
console.log(`Complete value for order-capture's ORDER_CALL_KEYS (${current.length ? `your ${current.length} current entr${current.length === 1 ? "y" : "ies"} + the new one` : "the only entry"}). Replace the whole variable with:\n`);
console.log(`  ${JSON.stringify([...current, entry])}\n`);
