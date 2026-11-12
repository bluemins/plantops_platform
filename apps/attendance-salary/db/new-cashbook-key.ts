// Makes a new key for the cash book link (Sales → Attendance advances, docs/CASHBOOK_PHASE_PLAN.md section 9 C4). Prints
// the COMPLETE value for both services (docs/STABILITY_PLAN.md section 6 item 5: always the whole value, never a fragment):
//   attendance-salary  ATTEND_CASHBOOK_KEYS   a list of { id, tenant_id, sha256, label } (only the key's SHA-256)
//   order-capture      ATTEND_CASHBOOK_KEYS   { "<plant tenant uuid>": "atc_…" } (the key itself; Sales sends it)
//   pnpm --filter attendance-salary cashbook:key <plant tenant uuid> [label]
// With the current values in the shell (ATTEND_CASHBOOK_KEYS='…' SALES_CASHBOOK_KEYS='…' pnpm …) the new key is added to
// them; else each is a value of one. Rotation: add the new entry to Attendance (both work), replace the plant's key in
// Sales, check one advance arrives, then remove the old entry from Attendance.
import { randomBytes, randomUUID } from "node:crypto";
import { hashCashbookKey } from "../src/server/cashbook";

const [tenantId, label = "Sales cash book"] = process.argv.slice(2);
if (!tenantId || !/^[0-9a-f-]{36}$/i.test(tenantId)) {
  console.error("Usage: pnpm --filter attendance-salary cashbook:key <plant tenant uuid> [label]");
  process.exit(1);
}
function current<T>(name: string, list: boolean): T {
  const raw = process.env[name]?.trim();
  if (!raw) return (list ? [] : {}) as T;
  try {
    const value: unknown = JSON.parse(raw);
    if (list !== Array.isArray(value) || typeof value !== "object" || value === null) throw new Error(list ? "not a list" : "not an object");
    return value as T;
  } catch (err) {
    console.error(`${name} in this shell is not valid JSON (${(err as Error).message}); fix it or leave it unset.`);
    process.exit(1);
  }
}
const attend = current<unknown[]>("ATTEND_CASHBOOK_KEYS", true);
const sales = current<Record<string, string>>("SALES_CASHBOOK_KEYS", false);
const key = `atc_${randomBytes(32).toString("base64url")}`;
const entry = { id: randomUUID(), tenant_id: tenantId, sha256: hashCashbookKey(key), label };
console.log("\n1. attendance-salary → ATTEND_CASHBOOK_KEYS. Replace the whole variable with:\n");
console.log(`  ${JSON.stringify([...attend, entry])}\n`);
console.log("2. order-capture → ATTEND_CASHBOOK_KEYS (holds the key itself; never paste it anywhere else). Replace the whole variable with:\n");
console.log(`  ${JSON.stringify({ ...sales, [tenantId]: key })}\n`);
console.log("3. order-capture → ATTEND_URL = Attendance's address, e.g. https://attendance.bluemins.life\n");
