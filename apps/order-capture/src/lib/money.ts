// Money in Order Capture: rupees with at most 2 decimals, worked out in whole paise (BigInt) so no paisa is ever
// lost to rounding (3 × ₹33.33 = ₹99.99 exactly) and even 100,000 × ₹9,99,99,999.99 stays exact.
import { RATE_RE } from "./rates";

/** "90" / "92.5" / "92.50" -> 9250n. Only for text that passed RATE_RE (or a numeric(…, 2) value from the database). */
export function toPaise(rupees: string): bigint {
  const [whole, frac = ""] = rupees.trim().split(".");
  return BigInt(whole!) * 100n + BigInt((frac + "00").slice(0, 2));
}

/** 51000n -> "510.00" (what the database stores). */
export const fromPaise = (paise: bigint) => `${paise / 100n}.${String(paise % 100n).padStart(2, "0")}`;

/** quantity × rate, in paise. */
export const lineTotal = (quantity: number, rate: string) => BigInt(quantity) * toPaise(rate);

/** "₹510", "₹99.99", "₹1,25,000" (Indian grouping); the paise only when there are some. */
export function money(rupees: string | bigint) {
  const p = typeof rupees === "bigint" ? rupees : toPaise(rupees);
  const whole = (p / 100n).toLocaleString("en-IN");
  return p % 100n === 0n ? `₹${whole}` : `₹${whole}.${String(p % 100n).padStart(2, "0")}`;
}

/** Is this typed rate usable? (blank is not: an order line needs a rate) */
export const isRate = (typed: string) => RATE_RE.test(typed.trim());

/** Quantities added up per unit, for the footer: "4 box", "3 box + 6 jar". */
export function unitsText(lines: { quantity: number; unit: string }[]) {
  const per = new Map<string, number>();
  for (const l of lines) if (l.quantity > 0) per.set(l.unit, (per.get(l.unit) ?? 0) + l.quantity);
  return [...per].map(([unit, n]) => `${n.toLocaleString("en-IN")} ${unit}`).join(" + ");
}
