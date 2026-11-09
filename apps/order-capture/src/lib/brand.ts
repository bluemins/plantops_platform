// Brands: the tag on each order card ("Bluemins", "Mr.Charge"). The owner sets one per product on Rates; until then
// it is guessed from the product name. Shared by the server, the Rates screen and the order list.

export const BRAND_MAX = 30;

/**
 * The words of a product name before its size: "Mr.Charge 5L" -> "Mr.Charge", "Bluemins (1 L × 12)" -> "Bluemins",
 * "Hemex" -> "Hemex"; null when the name starts with the size ("20L Jar").
 */
export function guessBrand(name: string): string | null {
  const words = name.trim().split(/\s+/);
  const size = words.findIndex((w) => /\d/.test(w));
  const out = (size < 0 ? words : words.slice(0, size)).join(" ").slice(0, BRAND_MAX).trim();
  return out || null;
}

/** The brand shown: the owner's (saved; '' = no brand) or the guess. '' = no tag. */
export const effectiveBrand = (saved: string | null | undefined, productName: string) => (saved ?? guessBrand(productName) ?? "");

// full class names, so Tailwind keeps them
const COLOURS = [
  "bg-sky-100 text-sky-900",
  "bg-violet-100 text-violet-900",
  "bg-emerald-100 text-emerald-900",
  "bg-rose-100 text-rose-900",
  "bg-indigo-100 text-indigo-900",
  "bg-orange-100 text-orange-900",
];

/** The same brand always gets the same colour (any case). */
export function brandColour(brand: string) {
  let h = 0;
  for (const c of brand.toLowerCase()) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return COLOURS[h % COLOURS.length]!;
}

// ---------- which product a bill / order line is (Drop: due per brand and box totals) ----------

/** A PlantOps product with the brand shown for it (Rates brand, else the guess; '' = no brand). */
export type BrandProduct = { id: string; name: string; sku_code: string | null; volume_ml: number; brand: string };
export type LineRef = { sku_id: string | null; sku_code?: string | null; name: string };

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();

/**
 * Finds the product of a line: its product link; else (an old Zoho line) the one product with the same SKU code, or
 * whose name, or name without its brand words in front, equals the line's item name (case and spaces ignored). Zoho
 * "1L Water Bottle" → "Bluemins 1L Water Bottle". Two products fitting the same name → none (never a guess).
 */
export function lineMatcher(products: BrandProduct[]) {
  const byId = new Map(products.map((p) => [p.id, p]));
  const byCode = new Map<string, BrandProduct | null>();
  const byName = new Map<string, BrandProduct | null>();
  const add = (m: Map<string, BrandProduct | null>, k: string, p: BrandProduct) => {
    if (!k) return;
    const prev = m.get(k);
    if (prev === undefined) m.set(k, p);
    else if (prev && prev.id !== p.id) m.set(k, null);
  };
  for (const p of products) {
    if (p.sku_code) add(byCode, norm(p.sku_code), p);
    const n = norm(p.name);
    add(byName, n, p);
    const b = norm(p.brand);
    if (b && n.startsWith(`${b} `)) add(byName, n.slice(b.length + 1), p);
  }
  return (l: LineRef): BrandProduct | null => {
    if (l.sku_id) return byId.get(l.sku_id) ?? null;
    if (l.sku_code) {
      const c = byCode.get(norm(l.sku_code));
      if (c) return c;
    }
    return byName.get(norm(l.name)) ?? null;
  };
}

/** "1L", "500ml", "1.5L" from one bottle's size. */
export const sizeLabel = (ml: number) => (ml >= 1000 ? `${Number((ml / 1000).toFixed(2))}L` : `${ml}ml`);

/** Brands compared without letter case ("Bluemins" = "bluemins"). */
export const brandKey = (b: string) => b.trim().toLowerCase();
