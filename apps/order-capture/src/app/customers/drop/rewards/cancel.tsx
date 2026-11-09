"use client";

import { useState } from "react";
import { Button, ErrorText } from "@plantops/ui";
import { api } from "@/lib/api";

/** Cancel a free box asked (owner, Order desk): the points go back to the shop. A reason is required. */
export function CancelReward({ id }: { id: string }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  async function cancel() {
    setBusy(true);
    setError(undefined);
    const r = await api(`/api/drop/rewards/${id}/cancel`, { body: { reason: reason.trim() } }).catch(() => null);
    setBusy(false);
    if (!r) return setError("Not saved: no connection. Check the internet and try again.");
    if (!r.ok) return setError(r.error);
    window.location.reload();
  }

  if (!open)
    return (
      <button type="button" className="text-sm font-semibold text-red-700" onClick={() => setOpen(true)}>
        Cancel this request
      </button>
    );
  return (
    <div className="space-y-2">
      <label className="block text-sm font-semibold">
        Why? <span className="font-normal text-slate-500">(the shop gets the points back)</span>
        <input className="mt-1 min-h-12 w-full rounded-xl border border-slate-300 bg-white px-3" maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} />
      </label>
      <ErrorText>{error}</ErrorText>
      <div className="flex gap-2">
        <Button variant="secondary" onClick={cancel} disabled={busy}>
          {busy ? "Cancelling…" : "Cancel request"}
        </Button>
        <button type="button" className="min-h-12 px-3 text-sm" onClick={() => setOpen(false)}>
          Keep it
        </button>
      </div>
    </div>
  );
}
