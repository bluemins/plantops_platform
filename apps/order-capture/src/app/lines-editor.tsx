"use client";

// The product lines of an order: one card per product with a whole quantity and a rate, "+ Add product" offering only
// products not yet in the order. Shared by New order and Change order, so both behave the same.
import { useState } from "react";
import { isRate, lineTotal, money, unitsText } from "@/lib/money";
import type { RateView } from "@/server/rates";

export type EditLine = { sku_id: string; quantity: string; rate: string; edited: boolean };
/** A product the editor can show. `addable: false` = only kept because it is already in the order (switched off since). */
export type EditProduct = RateView & { addable?: boolean };

export const QTY_MAX = 100_000;
const box = "min-h-12 w-full min-w-0 rounded-lg border border-slate-300 bg-white px-3 text-lg focus:border-(--brand) focus:outline-none focus:ring-2 focus:ring-(--brand-ring)";

export const qtyOf = (l: EditLine) => (/^\d+$/.test(l.quantity.trim()) ? Number(l.quantity) : 0);
export const lineOk = (l: EditLine) => qtyOf(l) >= 1 && qtyOf(l) <= QTY_MAX && isRate(l.rate);
export const totalOf = (lines: EditLine[]) => lines.reduce((s, l) => s + (lineOk(l) ? lineTotal(qtyOf(l), l.rate.trim()) : 0n), 0n);
export const unitsOf = (lines: EditLine[], products: EditProduct[]) =>
  unitsText(lines.map((l) => ({ quantity: qtyOf(l), unit: products.find((p) => p.sku_id === l.sku_id)?.unit ?? "" })));
/** What stops these lines being saved, in words; null when they are fine. */
export function linesProblem(lines: EditLine[], products: EditProduct[]) {
  if (!lines.length) return "Add at least one product";
  const bad = lines.find((l) => !lineOk(l));
  if (bad) return `${products.find((p) => p.sku_id === bad.sku_id)?.product ?? "A product"}: enter a quantity (whole number up to 1,00,000) and a rate`;
  return null;
}
/** What the server wants for these lines. */
export const linesBody = (lines: EditLine[]) => lines.map((l) => ({ sku_id: l.sku_id, quantity: qtyOf(l), rate: l.rate.trim() }));
/** "92.50" -> "92.5"; how a saved rate is put back into a box. */
export const plainRate = (rate: string) => String(Number(rate));

export function LinesEditor({
  products,
  lines,
  onChange,
  startRate,
  hint,
}: {
  products: EditProduct[];
  lines: EditLine[];
  onChange: (lines: EditLine[]) => void;
  /** the rate a newly added product starts with */
  startRate: (skuId: string) => string;
  /** the small text under a line: "Their last rate: ₹90", "Default rate"… */
  hint: (line: EditLine, product: EditProduct) => string;
}) {
  const [picking, setPicking] = useState(false);
  const product = (id: string) => products.find((p) => p.sku_id === id)!;
  const set = (i: number, patch: Partial<EditLine>) => onChange(lines.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  const unused = products.filter((p) => p.addable !== false && !lines.some((l) => l.sku_id === p.sku_id));

  return (
    <>
      {lines.map((l, i) => {
        const p = product(l.sku_id);
        return (
          <div key={l.sku_id} className="space-y-3 rounded-xl border border-slate-200 bg-white p-3">
            <div className="flex items-start justify-between gap-2">
              <span className="font-semibold break-words">{p.product}</span>
              <span className="shrink-0 text-sm text-slate-500">{p.pack}</span>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <label className="block text-sm text-slate-600">
                <span className="mb-1 block">Quantity ({p.unit})</span>
                <input className={box} inputMode="numeric" value={l.quantity} onChange={(e) => set(i, { quantity: e.target.value.replace(/[^\d]/g, "") })} aria-label={`${p.product} quantity`} />
              </label>
              <label className="block text-sm text-slate-600">
                <span className="mb-1 block">Rate ₹ per {p.unit}</span>
                <input className={box} inputMode="decimal" value={l.rate} onChange={(e) => set(i, { rate: e.target.value, edited: true })} aria-label={`${p.product} rate`} />
              </label>
            </div>
            <div className="flex items-center justify-between text-sm text-slate-600">
              <span>{hint(l, p)}</span>
              <span className="text-base font-semibold text-slate-900">{lineOk(l) ? money(lineTotal(qtyOf(l), l.rate.trim())) : "—"}</span>
            </div>
            <button type="button" className="min-h-11 text-sm font-semibold text-red-700" onClick={() => onChange(lines.filter((_, j) => j !== i))}>
              Remove
            </button>
          </div>
        );
      })}

      {picking ? (
        <div className="space-y-2 rounded-xl border border-slate-200 bg-white p-3">
          <p className="text-sm font-semibold">Choose a product</p>
          {unused.map((p) => (
            <button
              key={p.sku_id}
              type="button"
              onClick={() => {
                onChange([...lines, { sku_id: p.sku_id, quantity: "", rate: startRate(p.sku_id), edited: false }]);
                setPicking(false);
              }}
              className="flex min-h-12 w-full items-center justify-between gap-2 rounded-lg border border-slate-200 px-3 text-left hover:bg-slate-50"
            >
              <span className="font-semibold">{p.product}</span>
              <span className="shrink-0 text-sm text-slate-500">{p.pack}</span>
            </button>
          ))}
          <button type="button" className="min-h-11 text-sm font-semibold text-slate-600" onClick={() => setPicking(false)}>
            Cancel
          </button>
        </div>
      ) : (
        unused.length > 0 && (
          <button
            type="button"
            onClick={() => setPicking(true)}
            className="flex min-h-12 w-full items-center justify-center rounded-xl border border-dashed border-slate-400 font-semibold text-(--brand)"
          >
            + Add product
          </button>
        )
      )}
    </>
  );
}
