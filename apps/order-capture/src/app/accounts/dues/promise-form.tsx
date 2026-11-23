"use client";
// Promise to pay on a customer's dues card (owner, 2026-11-23). The server checks everything again.
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button, ErrorText } from "@plantops/ui";
import { api } from "@/lib/api";

const field = "mt-1 min-h-11 w-full min-w-0 rounded-lg border border-slate-300 bg-white px-2 text-base text-slate-900";

export function PromiseForm({ customerKey, today, last, again }: { customerKey: string; today: string; last: string; again: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [date, setDate] = useState("");
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  if (!open)
    return (
      <button type="button" onClick={() => setOpen(true)} className="min-h-11 w-full rounded-lg border border-(--brand) bg-white text-sm font-bold text-(--brand)">
        {again ? "Change promise date" : "Promise to pay"}
      </button>
    );

  async function save() {
    if (!date) return setError("Pick the promised date");
    setBusy(true);
    setError(undefined);
    const r = await api("/api/accounts/promises", { body: { customer_key: customerKey, promised_on: date, amount, note } });
    setBusy(false);
    if (!r.ok) return setError(r.error);
    setOpen(false);
    setDate("");
    setAmount("");
    setNote("");
    router.refresh();
  }

  return (
    <div className="space-y-2 rounded-lg bg-slate-50 p-2">
      <div className="grid grid-cols-2 gap-2">
        <label className="text-xs text-slate-600">Will pay on
          <input type="date" min={today} max={last} value={date} onChange={(e) => setDate(e.target.value)} className={field} />
        </label>
        <label className="text-xs text-slate-600">Amount (optional)
          <input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="₹" className={field} />
        </label>
      </div>
      <label className="block text-xs text-slate-600">Note (optional)
        <input maxLength={200} value={note} onChange={(e) => setNote(e.target.value)} className={field} />
      </label>
      {error && <ErrorText>{error}</ErrorText>}
      <div className="grid grid-cols-2 gap-2">
        <Button variant="secondary" disabled={busy} onClick={() => setOpen(false)}>Cancel</Button>
        <Button disabled={busy} onClick={save}>{busy ? "Saving…" : "Save"}</Button>
      </div>
    </div>
  );
}
