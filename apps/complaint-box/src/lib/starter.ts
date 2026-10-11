// The starter item list offered to the owner while the plant has no items: the plant's own active PlantOps products,
// then a few common things customers complain about. Nothing plant-specific in code; the owner edits it afterwards.
import { productLabel } from "@plantops/module-kit";
import type { TenantSku } from "@plantops/types";

export interface StarterItem {
  /** a product id, or "dispenser" / "delivery" / "other" */
  key: string;
  name: string;
  sku_id: string | null;
}

export const NAME_MAX = 60;

const FIXED: StarterItem[] = [
  { key: "dispenser", name: "Dispenser", sku_id: null },
  { key: "delivery", name: "Delivery", sku_id: null },
  { key: "other", name: "Other", sku_id: null },
];

const norm = (s: string) => s.trim().toLowerCase();

/** Active products first (in the platform's order), then Dispenser, Delivery, Other. Names are never repeated. */
export function starterItems(products: TenantSku[]): StarterItem[] {
  const out: StarterItem[] = [];
  const seen = new Set<string>();
  for (const p of products.filter((s) => s.status === "active")) {
    const name = productLabel(p).slice(0, NAME_MAX).trim();
    if (seen.has(norm(name))) continue;
    seen.add(norm(name));
    out.push({ key: p.id, name, sku_id: p.id });
  }
  for (const f of FIXED) if (!seen.has(norm(f.name))) out.push(f);
  return out;
}
