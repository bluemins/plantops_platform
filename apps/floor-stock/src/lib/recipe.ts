// "Can make" (approved 2026-10-11, docs/FLOOR_STOCK_CAN_MAKE_PLAN.md): how many boxes of each finished product a
// count's stock is enough for. Worked out when a screen opens; never stored.
//   material on hand = closing × what 1 unit holds (+ loose pieces), less the damage allowance
//   bottles          = the smallest of floor(on hand ÷ what 1 bottle needs), over the product's materials
//   boxes            = floor(bottles ÷ bottles per box)
// A material can be "made from" others, one step deep (an empty bottle is blown from a preform): its stock is the
// pieces counted + the pieces its own materials can still make (only those materials' damage allowance counts).
// Products that share a material (directly or through what it is made from) form one "OR" group: each is worked out
// as if all of it went to that product.

export const MEASURES = ["pcs", "g", "kg", "ml", "L", "m"] as const;
export type Measure = (typeof MEASURES)[number];
export type MeasureKind = "pieces" | "weight" | "volume" | "length";

const KIND: Record<Measure, MeasureKind> = { pcs: "pieces", g: "weight", kg: "weight", ml: "volume", L: "volume", m: "length" };
/** Everything is worked out in pcs, g, ml or m. */
const TO_BASE: Record<Measure, number> = { pcs: 1, g: 1, kg: 1000, ml: 1, L: 1000, m: 1 };
const BASE: Record<MeasureKind, Measure> = { pieces: "pcs", weight: "g", volume: "ml", length: "m" };

export const kindOf = (m: Measure) => KIND[m];
export const sameKind = (a: Measure, b: Measure) => KIND[a] === KIND[b];

/** What 1 counted unit of a material holds. null = its unit already is single pieces. */
export interface Content {
  qty: number;
  measure: Measure;
  second_is_pieces: boolean;
  damage_pct: number;
}

/** A material as counted in one version of a count. */
export interface MaterialStock {
  item_id: string;
  name: string;
  /** in this count at all */
  counted: boolean;
  closing: number;
  second_total: number | null;
  content: Content | null;
  /** what 1 piece of it is made from (e.g. 18.5 g preform per empty bottle); null / empty = bought as it is */
  made_from?: RecipeLine[] | null;
}

export interface RecipeLine {
  material_item_id: string;
  qty: number;
  measure: Measure;
}

export interface Product {
  item_id: string;
  name: string;
  /** the item's counted unit ("box") */
  unit: string;
  /** null = not known right now (the linked product couldn't be loaded): bottles are still shown */
  per_box: number | null;
  /** null = no recipe set */
  lines: RecipeLine[] | null;
}

export type Problem = { kind: "not_counted" | "measure_mismatch"; material: string };

/** A "made from" material in a product's result: pieces counted + pieces its materials can still make. */
export interface MadeMaterial {
  material: string;
  ready: number;
  made: number;
  from: string[];
}

export type ProductResult =
  | { item_id: string; name: string; unit: string; status: "ok"; bottles: number; boxes: number | null; per_box: number | null; limiting: string[]; made: MadeMaterial[] }
  | { item_id: string; name: string; unit: string; status: "problem"; problems: Problem[] }
  | { item_id: string; name: string; unit: string; status: "no_recipe" };

/** A material used by 2+ products of one group, with how many bottles it alone is enough for, per product. */
export interface SharedMaterial {
  material: string;
  /** set when every product needs the same amount of it per bottle: its total for all of them together */
  total_bottles: number | null;
  per_product: { name: string; bottles: number }[];
}

export interface CanMakeGroup {
  products: ProductResult[];
  /** empty = a product on its own; otherwise the products are alternatives ("OR") */
  shared: SharedMaterial[];
}

// Small rounding guard: 74,992.5 ÷ 18.5 must floor to 4,053, not 4,052.999…
const EPS = 1e-9;
const round6 = (n: number) => Math.round(n * 1e6) / 1e6;
const floorDiv = (a: number, b: number) => Math.floor(a / b + EPS);

/** A material's stock in its base measure (pcs / g / ml / m), less the damage allowance. */
export function onHand(m: MaterialStock): { qty: number; kind: MeasureKind } {
  if (!m.content) return { qty: m.closing, kind: "pieces" };
  const c = m.content;
  const loose = c.second_is_pieces && c.measure === "pcs" ? (m.second_total ?? 0) : 0;
  const raw = m.closing * c.qty * TO_BASE[c.measure] + loose;
  return { qty: round6(raw * (1 - c.damage_pct / 100)), kind: KIND[c.measure] };
}

type Computed = { result: ProductResult; perMaterial: Map<string, number>; perSource: Map<string, number> };

/** The pieces a "made from" material's own materials can still make, by material and in all (the smallest). */
function makeable(m: MaterialStock, stock: Map<string, MaterialStock>): { pieces: number; bySource: Map<string, number> } | { problems: Problem[] } {
  const problems: Problem[] = [];
  const bySource = new Map<string, number>();
  for (const l of m.made_from ?? []) {
    const src = stock.get(l.material_item_id);
    if (!src || !src.counted) {
      problems.push({ kind: "not_counted", material: src?.name ?? "a material" });
      continue;
    }
    const have = onHand(src);
    if (have.kind !== KIND[l.measure]) {
      problems.push({ kind: "measure_mismatch", material: src.name });
      continue;
    }
    bySource.set(l.material_item_id, Math.max(0, floorDiv(have.qty, l.qty * TO_BASE[l.measure])));
  }
  if (problems.length) return { problems };
  return { pieces: Math.min(...bySource.values()), bySource };
}

function computeProduct(p: Product, stock: Map<string, MaterialStock>): Computed {
  const base = { item_id: p.item_id, name: p.name, unit: p.unit };
  const perMaterial = new Map<string, number>();
  // bottles a "made from" material's source alone is enough for (for the shared-material totals)
  const perSource = new Map<string, number>();
  if (!p.lines || p.lines.length === 0) return { result: { ...base, status: "no_recipe" }, perMaterial, perSource };
  const problems: Problem[] = [];
  const made: MadeMaterial[] = [];
  for (const line of p.lines) {
    const m = stock.get(line.material_item_id);
    if (!m || !m.counted) {
      problems.push({ kind: "not_counted", material: m?.name ?? "a material" });
      continue;
    }
    const have = onHand(m);
    if (have.kind !== KIND[line.measure]) {
      problems.push({ kind: "measure_mismatch", material: m.name });
      continue;
    }
    const need = line.qty * TO_BASE[line.measure];
    let qty = have.qty;
    if (m.made_from?.length) {
      const extra = have.kind === "pieces" ? makeable(m, stock) : { problems: [{ kind: "measure_mismatch" as const, material: m.name }] };
      if ("problems" in extra) {
        problems.push(...extra.problems);
        continue;
      }
      qty = round6(qty + extra.pieces);
      made.push({ material: m.name, ready: Math.max(0, floorDiv(have.qty, 1)), made: extra.pieces, from: [...extra.bySource.keys()].map((id) => stock.get(id)!.name) });
      for (const [id, pieces] of extra.bySource) perSource.set(id, Math.max(0, floorDiv(pieces, need)));
    }
    perMaterial.set(line.material_item_id, Math.max(0, floorDiv(qty, need)));
  }
  if (problems.length) return { result: { ...base, status: "problem", problems }, perMaterial, perSource };
  const bottles = Math.min(...perMaterial.values());
  const limiting = [...perMaterial.entries()].filter(([, n]) => n === bottles).map(([id]) => stock.get(id)!.name);
  const boxes = p.per_box === null ? null : Math.floor(bottles / p.per_box);
  return { result: { ...base, status: "ok", bottles, boxes, per_box: p.per_box, limiting, made }, perMaterial, perSource };
}

/** Every material a product uses, with how much of it 1 bottle needs (base measure): its recipe lines, and for a
 *  "made from" material also what it is made from (18.5 g preform × 1 empty bottle). */
function uses(p: Product, stock: Map<string, MaterialStock>): { id: string; need: number }[] {
  return (p.lines ?? []).flatMap((l) => {
    const need = round6(l.qty * TO_BASE[l.measure]);
    const from = (stock.get(l.material_item_id)?.made_from ?? []).map((s) => ({ id: s.material_item_id, need: round6(s.qty * TO_BASE[s.measure] * need) }));
    return [{ id: l.material_item_id, need }, ...from];
  });
}

/**
 * Every product's result, grouped: products sharing a material (directly or through another product) come together
 * as one group of alternatives; the rest each stand alone. Order follows `products` (the plant's order).
 */
export function canMake(products: Product[], materials: MaterialStock[]): CanMakeGroup[] {
  const stock = new Map(materials.map((m) => [m.item_id, m]));
  const computed = products.map((p) => computeProduct(p, stock));
  const used = products.map((p) => uses(p, stock));

  // union-find over products that share a material
  const parent = products.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i]!)));
  const firstUser = new Map<string, number>();
  used.forEach((us, i) => {
    for (const u of us) {
      const j = firstUser.get(u.id);
      if (j === undefined) firstUser.set(u.id, i);
      else parent[find(i)] = find(j);
    }
  });

  const groups = new Map<number, number[]>();
  products.forEach((_, i) => groups.set(find(i), [...(groups.get(find(i)) ?? []), i]));

  return [...groups.values()].map((members) => {
    const shared: SharedMaterial[] = [];
    if (members.length > 1) {
      const users = new Map<string, { i: number; need: number }[]>();
      for (const i of members) {
        for (const u of used[i]!) users.set(u.id, [...(users.get(u.id) ?? []), { i, need: u.need }]);
      }
      for (const [materialId, us] of users) {
        if (us.length < 2) continue;
        const m = stock.get(materialId);
        const perProduct = us.flatMap(({ i }) => {
          const n = computed[i]!.perMaterial.get(materialId) ?? computed[i]!.perSource.get(materialId);
          return n === undefined ? [] : [{ name: products[i]!.name, bottles: n }];
        });
        const sameNeed = us.every((u) => u.need === us[0]!.need);
        shared.push({ material: m?.name ?? "a material", total_bottles: sameNeed && perProduct.length ? perProduct[0]!.bottles : null, per_product: perProduct });
      }
    }
    return { products: members.map((i) => computed[i]!.result), shared };
  });
}

/** "25,000 g", "500 pcs": what 1 unit holds, for summaries. */
export function contentText(unit: string, c: Content | null): string {
  if (!c) return "";
  const parts = [`1 ${unit} = ${num(c.qty)} ${c.measure}`];
  if (c.damage_pct > 0) parts.push(`damage ${num(c.damage_pct)}%`);
  if (c.second_is_pieces) parts.push("count = loose pieces");
  return parts.join(" · ");
}

/** Thousands separators, no trailing zeros: 25000 → "25,000", 18.5 → "18.5". */
export const num = (n: number) => n.toLocaleString("en-IN", { maximumFractionDigits: 4 });

export const baseMeasure = (k: MeasureKind) => BASE[k];
