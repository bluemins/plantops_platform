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
  rate: string;
  total: string;
}

const qtyText = (l: Pick<LineView, "quantity" | "unit">) => `${l.quantity.toLocaleString("en-IN")} ${l.unit}`;

/** "500ml 1 box, 1ltr 3 box" */
export const productsText = (lines: LineView[]) => lines.map((l) => `${l.product} ${qtyText(l)}`).join(", ");

/** What changed between two versions of an order's lines: "1ltr: 2 box → 3 box · added Jar 6 jar at ₹50 · total ₹370 → ₹510". */
export function versionDiff(before: LineView[], after: LineView[], totalBefore: string, totalAfter: string) {
  const parts: string[] = [];
  const old = new Map(before.map((l) => [l.sku_id, l]));
  for (const l of after) {
    const was = old.get(l.sku_id);
    if (!was) {
      parts.push(`added ${l.product} ${qtyText(l)} at ${money(l.rate)}`);
      continue;
    }
    const bits: string[] = [];
    if (was.quantity !== l.quantity) bits.push(`${qtyText(was)} → ${qtyText(l)}`);
    if (was.rate !== l.rate) bits.push(`rate ${money(was.rate)} → ${money(l.rate)}`);
    if (bits.length) parts.push(`${l.product}: ${bits.join(", ")}`);
  }
  for (const l of before) if (!after.some((a) => a.sku_id === l.sku_id)) parts.push(`removed ${l.product}`);
  if (totalBefore !== totalAfter) parts.push(`total ${money(totalBefore)} → ${money(totalAfter)}`);
  return parts.join(" · ");
}

export type EventKind = "created" | "changed" | "delivered" | "undelivered" | "cancelled";
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
  total: string;
}

const versionTotal = (v: VersionView | undefined) => v?.total ?? "0";

/** One history line: its title ("Changed by Atharv") and what happened ("1ltr: 2 box → 3 box · total ₹370 → ₹510"). */
export function eventText(e: EventView, versions: VersionView[]): { title: string; detail: string } {
  const v = (n: number) => versions.find((x) => x.version === n);
  switch (e.kind) {
    case "created": {
      const first = v(e.version);
      const n = first?.lines.length ?? 0;
      return { title: `Created by ${e.by}`, detail: `${n} product${n === 1 ? "" : "s"} · ${money(versionTotal(first))}` };
    }
    case "changed": {
      const before = v(e.version - 1);
      const after = v(e.version);
      return { title: `Changed by ${e.by}`, detail: before && after ? versionDiff(before.lines, after.lines, before.total, after.total) : `version ${e.version}` };
    }
    case "delivered":
      return { title: `Delivered by ${e.by}`, detail: [e.text, e.invoice_no ? `Zoho invoice ${e.invoice_no}` : null].filter(Boolean).join(" · ") };
    case "undelivered":
      return { title: `Delivery undone by ${e.by}`, detail: e.text ?? "" };
    case "cancelled":
      return { title: `Cancelled by ${e.by}`, detail: e.text ?? "" };
  }
}
