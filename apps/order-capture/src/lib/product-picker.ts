// The order screens' product picker (owner, 2026-11-15): products grouped by their brand on Rates, short names inside a
// group. Pure, so the tests can use it.
export const brandKey = (b: string) => b.trim().toLowerCase();
/** " (1 L × 12)" at the end of a product's name: the pack is shown under it anyway */
export const PACK_NOTE = /\s*\([^()]*\)\s*$/;
/** The name inside its brand group: without the brand in front and without the pack note ("1L Water Bottle"). */
export function shortName(p: { product: string; brand: string }) {
  let n = p.product.replace(PACK_NOTE, "").trim();
  const b = p.brand.trim();
  if (b && n.toLowerCase().startsWith(b.toLowerCase())) {
    const rest = n.slice(b.length).replace(/^[\s\-–:]+/, "");
    if (rest) n = rest;
  }
  return n || p.product;
}
/** Products by brand: brands A–Z, the products with no brand ("Other") last; the order inside a brand is kept. */
export function brandGroups<T extends { brand: string }>(products: T[]): [string, T[]][] {
  const groups = new Map<string, [string, T[]]>();
  for (const p of products) {
    const k = brandKey(p.brand);
    if (!groups.has(k)) groups.set(k, [p.brand.trim(), []]);
    groups.get(k)![1].push(p);
  }
  return [...groups.values()].sort(([a], [b]) => (a === "" ? 1 : b === "" ? -1 : a.localeCompare(b)));
}
