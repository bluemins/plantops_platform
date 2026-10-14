// "Copy as WhatsApp message" on the Pending tab: the orders someone ticked, as one message for the day's delivery
// (owner, 2026-10-14). *bold* is WhatsApp's own formatting. Amounts only when this person may see them: for plant staff
// the server never sends them, so they can't appear here.
import type { LineView } from "./history";
import { money, toPaise, fromPaise } from "./money";

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
 * "*Delivery – 14 Oct – 2 orders*", then one block per order (in the order given: the list's oldest first):
 * ref + customer, phone + place, a line per product, the note, and the amount; a grand total at the end.
 */
export function whatsappText(orders: CopyOrder[], now = new Date()): string {
  const n = orders.length;
  const parts = [`*Delivery – ${dayText(now)} – ${n} order${n === 1 ? "" : "s"}*`];
  for (const o of orders) {
    const block = [`*${o.ref}* · ${o.customer}`, `${phoneText(o.phone)} · ${o.place}`, ...o.lines.map((l) => `- ${l.product}: ${l.quantity.toLocaleString("en-IN")} ${l.unit}`)];
    if (o.note) block.push(`Note: ${o.note}`);
    if (o.total !== null) block.push(`Amount: ${money(o.total)}`);
    parts.push(block.join("\n"));
  }
  if (n > 0 && orders.every((o) => o.total !== null)) {
    parts.push(`*Total: ${money(fromPaise(orders.reduce((s, o) => s + toPaise(o.total!), 0n)))}*`);
  }
  return parts.join("\n\n");
}
