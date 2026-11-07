"use client";

import { useState } from "react";
import { Button, Card, ErrorText } from "@plantops/ui";
import { api } from "@/lib/api";
import { BILL_TERMS, TERMS_LABEL, type BillTerms } from "@/lib/ledger";

const field = "min-h-12 w-full min-w-0 rounded-xl border border-slate-300 bg-white px-3 text-base focus:border-(--brand) focus:outline-none focus:ring-2 focus:ring-(--brand-ring)";
const label = "mb-1 block text-sm font-medium text-slate-700";

type Settings = { rates_include_gst: boolean; default_terms: BillTerms; default_notes: string | null };

/** Owner (support reads): what every new bill starts with (mock-up 5). Each bill can still change them. */
export function BillSettingsCard({ value, canEdit }: { value: Settings; canEdit: boolean }) {
  const [f, setF] = useState({ ...value, default_notes: value.default_notes ?? "" });
  const [error, setError] = useState<string>();
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true);
    setError(undefined);
    setSaved(false);
    const r = await api("/api/bill-settings", { method: "PUT", body: f });
    setBusy(false);
    if (!r.ok) return setError(r.error);
    setSaved(true);
  }

  return (
    <Card className="space-y-3">
      <h2 className="text-lg font-semibold">Bill settings</h2>
      <p className="text-sm text-slate-600">What every new bill starts with. Each bill can change them.</p>
      <label className="block">
        <span className={label}>Rates include GST</span>
        <select className={field} disabled={!canEdit} value={f.rates_include_gst ? "yes" : "no"} onChange={(e) => { setF({ ...f, rates_include_gst: e.target.value === "yes" }); setSaved(false); }}>
          <option value="yes">Yes: the rate is the final price</option>
          <option value="no">No: GST is added on top</option>
        </select>
      </label>
      <label className="block">
        <span className={label}>Usual terms</span>
        <select className={field} disabled={!canEdit} value={f.default_terms} onChange={(e) => { setF({ ...f, default_terms: e.target.value as BillTerms }); setSaved(false); }}>
          {BILL_TERMS.map((t) => <option key={t} value={t}>{TERMS_LABEL[t]}</option>)}
        </select>
      </label>
      <label className="block">
        <span className={label}>Usual customer notes (printed on the bill)</span>
        <textarea className={`${field} py-2`} rows={2} maxLength={2000} disabled={!canEdit} value={f.default_notes} placeholder="Thanks for your business."
          onChange={(e) => { setF({ ...f, default_notes: e.target.value }); setSaved(false); }} />
      </label>
      <ErrorText>{error}</ErrorText>
      {saved && <p className="rounded-lg bg-green-50 px-3 py-2 text-sm text-green-800">Saved.</p>}
      {canEdit && <Button className="w-full" disabled={busy} onClick={save}>{busy ? "Saving..." : "Save bill settings"}</Button>}
    </Card>
  );
}
