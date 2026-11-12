"use client";

// With staff (docs/CASHBOOK_PHASE_PLAN.md section 9, C4): "+ Spent" (owner, Accounts) and cancelling a wrong one (owner).
// The server checks everything again (never more than is open with the person, never your own).
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button, ErrorText } from "@plantops/ui";
import { api } from "@/lib/api";
import { paise, signedMoney } from "@/lib/cash";

const field = "min-h-12 w-full min-w-0 rounded-xl border border-slate-300 bg-white px-3 text-base focus:border-(--brand) focus:outline-none focus:ring-2 focus:ring-(--brand-ring)";
const label = "mb-1 block text-sm font-medium text-slate-700";
const AMOUNT = /^\d{1,8}(\.\d{1,2})?$/;

export function SpendForm({ personKey, person, open, today, categories }: { personKey: string; person: string; open: string; today: string; categories: { id: string; name: string }[] }) {
  const router = useRouter();
  const [show, setShow] = useState(false);
  const [f, setF] = useState({ amount: "", spent_on: today, category_id: "", paid_to: "", note: "" });
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  async function save() {
    setError(undefined);
    if (!AMOUNT.test(f.amount.trim()) || Number(f.amount) <= 0) return setError("Amount: rupees, e.g. 450");
    if (paise(f.amount.trim()) > paise(open)) return setError(`Only ${signedMoney(paise(open))} is open with ${person}`);
    if (!f.category_id) return setError("Pick what it was spent on");
    setBusy(true);
    const r = await api("/api/cash/spends", { body: { person_key: personKey, amount: f.amount.trim(), spent_on: f.spent_on, category_id: f.category_id, paid_to: f.paid_to.trim() || undefined, note: f.note.trim() || undefined } });
    setBusy(false);
    if (!r.ok) return setError(r.error);
    setShow(false);
    setF({ amount: "", spent_on: today, category_id: "", paid_to: "", note: "" });
    router.refresh();
  }
  if (!show) return <Button variant="secondary" className="w-full" onClick={() => setShow(true)}>+ Spent from this cash</Button>;
  return (
    <div className="space-y-3 rounded-2xl border border-slate-200 bg-slate-50 p-3">
      <p className="font-semibold">Spent by {person}</p>
      <div>
        <span className={label}>What for</span>
        <div className="grid grid-cols-2 gap-2">
          {categories.map((c) => (
            <button key={c.id} type="button" onClick={() => setF({ ...f, category_id: c.id })} className={`min-h-12 rounded-xl border px-3 text-sm font-semibold ${f.category_id === c.id ? "border-2 border-(--brand) bg-(--brand-soft) text-(--brand)" : "border-slate-300 bg-white text-slate-700"}`}>{c.name}</button>
          ))}
        </div>
      </div>
      <label className="block"><span className={label}>Amount (₹), at most {signedMoney(paise(open))}</span><input inputMode="decimal" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} className={`${field} text-lg font-semibold`} /></label>
      <label className="block"><span className={label}>Day</span><input type="date" value={f.spent_on} max={today} onChange={(e) => setF({ ...f, spent_on: e.target.value })} className={field} /></label>
      <label className="block"><span className={label}>Paid to (optional)</span><input value={f.paid_to} onChange={(e) => setF({ ...f, paid_to: e.target.value })} maxLength={100} className={field} placeholder="e.g. mess, packet supplier" /></label>
      <label className="block"><span className={label}>Note (optional)</span><input value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} maxLength={300} className={field} /></label>
      {error && <ErrorText>{error}</ErrorText>}
      <div className="grid grid-cols-2 gap-2">
        <Button variant="secondary" onClick={() => setShow(false)} disabled={busy}>Cancel</Button>
        <Button onClick={save} disabled={busy}>{busy ? "Saving…" : "Save"}</Button>
      </div>
    </div>
  );
}

export function CancelSpend({ id }: { id: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  async function save() {
    setError(undefined);
    if (reason.trim().length < 3) return setError("Please give a reason");
    setBusy(true);
    const r = await api(`/api/cash/spends/${id}/cancel`, { body: { reason: reason.trim() } });
    setBusy(false);
    if (!r.ok) return setError(r.error);
    setOpen(false);
    router.refresh();
  }
  if (!open) return <button type="button" className="text-xs font-semibold text-red-700 underline" onClick={() => setOpen(true)}>Cancel</button>;
  return (
    <div className="mt-2 space-y-2 rounded-xl border border-red-200 bg-red-50 p-3">
      <input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} className={field} placeholder="Why cancel? e.g. entered twice" />
      {error && <ErrorText>{error}</ErrorText>}
      <div className="grid grid-cols-2 gap-2">
        <Button variant="secondary" onClick={() => setOpen(false)} disabled={busy}>Keep it</Button>
        <Button onClick={save} disabled={busy}>{busy ? "Saving…" : "Cancel it"}</Button>
      </div>
    </div>
  );
}
