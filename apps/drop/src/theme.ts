// The plant's brand colour (Business details in PlantOps), set while the app runs: Drop's own colour variables
// (--color-brand, tints, and dark or white text on it) and Konsta's full Material palette for its dialog.
import mdColors from "konsta-md-colors";

const rgb = (hex: string) => {
  const n = parseInt(hex.slice(1), 16);
  return `rgb(${(n >> 16) & 255} ${(n >> 8) & 255} ${n & 255})`;
};

/** Dark text on light colours (WCAG relative luminance), white on the rest. */
export function onBrand(hex: string) {
  const n = parseInt(hex.slice(1), 16);
  const lin = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  const l = 0.2126 * lin((n >> 16) & 255) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255);
  // contrast with white = 1.05 / (l + 0.05); with ink (#0f1b33, l ≈ 0.012) = (l + 0.05) / 0.062
  return 1.05 / (l + 0.05) >= (l + 0.05) / 0.062 ? "#ffffff" : "#0f1b33";
}

export function applyBrand(hex: string | null) {
  if (!hex || !/^#[0-9a-f]{6}$/i.test(hex)) return;
  const root = document.documentElement.style;
  root.setProperty("--color-brand", hex);
  root.setProperty("--color-on-brand", onBrand(hex));
  root.setProperty("--color-link", onBrand(hex) === "#ffffff" ? hex : `color-mix(in srgb, ${hex} 45%, #0f1b33)`);
  root.setProperty("--k-color-primary", rgb(hex));
  try {
    for (const [token, value] of Object.entries(mdColors(hex))) root.setProperty(`--k-color-${token}`, rgb(value));
  } catch {
    /* keep Drop blue */
  }
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", hex);
}
