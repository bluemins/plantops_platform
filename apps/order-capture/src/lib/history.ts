// How old a pending order is, and an order's history in plain words (the order page, the list cards). Pure, so the
// boundaries and texts are tested without a database.
import { money } from "./money";

/** A pending order this many whole days old (or older) shows amber (the mock-up shows "2 days" amber). */
export const AMBER_AFTER_DAYS = 2;
const DAY = 24 * 60 * 60 * 1000;

/** Whole 24-hour periods since the order was entered: "Today", "1 day", "3 days" (amber from 2). */
export function ageOf(createdAt: Date | string, now = Date.now()) {
  const days = Math.max(0, Math.floor((now - new Date(createdAt).getTime()) / DAY));
  return { days, amber: days >= AMBER_AFTER_DAYS, text: days === 0 ? "Today" : days === 1 ? "1 day" : `${days} days` };
}

export interface LineView {
  sku_id: string;
  product: string;
  unit: string;
  quantity: number;
  /** null = hidden from this person (plant staff never see amounts) */
  rate: string | null;
  total: string | null;
  /**
   * A free line (scheme, e.g. "12 + 1 free"; migration 0011): never charged, total always 0; `rate` is what the
   * customer would have paid, shown only as what the free boxes are worth.
   */
  free: boolean;
}

/** A line's identity within one version: each product at most once paid and once free. */
export const lineKey = (l: Pick<LineView, "sku_id" | "free">) => `${l.sku_id}${l.free ? ":free" : ""}`;

/** A line whose amounts are known (the change screen: only people who may see amounts can change an order). */
export type PricedLine = LineView & { rate: string; total: string };
export function priced(lines: LineView[]): PricedLine[] {
  return lines.map((l) => {
    if (l.rate === null || l.total === null) throw new Error("This order's amounts are hidden from this person");
    return { ...l, rate: l.rate, total: l.total };
  });
}

/** The same lines without rates and amounts (plant staff never see them). */
export const withoutAmounts = (lines: LineView[]): LineView[] => lines.map((l) => ({ ...l, rate: null, total: null }));

const qtyText = (l: Pick<LineView, "quantity" | "unit">) => `${l.quantity.toLocaleString("en-IN")} ${l.unit}`;

/** "500ml 1 box, 1ltr 3 box, 1ltr 1 box free" */
export const productsText = (lines: Pick<LineView, "product" | "quantity" | "unit" | "free">[]) =>
  lines.map((l) => `${l.product} ${qtyText(l)}${l.free ? " free" : ""}`).join(", ");

/** Everything that leaves the plant, paid + free added up per product and unit: "13 box Bluemins 1L, 2 box Bluemins 500ml". */
export function loadText(lines: Pick<LineView, "sku_id" | "product" | "quantity" | "unit">[]) {
  const t = new Map<string, { product: string; unit: string; quantity: number }>();
  for (const l of lines) {
    const k = `${l.sku_id}\u0000${l.unit}`;
    const x = t.get(k);
    if (x) x.quantity += l.quantity;
    else t.set(k, { product: l.product, unit: l.unit, quantity: l.quantity });
  }
  return [...t.values()].map((x) => `${qtyText(x)} ${x.product}`).join(", ");
}

/** Free boxes in words: "1 box free (Bluemins 1L)"; "" when none. */
export function freeText(lines: Pick<LineView, "product" | "quantity" | "unit" | "free">[]) {
  const free = lines.filter((l) => l.free);
  return free.length ? `+ ${free.map((l) => `${qtyText(l)} free (${l.product})`).join(", ")}` : "";
}

/** What changed between two versions of an order's lines: "1ltr: 2 box → 3 box · added Jar 6 jar at ₹50 · total ₹370 → ₹510". */
export function versionDiff(before: LineView[], after: LineView[], totalBefore: string | null, totalAfter: string | null) {
  const parts: string[] = [];
  const old = new Map(before.map((l) => [lineKey(l), l]));
  const name = (l: LineView) => `${l.product}${l.free ? " (free)" : ""}`;
  for (const l of after) {
    const was = old.get(lineKey(l));
    if (!was) {
      parts.push(l.free ? `added ${l.product} ${qtyText(l)} free` : `added ${l.product} ${qtyText(l)}${l.rate === null ? "" : ` at ${money(l.rate)}`}`);
      continue;
    }
    const bits: string[] = [];
    if (was.quantity !== l.quantity) bits.push(`${qtyText(was)} → ${qtyText(l)}`);
    if (!l.free && was.rate !== null && l.rate !== null && was.rate !== l.rate) bits.push(`rate ${money(was.rate)} → ${money(l.rate)}`);
    if (bits.length) parts.push(`${name(l)}: ${bits.join(", ")}`);
  }
  for (const l of before) if (!after.some((a) => lineKey(a) === lineKey(l))) parts.push(`removed ${name(l)}`);
  if (totalBefore !== null && totalAfter !== null && totalBefore !== totalAfter) parts.push(`total ${money(totalBefore)} → ${money(totalAfter)}`);
  return parts.join(" · ");
}

export type EventKind = "created" | "changed" | "delivered" | "undelivered" | "cancelled" | "note";
export interface EventView {
  kind: EventKind;
  version: number;
  text: string | null;
  invoice_no: string | null;
  by: string;
  at: string;
}
export interface VersionView {
  version: number;
  lines: LineView[];
  /** null = hidden from this person */
  total: string | null;
}

/** One history line: its title ("Changed by Atharv") and what happened ("1ltr: 2 box → 3 box · total ₹370 → ₹510"). */
export function eventText(e: EventView, versions: VersionView[]): { title: string; detail: string } {
  const v = (n: number) => versions.find((x) => x.version === n);
  switch (e.kind) {
    case "created": {
      const first = v(e.version);
      const n = first?.lines.length ?? 0;
      const total = first ? first.total : "0";
      return { title: `Created by ${e.by}`, detail: `${n} product${n === 1 ? "" : "s"}${total === null ? "" : ` · ${money(total)}`}` };
    }
    case "changed": {
      const before = v(e.version - 1);
      const after = v(e.version);
      return { title: `Changed by ${e.by}`, detail: (before && after && versionDiff(before.lines, after.lines, before.total, after.total)) || `version ${e.version}` };
    }
    case "delivered":
      return { title: `Delivered by ${e.by}`, detail: [e.text, e.invoice_no ? `Zoho invoice ${e.invoice_no}` : null].filter(Boolean).join(" · ") };
    case "undelivered":
      return { title: `Delivery undone by ${e.by}`, detail: e.text ?? "" };
    case "cancelled":
      return { title: `Cancelled by ${e.by}`, detail: e.text ?? "" };
    case "note":
      return { title: `Note by ${e.by}`, detail: e.text ?? "" };
  }
}

/** The WhatsApp thank-you's history line (src/server/thanks.ts). */
export function thanksText(m: { status: "pending" | "sent" | "failed"; error: string | null; by: string }): { title: string; detail: string } {
  switch (m.status) {
    case "sent":
      return { title: "WhatsApp thank-you sent", detail: `Ticked by ${m.by}` };
    case "pending":
      return { title: "WhatsApp thank-you waiting to send", detail: m.error ? `Will try again: ${m.error}` : `Ticked by ${m.by}` };
    case "failed":
      return { title: "WhatsApp thank-you not sent", detail: m.error ?? "" };
  }
}
