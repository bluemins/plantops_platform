"use client";

// Link bills to orders: the buttons (src/server/bill-link.ts checks everything again).
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button, ErrorText } from "@plantops/ui";
import { api } from "@/lib/api";

const field = "min-h-10 w-full min-w-0 rounded-lg border border-slate-300 bg-white px-3 text-sm focus:border-(--brand) focus:outline-none focus:ring-2 focus:ring-(--brand-ring)";

/** "Link" next to one suggested bill. */
export function LinkButton({ orderId, billId, number }: { orderId: string; billId: string; number: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  async function link() {
    setBusy(true);
    setError(undefined);
    const r = await api(`/api/orders/${orderId}/bill-link`, { body: { bill_id: billId } });
    setBusy(false);
    if (!r.ok) return setError(r.error);
    router.refresh();
  }
  return (
    <span className="flex flex-col items-end gap-1">
      <Button className="min-h-10 px-4 text-sm" disabled={busy} onClick={link} aria-label={`Link ${number}`}>{busy ? "Linking..." : "Link"}</Button>
      <ErrorText>{error}</ErrorText>
    </span>
  );
}

/** Type a bill number (e.g. INV-001755) to link a bill that wasn't suggested. */
export function FindBill({ orderId }: { orderId: string }) {
  const router = useRouter();
  const [number, setNumber] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  async function link() {
    setBusy(true);
    setError(undefined);
    const r = await api(`/api/orders/${orderId}/bill-link`, { body: { number: number.trim() } });
    setBusy(false);
    if (!r.ok) return setError(r.error);
    setNumber("");
    router.refresh();
  }
  return (
    <div className="space-y-1">
      <div className="flex gap-2">
        <label className="sr-only" htmlFor={`find-${orderId}`}>Bill number</label>
        <input id={`find-${orderId}`} className={field} value={number} maxLength={40} onChange={(e) => setNumber(e.target.value)} placeholder="Other bill: type its number, e.g. INV-001755" />
        <Button variant="secondary" className="min-h-10 shrink-0 px-4 text-sm" disabled={busy || !number.trim()} onClick={link}>{busy ? "Linking..." : "Link"}</Button>
      </div>
      <ErrorText>{error}</ErrorText>
    </div>
  );
}

/** "Link all N sure matches": shows the list first, links only after Confirm. */
export function LinkSure({ pairs }: { pairs: { order_id: string; bill_id: string; text: string }[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [done, setDone] = useState<string>();
  async function save() {
    setBusy(true);
    setError(undefined);
    const r = await api<{ linked: number; skipped: number }>("/api/bills/link-sure", { body: { pairs: pairs.map(({ order_id, bill_id }) => ({ order_id, bill_id })) } });
    setBusy(false);
    if (!r.ok) return setError(r.error);
    setOpen(false);
    setDone(`${r.data.linked} linked${r.data.skipped ? `; ${r.data.skipped} changed meanwhile, left for you` : ""}.`);
    router.refresh();
  }
  if (!pairs.length) return done ? <p className="text-sm font-semibold text-green-800">{done}</p> : null;
  if (!open)
    return (
      <div className="space-y-1">
        <Button onClick={() => setOpen(true)}>Link all {pairs.length} sure matches…</Button>
        {done && <p className="text-sm font-semibold text-green-800">{done}</p>}
      </div>
    );
  return (
    <div className="space-y-3 rounded-xl border border-(--brand) bg-(--brand-soft) p-3">
      <p className="text-sm font-semibold">These {pairs.length} bills will be linked to their orders (same customer, same amount, within 3 days):</p>
      <ul className="max-h-72 list-disc space-y-0.5 overflow-y-auto pl-5 text-sm">
        {pairs.map((p) => <li key={p.order_id}>{p.text}</li>)}
      </ul>
      <ErrorText>{error}</ErrorText>
      <div className="flex gap-2">
        <Button disabled={busy} onClick={save}>{busy ? "Linking..." : `Confirm: link ${pairs.length}`}</Button>
        <Button variant="secondary" onClick={() => setOpen(false)}>Not now</Button>
      </div>
    </div>
  );
}

/** Take a wrongly linked bill off the order, with a reason. */
export function UnlinkBill({ orderId, number }: { orderId: string; number: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  async function save() {
    setBusy(true);
    setError(undefined);
    const r = await api(`/api/orders/${orderId}/bill-unlink`, { body: { reason } });
    setBusy(false);
    if (!r.ok) return setError(r.error);
    setOpen(false);
    router.refresh();
  }
  if (!open)
    return (
      <button className="min-h-10 text-sm font-semibold text-red-700" onClick={() => setOpen(true)}>
        Not this order's bill? Unlink {number}…
      </button>
    );
  return (
    <div className="space-y-2 rounded-xl border border-red-200 bg-red-50 p-3">
      <p className="text-sm text-red-900">{number} stays as it is (and in its customer's account); this order shows "Delivered, not billed" again.</p>
      <input className={field} value={reason} maxLength={300} onChange={(e) => setReason(e.target.value)} placeholder="Reason (e.g. bill is for another order)" />
      <ErrorText>{error}</ErrorText>
      <div className="flex gap-2">
        <Button className="bg-red-700 hover:bg-red-800" disabled={busy || reason.trim().length < 3} onClick={save}>{busy ? "Unlinking..." : `Unlink ${number}`}</Button>
        <Button variant="secondary" onClick={() => setOpen(false)}>Keep it</Button>
      </div>
    </div>
  );
}
