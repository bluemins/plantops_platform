"use client";

import { useState } from "react";
import { Button, ErrorText } from "@plantops/ui";
import { api } from "@/lib/api";
import type { LineView } from "@/lib/history";
import { money } from "@/lib/money";
import { LinesEditor, linesBody, linesProblem, plainRate, totalOf, unitsOf, type EditLine, type EditProduct } from "../../../lines-editor";

type Order = { id: string; ref: string; status: "pending" | "delivered" | "cancelled"; version: number; total: string; lines: LineView[] };

/** The order's current lines, editable; Save sends the version it started from (409 if someone changed it since). */
export function ChangeEditor({ order, products }: { order: Order; products: EditProduct[] }) {
  const [lines, setLines] = useState<EditLine[]>(order.lines.map((l) => ({ sku_id: l.sku_id, quantity: String(l.quantity), rate: plainRate(l.rate), edited: true })));
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const was = (skuId: string) => order.lines.find((l) => l.sku_id === skuId);
  const total = totalOf(lines);
  const units = unitsOf(lines, products);

  async function save() {
    const p = linesProblem(lines, products);
    if (p) return setError(p);
    setBusy(true);
    setError(undefined);
    const r = await api(`/api/orders/${order.id}/change`, { body: { expected: { status: order.status, version: order.version }, lines: linesBody(lines) } }).catch(() => null);
    setBusy(false);
    if (!r) return setError("Not saved: no connection. Check the internet and press Save again.");
    if (!r.ok) return setError(r.error);
    window.location.href = `/o/${order.id}`;
  }

  return (
    <div className="space-y-4">
      <LinesEditor
        products={products}
        lines={lines}
        onChange={setLines}
        startRate={(skuId) => {
          const def = products.find((p) => p.sku_id === skuId)?.default_rate;
          return def ? plainRate(def) : "";
        }}
        hint={(l, p) => {
          const before = was(l.sku_id);
          if (before) return `Was ${before.quantity.toLocaleString("en-IN")} ${before.unit} × ${money(before.rate)}`;
          return p.default_rate ? "Default rate" : "No default rate: type the rate";
        }}
      />
      <div className="fixed inset-x-0 bottom-0 border-t border-slate-200 bg-white px-4 pt-3 pb-4">
        <div className="mx-auto max-w-3xl space-y-2">
          <ErrorText>{error}</ErrorText>
          <div className="flex items-baseline justify-between">
            <span className="text-slate-600">
              Total{units ? ` · ${units}` : ""} <span className="text-sm">(was {money(order.total)})</span>
            </span>
            <span className="text-2xl font-bold">{money(total)}</span>
          </div>
          <Button className="w-full min-h-14 text-lg" onClick={save} disabled={busy}>
            {busy ? "Saving…" : "Save changes"}
          </Button>
        </div>
      </div>
    </div>
  );
}
