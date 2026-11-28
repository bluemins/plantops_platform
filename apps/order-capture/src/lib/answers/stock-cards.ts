// Plant answers Phase 4 (docs/MORNING_REPORT_PHASE_PLAN.md, owner 2026-11-28): the stock cards S1–S4. Pure: each takes
// Floor Stock's own facts (scope stock_answers: its day page, "Consumable not updated correctly", Can make and days of
// stock) and, for S1, the pending orders (the same rows as O1). Days of stock are "about" (rule 6).
import type { StockAnswers } from "@plantops/types";
import { dmy } from "../receivables";
import type { Facts, Row } from "./facts";
import type { O1Order } from "./order-cards";

/** S2: materials lasting this many days or fewer are counted as "running out soon" */
export const S2_SOON_DAYS = 7;
/** S4: items with more than this many days of stock (P4-d) */
export const S4_DAYS = 60;
/** S4 lists at most this many items */
export const S4_TOP = 10;

export type StockFacts = { state: "in"; s: StockAnswers } | { state: "off" | "unreachable" };

const qty = (n: number) => n.toLocaleString("en-IN", { maximumFractionDigits: 2 });
const sameUnit = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();
const timeOf = (iso: string) => new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", hour: "numeric", minute: "2-digit", hour12: true }).format(new Date(iso)).toLowerCase();
/** whole days, rounded down: "about 2 days" never promises more than there is */
const wholeDays = (d: number) => Math.max(0, Math.floor(d));

/** What a stock card can't check, said on the card (rule 5). Empty = Floor Stock answered. */
export function stockMissing(st: StockFacts, needHistory = false): string[] {
  if (st.state === "off") return ["Floor Stock is not switched on for this plant, so stock is not checked."];
  if (st.state !== "in") return ["Floor Stock did not answer just now, so stock is not checked. Try again in a minute."];
  if (!st.s.last_counted_on) return ["Floor Stock has no count yet."];
  if (needHistory && !st.s.history.enough) return [`Fewer than 7 stock counts in the last 28 days (${st.s.history.counted_days} so far), so days of stock can't be worked out yet.`];
  return [];
}

const empty = (totals: Row = {}): Facts => ({ totals, rows: [] });

// ---------- S1: what to make today ----------

export function s1Facts(orders: O1Order[], st: StockFacts): Facts {
  if (st.state !== "in") return empty({ make: 0, stock_on: null, pending: orders.length });
  const s = st.s;
  const need = new Map<string, { name: string; unit: string; needed: number }>();
  for (const o of orders)
    for (const l of o.lines) {
      const n = need.get(l.sku_id) ?? { name: l.name, unit: l.unit, needed: 0 };
      n.needed += l.quantity;
      need.set(l.sku_id, n);
    }
  const bySku = new Map(s.products.filter((p) => p.sku_id).map((p) => [p.sku_id!, p]));
  const rows: Row[] = [...need.entries()].map(([sku, n]) => {
    const p = bySku.get(sku);
    const base = { key: sku, product: n.name, needed: n.needed };
    if (!p || p.closing === null) return { ...base, in_stock: null, make: null, can_make: null, limit: "Not counted in Floor Stock" };
    if (!sameUnit(p.unit, n.unit)) return { ...base, in_stock: null, make: null, can_make: null, limit: `Counted in ${p.unit}, ordered in ${n.unit}` };
    const make = n.needed > p.closing ? Math.ceil(n.needed - p.closing) : 0;
    const cm = p.can_make;
    let limit = make ? "" : "Enough in stock";
    if (make && cm.state === "ok" && cm.boxes !== null && cm.boxes < make)
      limit = `Material for only ${qty(cm.boxes)} ${p.unit}${cm.limiting.length ? `: ${cm.limiting.join(", ")} runs out first` : ""}`;
    else if (make && cm.state === "ok") limit = cm.boxes !== null ? `Material enough (for ${qty(cm.boxes)} ${p.unit})` : "Material enough";
    else if (make && cm.state === "problem") limit = `Can make not known: ${cm.problems.join(", ")}`;
    else if (make) limit = "No recipe, so material isn't checked";
    return { ...base, in_stock: p.closing, make, can_make: cm.state === "ok" ? cm.boxes : null, limit, unit: p.unit, short_material: make && cm.state === "ok" && cm.boxes !== null && cm.boxes < make ? cm.limiting.join(", ") : null };
  });
  rows.sort((a, b) => Number(b.make ?? -1) - Number(a.make ?? -1) || String(a.product).localeCompare(String(b.product)));
  return {
    totals: { make: rows.filter((r) => Number(r.make) > 0).length, stock_on: s.last_counted_on, pending: orders.length },
    rows,
    notes: { stock_on: `The last Floor Stock count (${s.last_counted_on ? dmy(s.last_counted_on) : "none"}). Anything made or sent out since is not in it.` },
  };
}

// ---------- S2: when materials run out ----------

const whyText: Record<StockAnswers["materials"][number]["why"], string> = {
  ok: "",
  no_recipe: "No recipe uses it",
  not_used: "Not used in the last 28 days",
  not_enough_history: "Not enough counts yet",
  not_counted: "Not in the last count",
  measure: "Recipe and Contents measures don't match",
};

export function s2Facts(st: StockFacts): Facts {
  if (st.state !== "in") return empty({ soon: 0, stock_on: null, since: null });
  const s = st.s;
  const ok = s.materials.filter((m) => m.why === "ok" && m.days_left !== null).sort((a, b) => a.days_left! - b.days_left!);
  return {
    totals: { soon: ok.filter((m) => m.days_left! <= S2_SOON_DAYS).length, stock_on: s.last_counted_on, since: s.history.from },
    rows: ok.map((m) => ({
      key: m.item_id,
      material: m.name,
      on_hand: m.closing === null ? null : `${qty(m.closing)} ${m.unit}`,
      per_day: m.per_day === null ? null : `about ${qty(m.per_day)} ${m.unit}`,
      days_left: wholeDays(m.days_left!),
    })),
    lists: { not_worked: s.materials.filter((m) => m.why !== "ok").map((m) => ({ key: m.item_id, material: m.name, why: whyText[m.why] })) },
  };
}

// ---------- S3: was the count done, and were consumables updated ----------

export function s3Facts(st: StockFacts): Facts {
  if (st.state !== "in") return empty({ day: null, done: "Not checked", not_updated: 0 });
  const [y, t] = st.s.days;
  const day = y!;
  const today = t!;
  return {
    totals: {
      day: day.date,
      done: day.done ? "Done" : "Not done",
      by: day.by,
      at: day.counted_at ? timeOf(day.counted_at) : null,
      corrections: day.corrections,
      not_updated: day.not_updated.length,
      today: today.done ? `Done at ${timeOf(today.counted_at!)}` : "Not done yet",
    },
    rows: day.not_updated.map((m) => ({
      key: m.name,
      material: m.name,
      counted: `${qty(m.closing)} ${m.unit}`,
      expected: m.expected === null ? (m.also.length ? `${m.also.join(", ")} also unchanged` : null) : `about ${qty(m.expected)} ${m.unit}`,
    })),
    notes: { day: "The count day before today (a count saved before 5 am IST belongs to the night before)." },
  };
}

// ---------- S4: too much on the shelf ----------

export function s4Facts(st: StockFacts): Facts {
  if (st.state !== "in") return empty({ over: 0, stock_on: null });
  const s = st.s;
  const items = [
    ...s.materials.filter((m) => m.why === "ok" && m.days_left !== null).map((m) => ({ key: m.item_id, item: m.name, kind: "Material", closing: m.closing, unit: m.unit, days: m.days_left! })),
    ...s.products.filter((p) => p.why === "ok" && p.days_of_stock !== null).map((p) => ({ key: p.item_id, item: p.name, kind: "Product", closing: p.closing, unit: p.unit, days: p.days_of_stock! })),
  ]
    .filter((i) => i.days > S4_DAYS)
    .sort((a, b) => b.days - a.days);
  return {
    totals: { over: items.length, stock_on: s.last_counted_on },
    rows: items.slice(0, S4_TOP).map((i) => ({ key: i.key, item: i.item, kind: i.kind, on_hand: i.closing === null ? null : `${qty(i.closing)} ${i.unit}`, days: wholeDays(i.days) })),
  };
}
