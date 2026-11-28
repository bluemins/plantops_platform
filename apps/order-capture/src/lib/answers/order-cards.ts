// Plant answers Phase 3 (docs/MORNING_REPORT_PHASE_PLAN.md): the order and customer cards O1–O5. Pure: each takes rows
// the server read and uses the rules of the screen it comes from ("Buying & paying" on the customer page for O2, O3 and
// O5; the Pending tab's 2-day mark for O1; Order flow check's look-alike places for O4).
import type { StockLevels } from "@plantops/types";
import type { CustomerInsights } from "../customer-insights";
import { lookAlikePlaces } from "../flow-check";
import { PERIODS, periodDates, type Period } from "../report";
import { O1_HOURS } from "./cards";
import type { Facts, Row } from "./facts";

const DAY = 86_400_000;
const addDays = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);
const daysBetween = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / DAY);
const qty = (n: number) => n.toLocaleString("en-IN", { maximumFractionDigits: 2 });
const sameUnit = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

// ---------- O1: pending orders waiting too long, and is stock there ----------

export type O1Order = {
  id: string;
  ref: string;
  customer: string;
  customer_href: string;
  place: string | null;
  phone: string | null;
  created_at: string;
  lines: { sku_id: string; name: string; unit: string; quantity: number }[];
};
export type StockAnswer = { state: "in"; levels: StockLevels } | { state: "off" | "unreachable" };

export function o1Facts(orders: O1Order[], stock: StockAnswer, now: Date): Facts {
  const need = new Map<string, { name: string; unit: string; needed: number }>();
  for (const o of orders)
    for (const l of o.lines) {
      const n = need.get(l.sku_id) ?? { name: l.name, unit: l.unit, needed: 0 };
      n.needed += l.quantity;
      need.set(l.sku_id, n);
    }
  const levels = stock.state === "in" ? new Map(stock.levels.items.map((i) => [i.sku_id, i])) : null;
  // per product: short by how much (null = enough), "not counted" or "units differ"
  const status = new Map<string, { short: number | null; inStock: number | null; text: string }>();
  for (const [sku, n] of need) {
    const lv = levels?.get(sku);
    if (!levels) status.set(sku, { short: null, inStock: null, text: "Stock not checked" });
    else if (!lv) status.set(sku, { short: null, inStock: null, text: "Not counted" });
    else if (!sameUnit(lv.unit, n.unit)) status.set(sku, { short: null, inStock: null, text: `Counted in ${lv.unit}` });
    else status.set(sku, { short: n.needed > lv.closing ? n.needed - lv.closing : null, inStock: lv.closing, text: n.needed > lv.closing ? qty(n.needed - lv.closing) : "—" });
  }
  const late = orders
    .map((o) => ({ o, hours: (now.getTime() - Date.parse(o.created_at)) / 3_600_000 }))
    .filter((x) => x.hours >= O1_HOURS)
    .sort((a, b) => b.hours - a.hours);
  const rows: Row[] = late.map(({ o, hours }) => {
    const shorts = o.lines.filter((l) => status.get(l.sku_id)?.short);
    const unknown = o.lines.filter((l) => status.get(l.sku_id)?.inStock === null);
    const stockText = !levels
      ? "Stock not checked"
      : shorts.length
        ? `Short: ${shorts.map((l) => `${l.name} (${qty(status.get(l.sku_id)!.inStock!)} in stock)`).join(", ")}`
        : unknown.length
          ? `Not counted: ${unknown.map((l) => l.name).join(", ")}`
          : "Stock there";
    return {
      key: o.id,
      href: `/o/${o.id}`,
      ref: o.ref,
      customer: o.customer,
      customer_href: o.customer_href,
      place: o.place?.trim() || null,
      days: Math.floor(hours / 24),
      products: o.lines.map((l) => `${l.name} × ${qty(l.quantity)} ${l.unit}`).join(", "),
      stock: stockText,
      phone: o.phone,
    };
  });
  const stockRows: Row[] = [...need.entries()]
    .sort(([, a], [, b]) => a.name.localeCompare(b.name))
    .map(([sku, n]) => ({ product: n.name, needed: n.needed, in_stock: status.get(sku)!.inStock, short: status.get(sku)!.text }));
  const notes: Record<string, string> = {};
  if (stock.state === "in" && stock.levels.counted_on) notes.stock_on = "The day of the last Floor Stock count. Anything made or sent out since is not in it.";
  else if (stock.state === "in") notes.stock_on = "Floor Stock has no count yet.";
  else notes.stock_on = stock.state === "off" ? "Floor Stock is not switched on for this plant, so stock is not checked." : "Floor Stock did not answer just now, so stock is not checked. Try again in a minute.";
  return {
    totals: { late: rows.length, pending: orders.length, stock_on: stock.state === "in" ? stock.levels.counted_on : null },
    rows,
    lists: { stock: stockRows },
    notes,
  };
}

// ---------- O2, O3, O5: from each customer's "Buying & paying" ----------

export type CustomerBuying = {
  key: string;
  href: string;
  customer: string;
  place: string | null;
  phone: string | null;
  ins: CustomerInsights;
  /** a pending order of theirs ("O-0612"), if any */
  pending: string | null;
};

const basketText = (ins: CustomerInsights, without?: string) =>
  ins.basket
    .filter((b) => b.key !== without)
    .map((b) => `${b.name} × ${qty(b.quantity)}${b.unit ? ` ${b.unit}` : ""}`)
    .join(", ");

export function o2Facts(list: CustomerBuying[]): Facts {
  const late = list.filter((c) => c.ins.next?.state === "late").sort((a, b) => b.ins.next!.days_late - a.ins.next!.days_late || a.customer.localeCompare(b.customer));
  const stopped = list
    .filter((c) => c.ins.next?.state === "stopped")
    .sort((a, b) => (a.ins.ordering.days_since_last ?? 0) - (b.ins.ordering.days_since_last ?? 0) || a.customer.localeCompare(b.customer));
  return {
    totals: { late: late.length, stopped: stopped.length },
    rows: late.map((c) => ({
      key: c.key,
      href: c.href,
      customer: c.customer,
      place: c.place,
      usual_gap: c.ins.ordering.usual_gap,
      since_last: c.ins.ordering.days_since_last,
      days_late: c.ins.next!.days_late,
      basket: basketText(c.ins) || null,
      pending: c.pending,
      phone: c.phone,
    })),
    lists: {
      stopped: stopped.map((c) => ({ key: c.key, href: c.href, customer: c.customer, place: c.place, usual_gap: c.ins.ordering.usual_gap, last_date: c.ins.ordering.last_date, since_last: c.ins.ordering.days_since_last })),
    },
  };
}

/** The products anyone stopped buying (with how many stopped), most first: the O3 picker's choices. */
export function o3Choices(list: CustomerBuying[]) {
  const per = new Map<string, { key: string; name: string; n: number }>();
  for (const c of list) for (const s of c.ins.stopped) per.set(s.key, { key: s.key, name: s.name, n: (per.get(s.key)?.n ?? 0) + 1 });
  return [...per.values()].sort((a, b) => b.n - a.n || a.name.localeCompare(b.name));
}

export function o3Facts(list: CustomerBuying[], product: { key: string; name: string }): Facts {
  const who = list
    .map((c) => ({ c, s: c.ins.stopped.find((x) => x.key === product.key) }))
    .filter((x): x is { c: CustomerBuying; s: NonNullable<typeof x.s> } => !!x.s)
    .sort((a, b) => b.s.last_date.localeCompare(a.s.last_date) || a.c.customer.localeCompare(b.c.customer));
  const all = who.filter((x) => x.c.ins.next?.state === "stopped");
  return {
    totals: { product: product.name, stopped: who.length, still_buying: who.length - all.length, stopped_all: all.length },
    rows: who.map(({ c, s }) => ({
      key: c.key,
      href: c.href,
      customer: c.customer,
      place: c.place,
      last_date: s.last_date,
      times: `${s.times} of ${s.of} orders`,
      still_buys: c.ins.next?.state === "stopped" ? "No orders at all since" : basketText(c.ins, product.key) || "Other products",
    })),
  };
}

export function o5Facts(c: CustomerBuying, lastRates: Map<string, bigint>): Facts {
  const i = c.ins;
  const state = i.next ? { ahead: "Not due yet", due: "Due now", late: `Late by ${i.next.days_late} days`, stopped: "Looks stopped" }[i.next.state] : null;
  return {
    totals: {
      customer: c.place ? `${c.customer} (${c.place})` : c.customer,
      usual_gap: i.ordering.usual_gap,
      last_date: i.ordering.last_date,
      next_date: i.next?.expected ?? null,
      next_state: state,
    },
    rows: i.basket.map((b) => ({ key: b.key, product: b.name, usual: `${qty(b.quantity)}${b.unit ? ` ${b.unit}` : ""}`, times: `${b.times} of ${b.of}`, last_rate: lastRates.get(b.key) ?? null })),
    lists: { stopped: i.stopped.map((s) => ({ product: s.name, last_date: s.last_date })) },
    notes: i.ordering.purchases < 2 ? { usual_gap: "Too few orders yet to tell their usual gap." } : {},
  };
}

// ---------- O4: orders by place ----------

export const O4_PERIODS = ["this_month", "prev_month", "this_quarter", "this_fy"] as const satisfies readonly Period[];
export type O4Period = (typeof O4_PERIODS)[number];
export const O4_PERIOD_LABEL: Record<O4Period, string> = { this_month: "This month so far", prev_month: "Last month", this_quarter: "This quarter", this_fy: "This financial year" };
export const o4Period = (v: string | undefined): O4Period => (O4_PERIODS as readonly string[]).includes(v ?? "") ? (v as O4Period) : "this_month";

/** The period and the same number of days just before it. */
export function o4Dates(period: O4Period, today: string) {
  if (!PERIODS.includes(period)) throw new Error(period);
  const now = periodDates(period, today);
  const n = daysBetween(now.from, now.to) + 1;
  return { now, before: { from: addDays(now.from, -n), to: addDays(now.from, -1) } };
}

export type O4Order = { date: string; customer_id: string; place: string | null; quantity: number };

const placeKey = (p: string | null) => (p ?? "").trim().replace(/\s+/g, " ").toLowerCase();

export function o4Facts(orders: O4Order[], period: O4Period, today: string): Facts {
  const { now, before } = o4Dates(period, today);
  const inNow = orders.filter((o) => o.date >= now.from && o.date <= now.to);
  const per = new Map<string, { spellings: Map<string, number>; orders: number; customers: Set<string>; quantity: number; before: number }>();
  const get = (p: string | null) => {
    const k = placeKey(p);
    const x = per.get(k) ?? { spellings: new Map(), orders: 0, customers: new Set(), quantity: 0, before: 0 };
    per.set(k, x);
    return x;
  };
  for (const o of inNow) {
    const x = get(o.place);
    const spelled = o.place?.trim().replace(/\s+/g, " ") || "No place";
    x.spellings.set(spelled, (x.spellings.get(spelled) ?? 0) + 1);
    x.orders += 1;
    x.customers.add(o.customer_id);
    x.quantity += o.quantity;
  }
  for (const o of orders.filter((o) => o.date >= before.from && o.date <= before.to)) if (per.has(placeKey(o.place))) per.get(placeKey(o.place))!.before += 1;
  const rows: Row[] = [...per.values()]
    .map((x) => {
      // the spelling most of its orders have; on a tie the capitalised one ("Sason" over "sason")
      const cap = (w: string) => (w[0] && w[0] !== w[0].toLowerCase() ? 0 : 1);
      const name = [...x.spellings.entries()].sort((a, b) => b[1] - a[1] || cap(a[0]) - cap(b[0]) || a[0].localeCompare(b[0]))[0]![0];
      const d = x.orders - x.before;
      return { key: name, place: name, orders: x.orders, customers: x.customers.size, quantity: x.quantity, vs_before: d > 0 ? `+${d}` : d < 0 ? `−${-d}` : "same" };
    })
    .sort((a, b) => Number(b.orders) - Number(a.orders) || String(a.place).localeCompare(String(b.place)));
  const counts = rows.map((r) => ({ name: String(r.place), count: Number(r.orders) }));
  const lookalike = lookAlikePlaces(counts).map(([a, b]) => ({ places: `${a} / ${b}`, orders: counts.find((c) => c.name === a)!.count + counts.find((c) => c.name === b)!.count }));
  return {
    totals: { orders: inNow.length, places: rows.length, from: now.from, to: now.to },
    rows,
    lists: { lookalike },
    notes: { orders: `Orders entered ${O4_PERIOD_LABEL[period].toLowerCase()}, delivered or pending. Cancelled orders are left out. "vs before" compares with the ${daysBetween(now.from, now.to) + 1} days just before.` },
  };
}
