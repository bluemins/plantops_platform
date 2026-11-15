"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { ErrorText } from "@plantops/ui";
import { api } from "@/lib/api";
import { fmtKm, type TimelineItem } from "@/lib/field";

const field = "min-h-11 w-full min-w-0 rounded-xl border border-slate-300 bg-white px-3 text-base focus:border-(--brand) focus:outline-none focus:ring-2 focus:ring-(--brand-ring)";

/**
 * The owner's fix on any day (docs/FIELD_DAY_PHASE_PLAN.md "Mistakes"): a start / end km corrected with a reason (the
 * photo stays), or a visit removed with a reason. Both stay on record, crossed out.
 */
export function OwnerFix({ item, startKm }: { item: TimelineItem; startKm: number | null }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [km, setKm] = useState(item.kmTenths !== null ? (item.kmTenths / 10).toFixed(1) : "");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const visit = item.kind === "visit";

  async function send() {
    setBusy(true);
    setError(undefined);
    const r = visit ? await api("/api/field/remove", { body: { event_id: item.id, reason } }) : await api("/api/field/correct", { body: { event_id: item.id, km, photo_id: null, reason } });
    setBusy(false);
    if (!r.ok) return setError(r.error);
    setOpen(false);
    router.refresh();
  }

  if (!open)
    return (
      <button type="button" onClick={() => setOpen(true)} className="min-h-9 text-sm font-semibold text-slate-600 underline">
        {visit ? "Remove visit" : "Correct km"}
      </button>
    );
  return (
    <div className="space-y-2 rounded-xl border border-slate-200 bg-slate-50 p-3">
      {!visit && (
        <label className="block space-y-1 text-sm font-semibold">
          <span>Right km reading</span>
          <input className={`${field} tabular-nums`} inputMode="decimal" value={km} onChange={(e) => setKm(e.target.value)} />
          {item.kind === "end" && startKm !== null && <span className="block font-normal text-slate-600">Start: {fmtKm(startKm)} km</span>}
        </label>
      )}
      <label className="block space-y-1 text-sm font-semibold">
        <span>{visit ? "Why remove it?" : "Why correct it?"}</span>
        <input className={field} value={reason} maxLength={300} onChange={(e) => setReason(e.target.value)} />
      </label>
      <div className="flex gap-2">
        <button type="button" onClick={send} disabled={busy} className={`min-h-11 flex-1 rounded-xl px-3 font-bold text-white disabled:opacity-60 ${visit ? "bg-red-700" : "bg-(--brand) text-(--brand-contrast)"}`}>
          {busy ? "Saving…" : visit ? "Remove visit" : "Save correction"}
        </button>
        <button type="button" onClick={() => setOpen(false)} className="min-h-11 rounded-xl border border-slate-300 bg-white px-3 font-semibold">
          Cancel
        </button>
      </div>
      {error && <ErrorText>{error}</ErrorText>}
    </div>
  );
}
