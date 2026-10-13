// Units and rates: the rules shared by the Rates screen and (Phase 4) the order form.
import type { TenantSku } from "@plantops/types";

export const UNIT_MAX = 20;
/** Rates are rupees with at most 2 decimals, below ₹10 crore (numeric(10, 2) in the database). */
export const RATE_RE = /^\d{1,8}(\.\d{1,2})?$/;

/**
 * The unit a product is ordered in, until the owner sets one: "box" when one pack holds several bottles (a case of
 * 24 × 500 ml), else the pack type ("jar"); "unit" if the product has no pack type.
 */
export function defaultUnit(sku: Pick<TenantSku, "units_per_pack" | "pack_type">) {
  if (sku.units_per_pack > 1) return "box";
  return sku.pack_type.trim().toLowerCase().slice(0, UNIT_MAX) || "unit";
}

/** What one pack holds, for the line under the product name: "24 per box", "jar". */
export function packText(sku: Pick<TenantSku, "units_per_pack" | "pack_type">, unit = defaultUnit(sku)) {
  return sku.units_per_pack > 1 ? `${sku.units_per_pack} per ${unit}` : sku.pack_type || "single";
}

/** "90" / "90.5" / " 90.50 " -> "90.00"; "" -> null. Call only on text that passed RATE_RE (or is blank). */
export const toRate = (typed: string): string | null => (typed.trim() === "" ? null : Number(typed.trim()).toFixed(2));

/** ₹90, ₹95.50, "not set" */
export const rateText = (rate: string | null) => {
  if (rate === null) return "not set";
  const n = Number(rate);
  return `₹${Number.isInteger(n) ? n.toLocaleString("en-IN") : n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};
