"use client";

import { useState } from "react";
import { Button, Card, ErrorText } from "@plantops/ui";
import { api } from "@/lib/api";
import { RATE_RE, UNIT_MAX } from "@/lib/rates";
import type { RateView } from "@/server/rates";

type Row = { sku_id: string; unit: string; default_rate: string };
const asRow = (r: RateView): Row => ({ sku_id: r.sku_id, unit: r.unit, default_rate: r.default_rate === null ? "" : String(Number(r.default_rate)) });
const input = "min-h-11 w-full min-w-0 rounded-lg border bg-white px-3 text-base focus:border-(--brand) focus:outline-none focus:ring-2 focus:ring-(--brand-ring)";

/** The Rates list (mock-up "Rates"): one unit and one rate box per product, one Save button. Support: read-only. */
export function RatesEditor({ rates, canEdit }: { rates: RateView[]; canEdit: boolean }) {
  const [rows, setRows] = useState<Row[]>(rates.map(asRow));
  const [error, setError] = useState<string>();
  const [saved, setSaved] = useState<string>();
  const [busy, setBusy] = useState(false);
  const set = (i: number, patch: Partial<Row>) => {
    setSaved(undefined);
    setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  };
  const bad = rows.findIndex((r) => !r.unit.trim() || (r.default_rate.trim() !== "" && !RATE_RE.test(r.default_rate.trim())));

  async function save() {
    if (bad >= 0) return setError(`${rates[bad]!.product}: enter a unit, and a rate like 90 or 92.50 (or leave the rate blank)`);
    setBusy(true);
    setError(undefined);
    const r = await api<{ changed: number }>("/api/rates", { method: "PUT", body: { rates: rows } });
    setBusy(false);
    if (!r.ok) return setError(r.error);
    setSaved(r.data.changed === 0 ? "Nothing changed." : `Saved ${r.data.changed} product${r.data.changed === 1 ? "" : "s"}.`);
  }

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,1fr)] gap-2 px-1 text-sm text-slate-500">
        <span>Product</span>
        <span>Unit</span>
        <span>Rate ₹</span>
      </div>
      <Card className="p-3">
        <ul className="divide-y divide-slate-100">
          {rates.map((r, i) => {
            const row = rows[i]!;
            const rateBad = row.default_rate.trim() !== "" && !RATE_RE.test(row.default_rate.trim());
            return (
              <li key={r.sku_id} className="grid grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,1fr)] items-center gap-2 py-2.5">
                <div className="min-w-0">
                  <p className="font-semibold break-words">{r.product}</p>
                  <p className="text-xs text-slate-500">{r.pack}</p>
                </div>
                {canEdit ? (
                  <>
                    <input aria-label={`${r.product} unit`} className={`${input} ${row.unit.trim() ? "border-slate-300" : "border-red-400"}`} value={row.unit} maxLength={UNIT_MAX} onChange={(e) => set(i, { unit: e.target.value })} />
                    <input
                      aria-label={`${r.product} rate`}
                      className={`${input} ${rateBad ? "border-red-400" : row.default_rate ? "border-slate-300" : "border-dashed border-slate-400"}`}
                      value={row.default_rate}
                      placeholder="not set"
                      inputMode="decimal"
                      onChange={(e) => set(i, { default_rate: e.target.value })}
                    />
                  </>
                ) : (
                  <>
                    <span>{r.unit}</span>
                    <span className={r.default_rate ? "" : "text-slate-400"}>{r.default_rate ? Number(r.default_rate).toLocaleString("en-IN") : "not set"}</span>
                  </>
                )}
              </li>
            );
          })}
        </ul>
      </Card>
      <p className="text-sm text-slate-500">&quot;Not set&quot;: the rate is typed on each order.</p>
      <ErrorText>{error}</ErrorText>
      {saved && (
        <p role="status" className="rounded-lg bg-green-50 px-3 py-2 text-sm text-green-800">
          {saved}
        </p>
      )}
      {canEdit && (
        <Button className="w-full min-h-14 text-lg" onClick={save} disabled={busy}>
          {busy ? "Saving…" : "Save rates"}
        </Button>
      )}
    </div>
  );
}
