"use client";

import { useState } from "react";
import { Button, Card, ErrorText } from "@plantops/ui";
import { api } from "@/lib/api";
import { parseCsv } from "@/lib/csv-read";
import { money } from "@/lib/money";
import { readBills, readItems, readVendorPayments, readVendors, type PurchaseFiles } from "@/lib/purchase-import";
import type { PurchaseImportPreview } from "@/server/purchases";

type Kind = keyof PurchaseFiles;
const FILES: { kind: Kind; label: string; where: string; read: (rows: string[][]) => PurchaseFiles[Kind] }[] = [
  { kind: "vendors", label: "Vendors", where: "Purchases → Vendors → ⋯ → Export Vendors", read: readVendors },
  { kind: "items", label: "Items", where: "Items → ⋯ → Export Items", read: readItems },
  { kind: "bills", label: "Bills", where: "Purchases → Bills → ⋯ → Export Bills", read: readBills },
  { kind: "payments", label: "Payments made", where: "Purchases → Payments Made → ⋯ → Export", read: readVendorPayments },
];
const day = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

/** Pick the four Zoho exports → preview (nothing saved; must match Zoho) → Confirm. */
export function PurchaseImport() {
  const [data, setData] = useState<Partial<PurchaseFiles>>({});
  const [names, setNames] = useState<Partial<Record<Kind, string>>>({});
  const [preview, setPreview] = useState<PurchaseImportPreview>();
  const [done, setDone] = useState<Record<string, string | number>>();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const ready = FILES.every((f) => data[f.kind]);
  const body = () => ({ files: names, vendors: data.vendors, items: data.items, bills: data.bills, payments: data.payments });

  async function pick(kind: Kind, file: File | undefined) {
    setError(undefined);
    setPreview(undefined);
    setDone(undefined);
    if (!file) return;
    try {
      const rows = FILES.find((f) => f.kind === kind)!.read(parseCsv(await file.text()));
      setData((d) => ({ ...d, [kind]: rows }));
      setNames((n) => ({ ...n, [kind]: file.name }));
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function check() {
    setBusy(true);
    setError(undefined);
    const r = await api<PurchaseImportPreview>("/api/purchases/import/preview", { body: body() });
    setBusy(false);
    if (!r.ok) return setError(r.error);
    setPreview(r.data);
  }

  async function confirm() {
    if (!preview) return;
    setBusy(true);
    setError(undefined);
    const r = await api<Record<string, string | number>>("/api/purchases/import/confirm", { body: { ...body(), fingerprint: preview.fingerprint } });
    setBusy(false);
    if (!r.ok) return setError(r.error);
    setDone(r.data);
    setPreview(undefined);
    setData({});
    setNames({});
  }

  const c = preview?.counts;
  return (
    <div className="space-y-4">
      <Card>
        <p className="text-sm text-slate-600">
          Export these four CSV files from Zoho Books and pick them here. The files stay on this phone or computer; only what is needed is
          sent. Nothing is saved until you press Confirm, and importing newer files again adds only what is new.
        </p>
        <div className="mt-3 space-y-3">
          {FILES.map((f) => (
            <div key={f.kind}>
              <label className="inline-block cursor-pointer rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm font-semibold text-slate-800 hover:bg-slate-50">
                {data[f.kind] ? "✓ " : ""}{f.label} CSV
                <input type="file" accept=".csv,text/csv" className="hidden" onChange={(e) => pick(f.kind, e.target.files?.[0])} />
              </label>
              <span className="ml-2 text-sm text-slate-500">{names[f.kind] ? `${names[f.kind]}: ${data[f.kind]!.length}` : f.where}</span>
            </div>
          ))}
        </div>
        <p className="mt-2 text-xs text-slate-500">Expenses and Vendor Credits come later (Zoho had none for this plant).</p>
        <Button className="mt-3 w-full" disabled={!ready || busy} onClick={check}>{busy && !preview ? "Checking..." : "Check (nothing is saved)"}</Button>
        <ErrorText>{error}</ErrorText>
      </Card>

      {done && (
        <Card>
          <p className="rounded-lg bg-green-50 px-3 py-2 text-green-800">
            Saved: {done.vendors_new} vendors, {done.items_new} items, {done.bills_new} bills ({money(String(done.billed))}), {done.payments_new} payments
            ({money(String(done.paid))}). Still to pay: {money(String(done.due_after))}.
          </p>
          <a href="/purchases" className="mt-3 inline-block font-medium text-(--brand)">See the purchase bills →</a>
        </Card>
      )}

      {preview && c && (
        <>
          <Card>
            <h2 className="mb-2 text-lg font-semibold">Money (must match Zoho)</h2>
            <dl className="grid grid-cols-2 gap-y-1 text-sm">
              <dt>Bills added</dt><dd className="text-right font-medium">{money(preview.totals.billed)}</dd>
              <dt className="text-slate-500">of which GST</dt><dd className="text-right text-slate-500">{money(preview.totals.tax)}</dd>
              <dt>Payments added</dt><dd className="text-right font-medium">{money(preview.totals.paid)}</dd>
              <dt>Still to pay, here</dt><dd className="text-right font-medium">{money(preview.totals.due_after)}</dd>
              <dt>Still to pay, Zoho</dt><dd className="text-right font-medium">{money(preview.totals.zoho_due)}</dd>
            </dl>
            <p className={`mt-2 rounded-lg px-3 py-2 text-sm ${preview.matches_zoho ? "bg-green-50 text-green-800" : "bg-red-50 text-red-800"}`}>
              {preview.matches_zoho ? "✓ Every bill's balance matches Zoho." : `✗ ${preview.mismatches.length} bills don't match Zoho. Nothing can be saved until the files agree.`}
            </p>
            {preview.mismatches.map((m) => <p key={m.number} className="text-sm text-red-700">{m.number}: here {money(m.ours)}, Zoho {money(m.zoho)}</p>)}
          </Card>

          <Card>
            <h2 className="mb-2 text-lg font-semibold">What comes in</h2>
            <ul className="space-y-1 text-sm text-slate-700">
              <li><b>{c.vendors_new}</b> vendors{c.vendors_already ? `, ${c.vendors_already} already here` : ""}</li>
              <li><b>{c.items_new}</b> purchase items{c.items_already ? `, ${c.items_already} already here` : ""}{c.items_skipped_sold ? ` (${c.items_skipped_sold} items you sell left out: they are your PlantOps products)` : ""}</li>
              <li><b>{c.bills_new}</b> bills{preview.first_bill ? `, ${day(preview.first_bill)} – ${day(preview.last_bill!)}` : ""}{c.bills_already ? `; ${c.bills_already} already here` : ""}. Zoho&apos;s numbers become PB-0001…</li>
              <li><b>{c.payments_new}</b> payments ({Object.entries(preview.modes).map(([m, n]) => `${n} ${m}`).join(", ")}){c.payments_already ? `; ${c.payments_already} already here` : ""}. Numbers become PM-0001…</li>
            </ul>
          </Card>

          {preview.vendors.length > 0 && (
            <Card>
              <details>
                <summary className="cursor-pointer font-semibold">By vendor ({preview.vendors.length})</summary>
                {preview.vendors.map((v) => (
                  <p key={v.name} className="flex justify-between gap-3 text-sm text-slate-600"><span>{v.name} · {v.bills} bills</span><span>{money(v.billed)}</span></p>
                ))}
              </details>
            </Card>
          )}

          {preview.skipped.length > 0 && (
            <Card>
              <details>
                <summary className="cursor-pointer font-semibold">Skipped ({preview.skipped.length})</summary>
                {preview.skipped.map((s, i) => <p key={i} className="text-sm text-slate-600">{s.what} {s.ref}: {s.reason}</p>)}
              </details>
            </Card>
          )}

          <Button className="w-full" disabled={busy || !preview.matches_zoho} onClick={confirm}>{busy ? "Saving..." : "Confirm and save"}</Button>
        </>
      )}
    </div>
  );
}
