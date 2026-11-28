// "Days of stock" for Sales' Plant answers S2 / S4 (owner 2026-11-28, docs/MORNING_REPORT_PHASE_PLAN.md P4-b, P4-c):
// how long each item lasts at the rate of the last 28 days. Worked out when asked, never stored. Always "about".
//   * a material: on hand (its Contents, less damage, + what its "made from" materials can still make)
//                 ÷ use per day, where use = boxes made × bottles per box × what 1 bottle needs (the recipe), over the
//                 days from the first to the last count in the window. A delivery day doesn't change it (P4-b).
//   * a finished product: closing ÷ average Sold per day (Sold = the day page's rule, only days whose day before was
//                 counted, a negative "check the count" left out) (P4-c).
// Fewer than MIN_DAYS counts in the window: "not enough history" (no number).
import { compare } from "./compare";
import { addDays } from "./days";
import { kindOf, onHand, TO_BASE, type Content, type RecipeLine } from "./recipe";

export const WINDOW_DAYS = 28;
export const MIN_DAYS = 7;

export interface RunwayDay {
  date: string;
  /** boxes made per finished item that day */
  production: Map<string, number>;
  /** closing per item as counted that day (second number: labels' loose pieces) */
  closing: Map<string, { qty: number; second: number | null; unit: string }>;
}
export interface RunwayProduct {
  item_id: string;
  unit: string;
  /** bottles per box; null = not known (its materials get no rate) */
  per_box: number | null;
  lines: RecipeLine[] | null;
}
export interface RunwayMaterial {
  item_id: string;
  unit: string;
  content: Content | null;
  made_from: RecipeLine[] | null;
}

export type MaterialWhy = "ok" | "no_recipe" | "not_used" | "not_enough_history" | "not_counted" | "measure";
export interface MaterialRunway {
  item_id: string;
  /** use per day in the material's counted unit (e.g. 0.16 box a day); null = no rate */
  per_day: number | null;
  /** about how many days the stock lasts; null = see `why` */
  days_left: number | null;
  why: MaterialWhy;
}
export interface ProductRunway {
  item_id: string;
  sold_per_day: number | null;
  days_of_stock: number | null;
  why: "ok" | "not_sold" | "not_enough_history" | "not_counted";
}
export interface Runway {
  counted_days: number;
  /** the first and last count day in the window */
  from: string | null;
  to: string | null;
  enough: boolean;
  materials: MaterialRunway[];
  products: ProductRunway[];
}

const round = (n: number, d = 2) => Math.round(n * 10 ** d) / 10 ** d;
const daysBetween = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);

/** `days` = the counts of the window, any order; the newest is "now". */
export function runway(daysIn: RunwayDay[], products: RunwayProduct[], materials: RunwayMaterial[]): Runway {
  const days = [...daysIn].sort((a, b) => a.date.localeCompare(b.date));
  const last = days.at(-1);
  const counted = days.length;
  const enough = counted >= MIN_DAYS;
  const span = last ? daysBetween(days[0]!.date, last.date) + 1 : 0;
  const byMat = new Map(materials.map((m) => [m.item_id, m]));

  // base use (pcs / g / ml / m) of each material over the window, and its measure kind
  const use = new Map<string, { base: number; kind: string; bad: boolean }>();
  const add = (id: string, base: number, kind: string) => {
    const u = use.get(id) ?? { base: 0, kind, bad: false };
    if (u.kind !== kind) u.bad = true;
    else u.base += base;
    use.set(id, u);
  };
  const usedBy = new Set<string>();
  for (const p of products) {
    for (const l of p.lines ?? []) {
      usedBy.add(l.material_item_id);
      for (const s of byMat.get(l.material_item_id)?.made_from ?? []) usedBy.add(s.material_item_id);
    }
  }
  for (const d of days) {
    for (const p of products) {
      const made = d.production.get(p.item_id) ?? 0;
      if (!(made > 0) || p.per_box === null) continue;
      for (const l of p.lines ?? []) {
        const need = made * p.per_box * l.qty * TO_BASE[l.measure];
        add(l.material_item_id, need, kindOf(l.measure));
        // what a "made from" material is made from (empty bottle ← preform): used through it
        for (const s of byMat.get(l.material_item_id)?.made_from ?? []) add(s.material_item_id, (need / TO_BASE[l.measure]) * s.qty * TO_BASE[s.measure], kindOf(s.measure));
      }
    }
  }

  const stockNow = (m: RunwayMaterial) => {
    const c = last?.closing.get(m.item_id);
    if (!c) return null;
    return onHand({ item_id: m.item_id, name: "", counted: true, closing: c.qty, second_total: c.second, content: m.content });
  };

  const matOut: MaterialRunway[] = materials.map((m) => {
    const base = { item_id: m.item_id, per_day: null, days_left: null };
    if (!usedBy.has(m.item_id)) return { ...base, why: "no_recipe" };
    if (!enough) return { ...base, why: "not_enough_history" };
    const have = stockNow(m);
    if (!have) return { ...base, why: "not_counted" };
    const u = use.get(m.item_id);
    if (!u || u.base <= 0) return { ...base, why: "not_used" };
    if (u.bad || u.kind !== have.kind) return { ...base, why: "measure" };
    let qty = have.qty;
    // a "made from" material: + what its own materials can still make (pieces)
    if (m.made_from?.length && have.kind === "pieces") {
      const can = m.made_from.map((l) => {
        const src = byMat.get(l.material_item_id);
        const sh = src ? stockNow(src) : null;
        return sh && sh.kind === kindOf(l.measure) ? Math.floor(sh.qty / (l.qty * TO_BASE[l.measure]) + 1e-9) : 0;
      });
      qty += Math.max(0, Math.min(...can));
    }
    const perDayBase = u.base / span;
    const perUnit = m.content ? m.content.qty * TO_BASE[m.content.measure] : 1;
    return { item_id: m.item_id, per_day: round(perDayBase / perUnit, 4), days_left: round(qty / perDayBase, 1), why: "ok" };
  });

  const prodOut: ProductRunway[] = products.map((p) => {
    const base = { item_id: p.item_id, sold_per_day: null, days_of_stock: null };
    if (!enough) return { ...base, why: "not_enough_history" };
    const now = last?.closing.get(p.item_id);
    if (!now) return { ...base, why: "not_counted" };
    let sold = 0;
    let n = 0;
    for (let i = 1; i < days.length; i++) {
      const d = days[i]!;
      const prev = days[i - 1]!;
      if (prev.date !== addDays(d.date, -1)) continue;
      const c = d.closing.get(p.item_id);
      if (!c) continue;
      const pc = prev.closing.get(p.item_id);
      const r = compare({ finished: true, previousCounted: true, previous: pc ? { qty: pc.qty, unit: pc.unit } : null, production: d.production.get(p.item_id) ?? 0, closing: c.qty, unit: c.unit });
      if (r.kind !== "sold") continue;
      sold += r.value;
      n++;
    }
    if (!n || sold <= 0) return { ...base, why: "not_sold" };
    const perDay = sold / n;
    return { item_id: p.item_id, sold_per_day: round(perDay), days_of_stock: round(now.qty / perDay, 1), why: "ok" };
  });

  return { counted_days: counted, from: days[0]?.date ?? null, to: last?.date ?? null, enough, materials: matOut, products: prodOut };
}
