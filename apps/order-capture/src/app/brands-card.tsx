"use client";
// A customer's "Brands they buy" (owner, 2026-11-15): tap brands on / off, then Save. New order and Change order then
// list only these brands for the customer. None ticked = every brand. The server decides who may change it (owner,
// Order desk); everyone else sees the ticks only.
import { useState } from "react";
import { useRouter } from "next/navigation";
import { ErrorText } from "@plantops/ui";
import { api } from "@/lib/api";
import type { BrandsCardView } from "@/server/customer-brands";

const label = (b: string) => b || "Other (no brand)";
const when = (iso: string) => new Date(iso).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit", timeZone: "Asia/Kolkata" });
const same = (a: string[], b: string[]) => JSON.stringify([...a].sort()) === JSON.stringify([...b].sort());

export function BrandsCard({ view }: { view: BrandsCardView }) {
  const router = useRouter();
  const [picked, setPicked] = useState<string[]>(view.brands);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [saved, setSaved] = useState(false);
  const changed = !same(picked, view.brands);

  async function save(brands: string[]) {
    setError(undefined);
    setBusy(true);
    const r = await api(`/api/customers/${view.customer_id}/brands`, { body: { brands } }).catch(() => null);
    setBusy(false);
    if (!r) return setError("Not saved: no connection. Check the internet and press Save again.");
    if (!r.ok) return setError(r.error);
    setPicked(brands);
    setSaved(true);
    router.refresh();
  }
  const toggle = (b: string) => {
    setSaved(false);
    setPicked((p) => (p.includes(b) ? p.filter((x) => x !== b) : [...p, b]));
  };

  return (
    <div className="space-y-3">
      <p className="text-sm text-slate-600">
        {picked.length === 0 ? "None ticked: New order shows every brand for this customer." : "New order shows only these brands for this customer."}
      </p>
      <div className="flex flex-wrap gap-2">
        {view.choices.map((b) => {
          const on = picked.includes(b);
          return (
            <button
              key={b || "(none)"}
              type="button"
              aria-pressed={on}
              disabled={!view.can_set || busy}
              onClick={() => toggle(b)}
              className={`min-h-11 rounded-full border px-4 text-sm font-semibold disabled:cursor-default ${on ? "border-(--brand) bg-(--brand-soft) text-(--brand)" : "border-slate-300 bg-white text-slate-600"} ${view.can_set ? "" : "disabled:opacity-100"}`}
            >
              {on ? "✓ " : ""}
              {label(b)}
            </button>
          );
        })}
      </div>
      {view.from_orders.length > 0 && (
        <p className="text-sm text-slate-500">
          From past orders: {view.from_orders.map(label).join(", ")}
          {view.can_set && !same(picked, view.from_orders) && (
            <button type="button" className="ml-2 min-h-11 font-semibold text-(--brand)" disabled={busy} onClick={() => { setSaved(false); setPicked(view.from_orders); }}>
              Use these
            </button>
          )}
        </p>
      )}
      <ErrorText>{error}</ErrorText>
      {view.can_set && (changed || saved) && (
        <div className="flex flex-wrap items-center gap-2">
          {changed && (
            <>
              <button type="button" disabled={busy} onClick={() => save(picked)} className="min-h-11 rounded-lg bg-(--brand) px-5 text-sm font-semibold text-(--brand-contrast) hover:bg-(--brand-hover) disabled:opacity-50">
                {busy ? "Saving…" : "Save"}
              </button>
              <button type="button" disabled={busy} onClick={() => setPicked(view.brands)} className="min-h-11 px-3 text-sm font-semibold text-slate-600">
                Cancel
              </button>
            </>
          )}
          {!changed && saved && <span className="text-sm font-semibold text-emerald-700">Saved</span>}
        </div>
      )}
      {view.changed_by && view.changed_at && (
        <p className="text-xs text-slate-500">
          Changed by {view.changed_by} · {when(view.changed_at)}
        </p>
      )}
    </div>
  );
}
