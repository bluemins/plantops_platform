"use client";

// The product lines of an order: one card per product with a whole quantity and a rate, "+ Add product" offering only
// products not yet in the order. Below them the free boxes (scheme, e.g. "12 + 1 free"; owner, 2026-11-08): a green
// card per product with a quantity only, "+ Add free boxes" offering any product not yet free. Shared by New order and
// Change order, so both behave the same. The picker (owner, 2026-11-15) groups products by their brand on Rates, two per
// row, with the customer's earlier products first ("Bought before") and only the brands the customer buys (set on their
// page; "Show all brands" for a one-off).
import { useState } from "react";
import { isRate, lineTotal, money, unitsText } from "@/lib/money";
import { brandGroups, brandKey, PACK_NOTE, shortName } from "@/lib/product-picker";
import type { RateView } from "@/server/rates";

/** `free`: free boxes; `rate` is then only the rate it started with (what they are worth), never typed */
export type EditLine = { sku_id: string; quantity: string; rate: string; edited: boolean; free?: boolean };
/** A product the editor can show. `addable: false` = only kept because it is already in the order (switched off since). */
export type EditProduct = RateView & { addable?: boolean };

export const QTY_MAX = 100_000;
const box = "min-h-12 w-full min-w-0 rounded-lg border border-slate-300 bg-white px-3 text-lg focus:border-(--brand) focus:outline-none focus:ring-2 focus:ring-(--brand-ring)";

export const qtyOf = (l: EditLine) => (/^\d+$/.test(l.quantity.trim()) ? Number(l.quantity) : 0);
const qtyOk = (l: EditLine) => qtyOf(l) >= 1 && qtyOf(l) <= QTY_MAX;
export const lineOk = (l: EditLine) => qtyOk(l) && (l.free || isRate(l.rate));
const paid = (lines: EditLine[]) => lines.filter((l) => !l.free);
export const totalOf = (lines: EditLine[]) => paid(lines).reduce((s, l) => s + (lineOk(l) ? lineTotal(qtyOf(l), l.rate.trim()) : 0n), 0n);
export const unitsOf = (lines: EditLine[], products: EditProduct[]) =>
  unitsText(paid(lines).map((l) => ({ quantity: qtyOf(l), unit: products.find((p) => p.sku_id === l.sku_id)?.unit ?? "" })));
/** "+ 1 box free"; "" without free boxes. */
export function freeUnitsOf(lines: EditLine[], products: EditProduct[]) {
  const free = lines.filter((l) => l.free && qtyOk(l));
  return free.length ? `+ ${unitsText(free.map((l) => ({ quantity: qtyOf(l), unit: products.find((p) => p.sku_id === l.sku_id)?.unit ?? "" })))} free` : "";
}
/** What a free line is worth per unit: the paid line's rate for the same product, else the rate it started with. */
function worthRate(l: EditLine, lines: EditLine[]) {
  const p = lines.find((x) => !x.free && x.sku_id === l.sku_id);
  if (p && isRate(p.rate.trim())) return p.rate.trim();
  return isRate(l.rate.trim()) ? l.rate.trim() : "0";
}
/** What stops these lines being saved, in words; null when they are fine. */
export function linesProblem(lines: EditLine[], products: EditProduct[]) {
  if (!paid(lines).length) return "Add at least one product that is charged";
  const name = (l: EditLine) => products.find((p) => p.sku_id === l.sku_id)?.product ?? "A product";
  const bad = lines.find((l) => !lineOk(l));
  if (bad) return bad.free ? `${name(bad)} (free): enter how many boxes are free (whole number)` : `${name(bad)}: enter a quantity (whole number up to 1,00,000) and a rate`;
  return null;
}
/** What the server wants for these lines. */
export const linesBody = (lines: EditLine[]) =>
  lines.map((l) => (l.free ? { sku_id: l.sku_id, quantity: qtyOf(l), rate: worthRate(l, lines), free: true } : { sku_id: l.sku_id, quantity: qtyOf(l), rate: l.rate.trim() }));
/** "92.50" -> "92.5"; how a saved rate is put back into a box. */
export const plainRate = (rate: string) => String(Number(rate));

export function LinesEditor({
  products,
  lines,
  onChange,
  startRate,
  hint,
  customer,
}: {
  products: EditProduct[];
  lines: EditLine[];
  onChange: (lines: EditLine[]) => void;
  /** the rate a newly added product starts with */
  startRate: (skuId: string) => string;
  /** the small text under a line: "Their last rate: ₹90", "Default rate"… */
  hint: (line: EditLine, product: EditProduct) => string;
  /** the customer's brands ([] = every brand) and last rates ("Bought before"); undefined = no customer yet */
  customer?: { brands: string[]; lastRates: Record<string, string> };
}) {
  const [picking, setPicking] = useState<false | "paid" | "free">(false);
  const [allBrands, setAllBrands] = useState(false);
  const product = (id: string) => products.find((p) => p.sku_id === id)!;
  const set = (i: number, patch: Partial<EditLine>) => onChange(lines.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  const remove = (i: number) => onChange(lines.filter((_, j) => j !== i));
  const offered = (free: boolean) => products.filter((p) => p.addable !== false && !lines.some((l) => !!l.free === free && l.sku_id === p.sku_id));
  const indexed = lines.map((l, i) => ({ l, i }));

  const pick = (p: EditProduct, free: boolean) => {
    onChange([...lines, { sku_id: p.sku_id, quantity: free ? "1" : "", rate: startRate(p.sku_id), edited: false, ...(free ? { free: true } : {}) }]);
    close();
  };
  const close = () => {
    setPicking(false);
    setAllBrands(false);
  };
  const tile = (p: EditProduct, free: boolean, name: string, note: string) => (
    <button
      key={p.sku_id}
      type="button"
      onClick={() => pick(p, free)}
      className="flex min-h-14 min-w-0 flex-col justify-center rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-left hover:border-(--brand) hover:bg-(--brand-soft)"
    >
      <span className="text-sm leading-tight font-semibold break-words">{name}</span>
      <span className="text-xs text-slate-500">{note}</span>
    </button>
  );

  const picker = (free: boolean) => {
    const list = offered(free);
    const theirs = customer?.brands ?? [];
    const inTheirs = (p: EditProduct) => theirs.some((b) => brandKey(b) === brandKey(p.brand));
    const limited = theirs.length > 0 && !allBrands && list.some(inTheirs);
    const shown = limited ? list.filter(inTheirs) : list;
    const hiddenBrands = new Set(list.filter((p) => !shown.includes(p)).map((p) => brandKey(p.brand))).size;
    const last = customer?.lastRates ?? {};
    const before = list.filter((p) => last[p.sku_id] !== undefined);
    return (
      <div className="space-y-3 rounded-xl border border-slate-200 bg-white p-3">
        <p className="text-sm font-semibold">{free ? "Which product is free?" : "Choose a product"}</p>
        {before.length > 0 && (
          <div className="space-y-1.5 rounded-lg border border-amber-300 bg-amber-50 p-2">
            <p className="text-xs font-bold tracking-wider text-slate-700 uppercase">Bought before</p>
            <div className="grid grid-cols-2 gap-1.5">{before.map((p) => tile(p, free, p.product.replace(PACK_NOTE, ""), `${p.pack} · last ${money(last[p.sku_id]!)}`))}</div>
          </div>
        )}
        {brandGroups(shown).map(([brand, ps]) => (
          <div key={brand || "(none)"} className="space-y-1.5">
            <p className="text-xs font-bold tracking-wider text-slate-500 uppercase">{brand || "Other"}</p>
            <div className="grid grid-cols-2 gap-1.5">{ps.map((p) => tile(p, free, shortName(p), p.pack))}</div>
          </div>
        ))}
        <div className="flex flex-wrap gap-x-4">
          {limited && hiddenBrands > 0 && (
            <button type="button" className="min-h-11 text-sm font-semibold text-(--brand)" onClick={() => setAllBrands(true)}>
              Show all brands ({hiddenBrands} more)
            </button>
          )}
          <button type="button" className="min-h-11 text-sm font-semibold text-slate-600" onClick={close}>
            Cancel
          </button>
        </div>
      </div>
    );
  };

  return (
    <>
      {indexed
        .filter(({ l }) => !l.free)
        .map(({ l, i }) => {
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
              <button type="button" className="min-h-11 text-sm font-semibold text-red-700" onClick={() => remove(i)}>
                Remove
              </button>
            </div>
          );
        })}

      {picking === "paid"
        ? picker(false)
        : offered(false).length > 0 && (
            <button
              type="button"
              onClick={() => { setAllBrands(false); setPicking("paid"); }}
              className="flex min-h-12 w-full items-center justify-center rounded-xl border border-dashed border-slate-400 font-semibold text-(--brand)"
            >
              + Add product
            </button>
          )}

      {lines.some((l) => l.free) && <p className="pt-1 text-sm font-semibold">Free boxes (scheme)</p>}
      {indexed
        .filter(({ l }) => l.free)
        .map(({ l, i }) => {
          const p = product(l.sku_id);
          const worth = worthRate(l, lines);
          return (
            <div key={`${l.sku_id}:free`} className="space-y-3 rounded-xl border border-green-300 bg-green-50 p-3">
              <div className="flex items-center justify-between gap-2">
                <span className="font-semibold break-words">{p.product}</span>
                <span className="shrink-0 rounded-full bg-green-100 px-2.5 py-0.5 text-xs font-bold text-green-800">FREE</span>
              </div>
              <label className="block w-1/2 text-sm text-slate-600">
                <span className="mb-1 block">Free quantity ({p.unit})</span>
                <input className={box} inputMode="numeric" value={l.quantity} onChange={(e) => set(i, { quantity: e.target.value.replace(/[^\d]/g, "") })} aria-label={`${p.product} free quantity`} />
              </label>
              <p className="text-sm text-slate-600">
                Not charged.{qtyOk(l) && Number(worth) > 0 ? ` Worth ${money(lineTotal(qtyOf(l), worth))} at their rate.` : ""}
              </p>
              <button type="button" className="min-h-11 text-sm font-semibold text-red-700" onClick={() => remove(i)}>
                Remove
              </button>
            </div>
          );
        })}

      {picking === "free"
        ? picker(true)
        : offered(true).length > 0 && (
            <button
              type="button"
              onClick={() => { setAllBrands(false); setPicking("free"); }}
              className="flex min-h-12 w-full items-center justify-center rounded-xl border border-dashed border-green-600 font-semibold text-green-800"
            >
              + Add free boxes
            </button>
          )}
    </>
  );
}
