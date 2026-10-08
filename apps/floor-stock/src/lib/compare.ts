// What went out, worked out from two counts (never stored, approved 2026-10-04):
//   finished goods:  Sold = previous closing + today's production − today's closing  (negative: "check the count")
//   everything else: Used = previous closing − today's closing                      (negative: received)
// Only the day directly before counts as "previous": with a day missing in between, nothing is compared.
// Quantities have at most 2 decimals; the sums are done in hundredths so 0.1 + 0.2 stays 0.3.

export type Comparison =
  | { kind: "sold" | "used" | "received" | "check"; value: number }
  | { kind: "no_previous_count" } // nothing counted on the day before
  | { kind: "new_item" } // the item wasn't in the day before's count
  | { kind: "unit_changed"; from: string; to: string };

const cents = (n: number) => Math.round(n * 100);
const back = (c: number) => c / 100;

/** Adds quantities exactly (2 decimals). */
export const sum = (values: number[]) => back(values.reduce((s, v) => s + cents(v), 0));

export function compare(input: {
  finished: boolean;
  /** was there a count on the day before at all? */
  previousCounted: boolean;
  /** the item's closing stock that day (null = not in that count) */
  previous: { qty: number; unit: string } | null;
  production: number;
  closing: number;
  unit: string;
}): Comparison {
  if (!input.previousCounted) return { kind: "no_previous_count" };
  if (!input.previous) return { kind: "new_item" };
  if (input.previous.unit.trim().toLowerCase() !== input.unit.trim().toLowerCase()) return { kind: "unit_changed", from: input.previous.unit, to: input.unit };
  if (input.finished) {
    const sold = cents(input.previous.qty) + cents(input.production) - cents(input.closing);
    return sold < 0 ? { kind: "check", value: back(-sold) } : { kind: "sold", value: back(sold) };
  }
  const used = cents(input.previous.qty) - cents(input.closing);
  return used < 0 ? { kind: "received", value: back(-used) } : { kind: "used", value: back(used) };
}

/** Below the owner's limit (a blank limit never alerts). */
export const isLow = (closing: number, minLevel: number | null) => minLevel !== null && cents(closing) < cents(minLevel);

/** "12.5" / "12" - quantities without trailing zeros. */
export const qty = (n: number) => String(Number(n.toFixed(2)));

/** Plain words for a comparison, as the screens and the WhatsApp text show it. */
export function comparisonText(c: Comparison, unit: string, previousDate?: string): string {
  switch (c.kind) {
    case "sold":
      return `Sold ${qty(c.value)} ${unit}`;
    case "used":
      return `Used ${qty(c.value)} ${unit}`;
    case "received":
      return `Received ${qty(c.value)} ${unit} (calculated)`;
    case "check":
      return `Check the count: ${qty(c.value)} ${unit} more than possible`;
    case "no_previous_count":
      return previousDate ? `—, no count on ${previousDate}` : "—, no count the day before";
    case "new_item":
      return "—, not counted the day before";
    case "unit_changed":
      return `Unit changed (${c.from} → ${c.to}): not compared`;
  }
}
