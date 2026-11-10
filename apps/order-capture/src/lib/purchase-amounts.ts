// A purchase bill's amounts (docs/PURCHASES_PHASE_PLAN.md, P2): the same maths on the screen (live totals) and on the
// server (what is saved). GST is added on top of the rates (vendors' bills are like Zoho's, never inclusive); CGST + SGST
// when the vendor is in the plant's state, IGST otherwise. Whole paise throughout.
import { billAmounts, paise } from "./ledger";

/** quantity (up to 3 decimals) × rate (rupees, up to 2 decimals) → paise, rounded half up. */
export function lineAmount(quantity: string, rate: string): bigint {
  const [w, f = ""] = quantity.split(".");
  const milli = BigInt(w || "0") * 1000n + BigInt((f + "000").slice(0, 3));
  return (2n * milli * paise(rate) + 1000n) / 2000n;
}

export function purchaseAmounts(lines: { quantity: string; rate: string; gst_rate: number }[], adjustment: bigint, intra: boolean) {
  return billAmounts(lines.map((l) => ({ amount: lineAmount(l.quantity, l.rate), discount: 0n, gst_rate: l.gst_rate })), 0n, adjustment, { inclusive: false, intra });
}

/** Same state (or not known) → CGST + SGST; another state → IGST. */
export const isIntraState = (vendorState: string | null, plantState: string | null) => !vendorState || !plantState || vendorState === plantState;
