// "Copy as WhatsApp message" on the Pending tab: the orders someone ticked, as one message for the day's delivery
// (owner, 2026-10-14). *bold* is WhatsApp's own formatting. Amounts only when this person may see them: for plant staff
// the server never sends them, so they can't appear here.
import type { LineView } from "./history";
import { money } from "./money";

export interface CopyOrder {
  ref: string;
  customer: string;
  /** 10 digits */
  phone: string;
  place: string;
  note: string | null;
  lines: LineView[];
  /** null = hidden from this person */
  total: string | null;
}

const dayText = (now: Date) => new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short" }).format(now);
const phoneText = (p: string) => `+91 ${p.slice(0, 5)} ${p.slice(5)}`;

/**
 * "*Total to load*": each product's quantity added up over the ticked orders, A–Z (owner, 2026-10-19). Quantities
 * only, so plant staff get it too. A product sold in two units (its unit changed between orders) gets a line per unit.
 */
function loadTotals(orders: CopyOrder[]): string {
  const totals = new Map<string, { product: string; unit: string; quantity: number }>();
  for (const l of orders.flatMap((o) => o.lines)) {
    const key = `${l.sku_id}\u0000${l.unit}`;
    const t = totals.get(key);
    if (t) t.quantity += l.quantity;
    else totals.set(key, { product: l.product, unit: l.unit, quantity: l.quantity });
  }
  const rows = [...totals.values()].sort((a, b) => a.product.localeCompare(b.product, "en-IN") || a.unit.localeCompare(b.unit));
  return ["*Total to load*", ...rows.map((t) => `- ${t.product}: ${t.quantity.toLocaleString("en-IN")} ${t.unit}`)].join("\n");
}

/**
 * "*Delivery – 14 Oct – 2 orders*", then one block per order (in the order given: the list's oldest first):
 * ref + customer, phone + place, a line per product with its rate ("× ₹120"), the note and the order's amount. No
 * grand total at the end (owner, 2026-10-17); instead the quantity to load per product (owner, 2026-10-19).
 */
export function whatsappText(orders: CopyOrder[], now = new Date()): string {
  const n = orders.length;
  const parts = [`*Delivery – ${dayText(now)} – ${n} order${n === 1 ? "" : "s"}*`];
  for (const o of orders) {
    const block = [
      `*${o.ref}* · ${o.customer}`,
      `${phoneText(o.phone)} · ${o.place}`,
      ...o.lines.map((l) => `- ${l.product}: ${l.quantity.toLocaleString("en-IN")} ${l.unit}${l.rate === null ? "" : ` × ${money(l.rate)}`}`),
    ];
    if (o.note) block.push(`Note: ${o.note}`);
    if (o.total !== null) block.push(`Amount: ${money(o.total)}`);
    parts.push(block.join("\n"));
  }
  if (n > 0) parts.push(loadTotals(orders));
  return parts.join("\n\n");
}
