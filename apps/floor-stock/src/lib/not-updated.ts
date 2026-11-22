// "Consumable not updated correctly" (owner, 2026-11-22; mock-up https://claude.ai/artifact/Skk5Sn1LBoBzUCmDbrwsJc):
// when a product was made today, every material its recipe uses should have changed since the last count. A material
// whose closing is still the last count's number is flagged. Warn only: nothing is filled in and a save is never refused.
//   * compared with the last count before the day (what the count screen pre-filled), not a calendar day
//   * expected = last closing − boxes made × bottles per box × recipe amount ÷ what 1 counted unit holds ("about":
//     damage and loose pieces are left out). No Contents and a non-piece recipe, or products not loaded: no number.
//   * a "made from" material (empty bottle ← preform) is flagged only when it AND everything it is made from are
//     unchanged: the bottles may have been blown from preform that day
// Pure (used by the count screen in the browser and by the server's views); nothing is stored.
import { kindOf, TO_BASE, type Content, type RecipeLine } from "./recipe";

export interface CheckProduct {
  item_id: string;
  name: string;
  unit: string;
  /** bottles per box; null = not known (no expected number) */
  per_box: number | null;
  lines: RecipeLine[];
}
export interface CheckMaterial {
  item_id: string;
  name: string;
  unit: string;
  content: Content | null;
  made_from: RecipeLine[] | null;
  /** closing in the last count before the day; null = not counted then */
  previous: { qty: number; second: number | null; unit: string } | null;
}
export interface MaterialSetup {
  /** the count the comparison is with (null = no earlier count: nothing is flagged) */
  previous_date: string | null;
  products: CheckProduct[];
  materials: CheckMaterial[];
}

export interface UsedMaterial {
  item_id: string;
  name: string;
  unit: string;
  closing: number;
  expected: number | null;
  used_by: { name: string; qty: number; unit: string }[];
  not_updated: boolean;
  /** for a "made from" material flagged: what it is made from, also unchanged */
  also: string[];
}

export type Closing = { qty: number; second: number | null };

const cents = (n: number) => Math.round(n * 100);
const same = (a: Closing, b: { qty: number; second: number | null }) => cents(a.qty) === cents(b.qty) && (a.second === null ? null : cents(a.second)) === (b.second === null ? null : cents(b.second));

/** Every material used by today's production, with whether it was updated. Order = the materials' order. */
export function usedMaterials(setup: MaterialSetup | null, production: Map<string, number>, closing: Map<string, Closing>): UsedMaterial[] {
  if (!setup || !setup.previous_date) return [];
  const usage = new Map<string, { base: number | null; measureKind: string | null; users: UsedMaterial["used_by"] }>();
  for (const p of setup.products) {
    const made = production.get(p.item_id) ?? 0;
    if (!(made > 0)) continue;
    for (const l of p.lines) {
      const u = usage.get(l.material_item_id) ?? { base: 0, measureKind: kindOf(l.measure), users: [] };
      u.users.push({ name: p.name, qty: made, unit: p.unit });
      if (u.base === null || p.per_box === null || u.measureKind !== kindOf(l.measure)) u.base = null;
      else u.base += made * p.per_box * l.qty * TO_BASE[l.measure];
      usage.set(l.material_item_id, u);
    }
  }
  const byId = new Map(setup.materials.map((m) => [m.item_id, m]));
  const unchanged = (m: CheckMaterial) => {
    const now = closing.get(m.item_id);
    return !!now && !!m.previous && m.previous.unit === m.unit && same(now, m.previous);
  };

  const out: UsedMaterial[] = [];
  for (const m of setup.materials) {
    const u = usage.get(m.item_id);
    const now = closing.get(m.item_id);
    if (!u || !now || !m.previous || m.previous.unit !== m.unit) continue;
    const sources = (m.made_from ?? []).map((l) => byId.get(l.material_item_id)).filter((s): s is CheckMaterial => !!s);
    let expected: number | null = null;
    if (!sources.length && u.base !== null) {
      const contentKind = m.content ? kindOf(m.content.measure) : "pieces";
      if (contentKind === u.measureKind) {
        const perUnit = m.content ? m.content.qty * TO_BASE[m.content.measure] : 1;
        expected = Math.max(0, Math.round((m.previous.qty - u.base / perUnit) * 100) / 100);
      }
    }
    const flagged = unchanged(m) && sources.every(unchanged);
    out.push({ item_id: m.item_id, name: m.name, unit: m.unit, closing: now.qty, expected, used_by: u.users, not_updated: flagged, also: flagged ? sources.map((s) => s.name) : [] });
  }
  return out;
}

export const notUpdated = (setup: MaterialSetup | null, production: Map<string, number>, closing: Map<string, Closing>) =>
  usedMaterials(setup, production, closing).filter((m) => m.not_updated);

/** Production and closing totals per item from saved / typed lines (hundredths, like the rest of Floor Stock). */
export function totalsOf(lines: { item_id: string; kind: "production" | "stock"; qty: number; second_qty: number | null }[]) {
  const production = new Map<string, number>();
  const closing = new Map<string, Closing>();
  for (const l of lines) {
    if (l.kind === "production") production.set(l.item_id, (cents(production.get(l.item_id) ?? 0) + cents(l.qty)) / 100);
    else {
      const c = closing.get(l.item_id) ?? { qty: 0, second: null };
      closing.set(l.item_id, { qty: (cents(c.qty) + cents(l.qty)) / 100, second: l.second_qty === null ? c.second : (cents(c.second ?? 0) + cents(l.second_qty)) / 100 });
    }
  }
  return { production, closing };
}

/** "Cap D Blue: 3 box (expected about 2.94 box)" / "BM 1L Empty Bottle: 2 pkt (Preform 18.5 also unchanged)" */
export function notUpdatedText(m: UsedMaterial, fmt: (n: number) => string) {
  const extra = m.expected !== null ? ` (expected about ${fmt(m.expected)} ${m.unit})` : m.also.length ? ` (${m.also.join(", ")} also unchanged)` : "";
  return `${m.name}: ${fmt(m.closing)} ${m.unit}${extra}`;
}

export const NOT_UPDATED_LABEL = "Consumable not updated correctly";
