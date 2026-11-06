"use client";

// The sales ledger's forms (docs/ZOHO_IMPORT_PHASE_PLAN.md section 6): Receive payment, Make bill, cancel a bill or a
// payment with a reason, the Zoho GST invoice no., Print. The server checks everything again.
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button, ErrorText } from "@plantops/ui";
import { api } from "@/lib/api";
import { money } from "@/lib/money";

const field = "min-h-12 w-full min-w-0 rounded-xl border border-slate-300 bg-white px-3 text-base focus:border-(--brand) focus:outline-none focus:ring-2 focus:ring-(--brand-ring)";
const label = "mb-1 block text-sm font-medium text-slate-700";
const AMOUNT = /^\d{1,9}(\.\d{1,2})?$/;
const MODES: [string, string][] = [
  ["cash", "Cash"],
  ["upi", "UPI"],
  ["bank", "Bank"],
  ["cheque", "Cheque"],
  ["other", "Other"],
];

/** Receive a payment: oldest bills first, or only the ticked ones; what is left stays as advance. */
export function ReceivePayment({ customerId, openBills, today }: { customerId: string; openBills: { id: string; number: string; bill_date: string; due: string }[]; today: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ amount: "", payment_date: today, mode: "cash", reference: "", note: "" });
  const [ticked, setTicked] = useState<string[]>([]);
  const [error, setError] = useState<string>();
  const [done, setDone] = useState<string>();
  const [busy, setBusy] = useState(false);
  const totalDue = openBills.reduce((s, b) => s + Number(b.due), 0);

  async function save() {
    setError(undefined);
    if (!AMOUNT.test(f.amount.trim()) || Number(f.amount) <= 0) return setError("Amount: rupees, e.g. 500 or 1250.50");
    setBusy(true);
    const r = await api<{ number: string; bills: string[]; advance: string }>("/api/payments", {
      body: { customer_id: customerId, ...f, amount: f.amount.trim(), reference: f.reference || undefined, note: f.note || undefined, bill_ids: ticked },
    });
    setBusy(false);
    if (!r.ok) return setError(r.error);
    setDone(`${r.data.number} saved. ${r.data.bills.length ? `Paid ${r.data.bills.join(", ")}.` : ""}${r.data.advance !== "0.00" ? ` ${money(r.data.advance)} kept as advance.` : ""}`);
    setOpen(false);
    setF({ amount: "", payment_date: today, mode: "cash", reference: "", note: "" });
    setTicked([]);
    router.refresh();
  }

  if (!open)
    return (
      <div className="space-y-2">
        {done && <p className="rounded-lg bg-green-50 px-3 py-2 text-sm text-green-800">{done}</p>}
        <Button variant="secondary" className="w-full" onClick={() => { setDone(undefined); setOpen(true); }}>Receive payment</Button>
      </div>
    );
  return (
    <div className="space-y-3 rounded-2xl border border-slate-200 bg-white p-4">
      <h2 className="text-lg font-semibold">Receive payment</h2>
      <div className="grid grid-cols-2 gap-3">
        <label className="block">
          <span className={label}>Amount ₹</span>
          <input className={field} inputMode="decimal" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} placeholder={totalDue ? String(totalDue) : "0"} />
        </label>
        <label className="block">
          <span className={label}>Date</span>
          <input className={field} type="date" max={today} value={f.payment_date} onChange={(e) => setF({ ...f, payment_date: e.target.value })} />
        </label>
        <label className="block">
          <span className={label}>Mode</span>
          <select className={field} value={f.mode} onChange={(e) => setF({ ...f, mode: e.target.value })}>
            {MODES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </label>
        <label className="block">
          <span className={label}>Reference (optional)</span>
          <input className={field} value={f.reference} maxLength={100} onChange={(e) => setF({ ...f, reference: e.target.value })} placeholder="UPI ref, cheque no." />
        </label>
      </div>
      <label className="block">
        <span className={label}>Note (optional)</span>
        <input className={field} value={f.note} maxLength={300} onChange={(e) => setF({ ...f, note: e.target.value })} />
      </label>
      {openBills.length > 0 && (
        <fieldset className="space-y-1">
          <legend className={label}>Pays (none ticked = oldest bills first)</legend>
          {openBills.map((b) => (
            <label key={b.id} className="flex min-h-10 items-center gap-2 text-sm">
              <input type="checkbox" className="h-5 w-5" checked={ticked.includes(b.id)} onChange={(e) => setTicked(e.target.checked ? [...ticked, b.id] : ticked.filter((x) => x !== b.id))} />
              {b.number} · {b.bill_date} · due {money(b.due)}
            </label>
          ))}
        </fieldset>
      )}
      <ErrorText>{error}</ErrorText>
      <div className="flex gap-2">
        <Button className="flex-1" disabled={busy} onClick={save}>{busy ? "Saving..." : "Save payment"}</Button>
        <Button variant="secondary" onClick={() => setOpen(false)}>Cancel</Button>
      </div>
    </div>
  );
}

/** Make the bill of a delivered order: optional discount, due date, Zoho GST invoice no. */
export function MakeBill({ orderId, total, today }: { orderId: string; total: string; today: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ discount: "", due_date: today, gst: "" });
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const net = Math.max(0, Number(total) - (Number(f.discount) || 0));

  async function save() {
    setError(undefined);
    if (f.discount.trim() && !AMOUNT.test(f.discount.trim())) return setError("Discount: rupees, e.g. 20");
    setBusy(true);
    const r = await api<{ id: string }>("/api/bills", {
      body: { order_id: orderId, discount: f.discount.trim() || undefined, due_date: f.due_date, zoho_gst_invoice_no: f.gst.trim() || undefined },
    });
    setBusy(false);
    if (!r.ok) return setError(r.error);
    router.push(`/bills/${r.data.id}`);
  }

  if (!open) return <Button className="w-full" onClick={() => setOpen(true)}>Make bill</Button>;
  return (
    <div className="space-y-3 rounded-2xl border border-slate-200 bg-white p-4">
      <h2 className="text-lg font-semibold">Make bill</h2>
      <p className="text-sm text-slate-600">A bill (statement of account) with this order&apos;s lines. Not a tax invoice: make the GST invoice in Zoho if needed and type its number here.</p>
      <div className="grid grid-cols-2 gap-3">
        <label className="block">
          <span className={label}>Discount ₹ (optional)</span>
          <input className={field} inputMode="decimal" value={f.discount} onChange={(e) => setF({ ...f, discount: e.target.value })} placeholder="0" />
        </label>
        <label className="block">
          <span className={label}>Due date</span>
          <input className={field} type="date" min={today} value={f.due_date} onChange={(e) => setF({ ...f, due_date: e.target.value })} />
        </label>
      </div>
      <label className="block">
        <span className={label}>Zoho GST invoice no. (optional)</span>
        <input className={field} value={f.gst} maxLength={40} onChange={(e) => setF({ ...f, gst: e.target.value })} placeholder="INV-001900" />
      </label>
      <p className="text-base font-semibold">Bill total: {money(net.toFixed(2))}</p>
      <ErrorText>{error}</ErrorText>
      <div className="flex gap-2">
        <Button className="flex-1" disabled={busy} onClick={save}>{busy ? "Saving..." : "Save bill"}</Button>
        <Button variant="secondary" onClick={() => setOpen(false)}>Cancel</Button>
      </div>
    </div>
  );
}

/** Owner: cancel a bill or a payment, with a reason. Final. */
export function CancelWithReason({ url, what, effect }: { url: string; what: string; effect: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  async function save() {
    setBusy(true);
    setError(undefined);
    const r = await api(url, { body: { reason } });
    setBusy(false);
    if (!r.ok) return setError(r.error);
    setOpen(false);
    router.refresh();
  }
  if (!open)
    return (
      <button className="min-h-10 text-sm font-semibold text-red-700" onClick={() => setOpen(true)}>
        Cancel {what}…
      </button>
    );
  return (
    <div className="space-y-2 rounded-xl border border-red-200 bg-red-50 p-3">
      <p className="text-sm text-red-900">{effect} This can&apos;t be undone.</p>
      <input className={field} value={reason} maxLength={300} onChange={(e) => setReason(e.target.value)} placeholder="Reason (e.g. typed twice)" />
      <ErrorText>{error}</ErrorText>
      <div className="flex gap-2">
        <Button className="bg-red-700 hover:bg-red-800" disabled={busy || reason.trim().length < 3} onClick={save}>{busy ? "Cancelling..." : `Cancel ${what}`}</Button>
        <Button variant="secondary" onClick={() => setOpen(false)}>Keep it</Button>
      </div>
    </div>
  );
}

/** The Zoho GST invoice no. on a bill. */
export function GstInvoice({ billId, value }: { billId: string; value: string | null }) {
  const router = useRouter();
  const [v, setV] = useState(value ?? "");
  const [error, setError] = useState<string>();
  const [saved, setSaved] = useState(false);
  async function save() {
    setError(undefined);
    const r = await api(`/api/bills/${billId}/gst`, { body: { zoho_gst_invoice_no: v } });
    if (!r.ok) return setError(r.error);
    setSaved(true);
    router.refresh();
  }
  return (
    <div className="space-y-1">
      <label className={label} htmlFor="gst">Zoho GST invoice no.</label>
      <div className="flex gap-2">
        <input id="gst" className={field} value={v} maxLength={40} onChange={(e) => { setV(e.target.value); setSaved(false); }} placeholder="INV-001900" />
        <Button variant="secondary" onClick={save} disabled={v === (value ?? "")}>{saved ? "Saved" : "Save"}</Button>
      </div>
      <ErrorText>{error}</ErrorText>
    </div>
  );
}

export function PrintButton() {
  return (
    <button className="min-h-10 text-sm font-semibold text-(--brand) print:hidden" onClick={() => window.print()}>
      Print / save as PDF
    </button>
  );
}
