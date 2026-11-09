// Due per brand for Drop (docs/CUSTOMER_APP_PHASE_PLAN.md "Home", decision D3). Each unpaid bill's due is split by the
// brands' share of that bill's line values (a bill with only Bluemins lines is all Bluemins). A line with no brand
// (20 L when it has its own brand, empties, connection) goes to its own brand or to "Other" (key ''), never shown. A bill
// with no line value (a Zoho opening balance) counts to the plant's main brand (owner, 2026-11-09). Exact paise: the
// leftover paisa of a split goes to the brand with the largest share, so the parts always add up to the bill's due.
// An unused advance is not taken off (the app shows what is due on bills). Pure; nothing stored.
import { brandKey } from "./brand";

export type DueBill = {
  /** what is still due on the bill (billDue); ≤ 0 = nothing */
  due: bigint;
  /** each line's value (with GST) and its brand ('' = no brand) */
  lines: { brand: string; value: bigint }[];
};

/** Due per brand key (lower case; '' = Other). */
export function brandDues(bills: DueBill[], mainBrand: string): Map<string, bigint> {
  const out = new Map<string, bigint>();
  const put = (k: string, v: bigint) => out.set(k, (out.get(k) ?? 0n) + v);
  for (const b of bills) {
    if (b.due <= 0n) continue;
    const values = new Map<string, bigint>();
    for (const l of b.lines) if (l.value > 0n) values.set(brandKey(l.brand), (values.get(brandKey(l.brand)) ?? 0n) + l.value);
    const total = [...values.values()].reduce((s, v) => s + v, 0n);
    if (total === 0n) {
      put(brandKey(mainBrand), b.due);
      continue;
    }
    // largest share first (ties by name), so the leftover goes to it
    const parts = [...values.entries()].sort((x, y) => (y[1] > x[1] ? 1 : y[1] < x[1] ? -1 : x[0].localeCompare(y[0])));
    let given = 0n;
    for (const [k, v] of parts) {
      const share = (b.due * v) / total;
      put(k, share);
      given += share;
    }
    put(parts[0]![0], b.due - given);
  }
  return out;
}
