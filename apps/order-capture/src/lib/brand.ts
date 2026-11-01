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
