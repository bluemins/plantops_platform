"use client";

// Small client pieces of the van report pages: "Copy as WhatsApp message" and Bill / Turn down for a "not paid" line.
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button, ErrorText } from "@plantops/ui";
import { api } from "@/lib/api";
import { CustomerSearch, type Found } from "../collect-forms";

const field = "min-h-12 w-full min-w-0 rounded-xl border border-slate-300 bg-white px-3 text-base focus:border-(--brand) focus:outline-none focus:ring-2 focus:ring-(--brand-ring)";

/** The report in the WhatsApp group's layout; on plain http (no clipboard) the text is shown to select. */
export function CopyWhatsapp({ text }: { text: string }) {
  const [state, setState] = useState<"idle" | "copied" | "show">("idle");
  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setState("copied");
      setTimeout(() => setState("idle"), 2500);
    } catch {
      setState("show");
    }
  }
  return (
    <div className="space-y-2">
      <Button variant="secondary" className="w-full" onClick={copy}>{state === "copied" ? "Copied ✓" : "Copy as WhatsApp message"}</Button>
      {state === "show" && <textarea readOnly value={text} rows={10} className="w-full rounded-xl border border-slate-300 p-2 font-mono text-sm" onFocus={(e) => e.target.select()} />}
    </div>
  );
}

/** Owner, Accounts: make the bill for a "not paid" line (maybe on another customer), or turn it down. */
export function CreditActions({ id, customer, amount }: { id: string; customer: string; amount: string }) {
  const router = useRouter();
  const [mode, setMode] = useState<"none" | "other" | "down">("none");
  const [other, setOther] = useState<Found>();
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string>();
  async function bill() {
    setError(undefined);
    setBusy(true);
    const r = await api<{ number: string; customer: string }>(`/api/van-credits/${id}/bill`, { body: other ? { customer_id: other.id } : {} });
    setBusy(false);
    if (!r.ok) return setError(r.error);
    setDone(`Billed: ${r.data.number} on ${r.data.customer}'s account.`);
  }
  async function down() {
    setError(undefined);
    if (reason.trim().length < 3) return setError("Please give a reason");
    setBusy(true);
    const r = await api(`/api/van-credits/${id}/turn-down`, { body: { reason: reason.trim() } });
    setBusy(false);
    if (!r.ok) return setError(r.error);
    router.refresh();
  }
  if (done) return <p className="rounded-lg bg-green-50 px-3 py-2 text-sm text-green-800">{done}</p>;
  return (
    <div className="space-y-2">
      {mode === "other" && (
        <div className="rounded-xl border border-slate-200 p-3">
          {other ? (
            <p className="text-sm">Bill <b>{other.name}</b> ({other.phone}) instead of {customer}. <button type="button" className="font-semibold text-(--brand)" onClick={() => setOther(undefined)}>Change</button></p>
          ) : (
            <CustomerSearch onPick={setOther} placeholder="Who took it on credit? Name or mobile" />
          )}
        </div>
      )}
      {mode === "down" && <input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} className={field} placeholder="Why? e.g. paid the same evening, entered as collection" />}
      {error && <ErrorText>{error}</ErrorText>}
      <div className="flex flex-wrap gap-2">
        {mode !== "down" && <Button onClick={bill} disabled={busy || (mode === "other" && !other)}>{busy ? "Billing…" : `Bill ₹${amount.replace(/\.00$/, "")}${other ? ` to ${other.name}` : ""}`}</Button>}
        {mode === "down" && <Button onClick={down} disabled={busy}>{busy ? "Saving…" : "Turn down"}</Button>}
        {mode === "none" ? (
          <>
            <Button variant="secondary" onClick={() => setMode("other")} disabled={busy}>Another customer</Button>
            <Button variant="secondary" onClick={() => setMode("down")} disabled={busy}>Turn down</Button>
          </>
        ) : (
          <Button variant="secondary" onClick={() => { setMode("none"); setOther(undefined); setError(undefined); }} disabled={busy}>Back</Button>
        )}
      </div>
    </div>
  );
}
