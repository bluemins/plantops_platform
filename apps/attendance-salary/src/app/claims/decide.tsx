"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { ErrorText } from "@plantops/ui";
import { api } from "@/lib/api";

const yes = "min-h-12 flex-1 rounded-xl bg-(--brand) px-4 font-bold text-(--brand-contrast) hover:bg-(--brand-hover) disabled:opacity-60";
const no = "min-h-12 flex-1 rounded-xl border border-slate-300 bg-white px-4 font-semibold disabled:opacity-60";
const field = "min-h-11 w-full min-w-0 rounded-xl border border-red-300 bg-white px-3 text-base focus:outline-none focus:ring-2 focus:ring-red-200";

/**
 * Approve / Not approve a waiting claim, or Cancel an approved one (mock-up 5). Not approving and cancelling ask for a
 * reason the person will see. A 409 (someone else decided, or the worker withdrew it) refreshes the page.
 */
export function Decide({ claimId, status, name }: { claimId: string; status: "waiting" | "approved"; name: string }) {
  const router = useRouter();
  const [asking, setAsking] = useState<"reject" | "cancel" | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  async function send(decision: "approve" | "reject" | "cancel") {
    setBusy(true);
    setError(undefined);
    const r = await api("/api/claims/decide", { body: { claim_id: claimId, decision, reason: decision === "approve" ? null : reason } });
    setBusy(false);
    if (!r.ok) {
      setError(r.error);
      if (r.status === 409) router.refresh();
      return;
    }
    setAsking(null);
    setReason("");
    router.refresh();
  }

  if (asking) {
    return (
      <div className="space-y-2">
        <label className="block space-y-1 text-sm font-semibold text-red-900">
          <span>
            {asking === "reject" ? "Why not?" : "Why cancel?"} ({name} sees this)
          </span>
          <input className={field} value={reason} maxLength={300} onChange={(e) => setReason(e.target.value)} autoFocus />
        </label>
        <div className="flex gap-2.5">
          <button type="button" onClick={() => (setAsking(null), setError(undefined))} disabled={busy} className={no}>
            Back
          </button>
          <button type="button" onClick={() => send(asking)} disabled={busy} className="min-h-12 flex-1 rounded-xl bg-red-700 px-4 font-bold text-white disabled:opacity-60">
            {asking === "reject" ? "Not approve" : "Cancel claim"}
          </button>
        </div>
        {error && <ErrorText>{error}</ErrorText>}
      </div>
    );
  }
  return (
    <div className="space-y-2">
      {status === "waiting" ? (
        <div className="flex gap-2.5">
          <button type="button" onClick={() => send("approve")} disabled={busy} className={yes}>
            Approve
          </button>
          <button type="button" onClick={() => setAsking("reject")} disabled={busy} className={no}>
            Not approve
          </button>
        </div>
      ) : (
        <button type="button" onClick={() => setAsking("cancel")} disabled={busy} className="min-h-10 rounded-xl border border-slate-300 bg-white px-3.5 text-sm font-semibold">
          Cancel approval…
        </button>
      )}
      {error && <ErrorText>{error}</ErrorText>}
    </div>
  );
}
