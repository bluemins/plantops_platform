"use client";

import { useState } from "react";
import { ErrorText } from "@plantops/ui";
import { api } from "@/lib/api";

/** Owner: close the poll now (shops can't answer after this). */
export function ClosePoll({ id }: { id: string }) {
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  async function close() {
    if (!window.confirm("Close this poll now? Shops can't answer it after this.")) return;
    setBusy(true);
    const r = await api(`/api/drop/polls/${id}/close`, { body: {} }).catch(() => null);
    setBusy(false);
    if (!r) return setError("Not saved: no connection. Check the internet and try again.");
    if (!r.ok) return setError(r.error);
    window.location.reload();
  }
  return (
    <div>
      <ErrorText>{error}</ErrorText>
      <button type="button" disabled={busy} onClick={close} className="min-h-12 w-full rounded-xl border border-red-300 bg-white font-semibold text-red-700">
        {busy ? "Closing…" : "Close this poll now"}
      </button>
    </div>
  );
}
