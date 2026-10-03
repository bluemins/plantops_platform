// Plant brand colour -> the few shades a screen needs. Shared by the platform and every module, so a plant's
// screens look the same everywhere. Applied as CSS variables (--brand, --brand-hover, --brand-contrast,
// --brand-soft, --brand-ring); components use them instead of a fixed blue.

export const DEFAULT_BRAND = "#1d4ed8"; // PlantOps blue

type Rgb = [number, number, number];

function parse(hex: string): Rgb | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const n = parseInt(m[1]!, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

const toHex = (c: Rgb) => "#" + c.map((v) => Math.round(v).toString(16).padStart(2, "0")).join("");
const mix = (a: Rgb, b: Rgb, t: number): Rgb => [0, 1, 2].map((i) => a[i]! + (b[i]! - a[i]!) * t) as Rgb;

/** WCAG relative luminance (0 = black, 1 = white). */
function luminance([r, g, b]: Rgb) {
  const lin = (v: number) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}
const contrast = (a: number, b: number) => (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);

const WHITE: Rgb = [255, 255, 255];
const DARK: Rgb = [15, 23, 42]; // slate-900

export interface BrandPalette {
  brand: string;
  /** darker shade for hover/pressed */
  hover: string;
  /** text colour on top of `brand`: white or dark, whichever reads better */
  contrast: string;
  /** very light tint for backgrounds (tile icons, selected rows) */
  soft: string;
  /** light tint for focus rings */
  ring: string;
}

/** Palette for a plant's brand colour. Invalid or missing colour -> PlantOps blue. */
export function brandPalette(hex: string | null | undefined): BrandPalette {
  const base = parse(hex ?? "") ?? parse(DEFAULT_BRAND)!;
  const lum = luminance(base);
  const textOnBrand = contrast(lum, luminance(WHITE)) >= contrast(lum, luminance(DARK)) ? WHITE : DARK;
  return {
    brand: toHex(base),
    hover: toHex(mix(base, [0, 0, 0], 0.15)),
    contrast: toHex(textOnBrand),
    soft: toHex(mix(base, WHITE, 0.9)),
    ring: toHex(mix(base, WHITE, 0.7)),
  };
}

/** The palette as a `style` object of CSS variables, for <body> or any wrapper element. */
export function brandStyle(hex: string | null | undefined): Record<string, string> {
  const p = brandPalette(hex);
  return {
    "--brand": p.brand,
    "--brand-hover": p.hover,
    "--brand-contrast": p.contrast,
    "--brand-soft": p.soft,
    "--brand-ring": p.ring,
  };
}
