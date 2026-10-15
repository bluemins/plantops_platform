"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { ErrorText } from "@plantops/ui";
import { api } from "@/lib/api";
import { addDays, fmtDayLong } from "@/lib/days";
import { fmtTime } from "@/lib/punch";

export interface FixMark {
  id: string;
  kind: "in" | "out";
  at: string;
}

const field = "min-h-12 w-full min-w-0 rounded-xl border border-slate-300 bg-white px-3 text-base focus:border-(--brand) focus:outline-none focus:ring-2 focus:ring-(--brand-ring)";

/**
 * The owner's Fix (mock-up "Owner · Person's day + Fix"): cancel a wrong mark, or add a forgotten IN / OUT. Both need a
 * reason; nothing is overwritten. If the day changed since the page loaded, the server says so and the page reloads.
 */
export function FixPanel({ personId, name, day, today, stamp, marks }: { personId: string; name: string; day: string; today: string; stamp: string; marks: FixMark[] }) {
  const router = useRouter();
  const nextDay = addDays(day, 1);
  const [kind, setKind] = useState<"in" | "out">(marks.length % 2 === 1 ? "out" : "in");
  const [date, setDate] = useState(day);
  const [time, setTime] = useState("");
  const [reason, setReason] = useState("");
  const [cancelling, setCancelling] = useState<string | null>(null);
  const [cancelReason, setCancelReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [done, setDone] = useState<string>();

  async function send(path: string, body: Record<string, unknown>, ok: string) {
    setBusy(true);
    setError(undefined);
    setDone(undefined);
    const r = await api(path, { body: { ...body, day, expect: stamp } });
    setBusy(false);
    if (r.status === 409) {
      setError(r.error);
      router.refresh();
      return false;
    }
    if (!r.ok) {
      setError(r.error);
      return false;
    }
    setDone(ok);
    router.refresh();
    return true;
  }

  async function add() {
    if (!time) return setError("Choose the time");
    if (reason.trim().length < 3) return setError("Write a reason (at least 3 characters)");
    if (await send("/api/fix/add", { user_id: personId, kind, date, time, reason }, `Added ${kind.toUpperCase()} ${time}. ${name} will see it with your reason.`)) {
      setTime("");
      setReason("");
    }
  }

  async function cancel(id: string) {
    if (cancelReason.trim().length < 3) return setError("Write a reason (at least 3 characters)");
    if (await send("/api/fix/cancel", { punch_id: id, reason: cancelReason }, "Cancelled. It stays on record, crossed out.")) {
      setCancelling(null);
      setCancelReason("");
    }
  }

  return (
    <div className="space-y-4">
      {marks.length > 0 && (
        <section className="space-y-2 rounded-2xl border border-slate-200 bg-white p-4">
          <h2 className="text-base font-bold">Cancel a wrong mark</h2>
          <ul className="divide-y divide-slate-100">
            {marks.map((m) => (
              <li key={m.id} className="space-y-2 py-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-semibold">
                    {m.kind.toUpperCase()} {fmtTime(m.at)}
                  </span>
                  {cancelling !== m.id && (
                    <button type="button" onClick={() => (setCancelling(m.id), setCancelReason(""), setError(undefined))} className="min-h-11 rounded-xl border border-red-200 bg-white px-3 text-sm font-semibold text-red-700">
                      Cancel this mark
                    </button>
                  )}
                </div>
                {cancelling === m.id && (
                  <div className="space-y-2 rounded-xl border border-red-200 bg-red-50 p-3">
                    <label className="block space-y-1 text-sm text-red-900">
                      <span>Reason (required)</span>
                      <input className={field} value={cancelReason} maxLength={300} onChange={(e) => setCancelReason(e.target.value)} autoFocus />
                    </label>
                    <div className="grid grid-cols-2 gap-2">
                      <button type="button" onClick={() => setCancelling(null)} className="min-h-11 rounded-xl border border-slate-300 bg-white font-semibold">
                        Keep it
                      </button>
                      <button type="button" disabled={busy} onClick={() => cancel(m.id)} className="min-h-11 rounded-xl bg-red-700 font-bold text-white disabled:opacity-60">
                        Cancel mark
                      </button>
                    </div>
                  </div>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="space-y-3 rounded-2xl border-2 border-(--brand) bg-white p-4">
        <h2 className="text-base font-bold">Add a time</h2>
        <fieldset className="grid grid-cols-2 gap-2">
          <legend className="mb-1 text-sm text-slate-700">Mark</legend>
          {(["in", "out"] as const).map((k) => (
            <label key={k} className={`flex min-h-12 items-center justify-center gap-2 rounded-xl border font-semibold ${kind === k ? "border-2 border-(--brand) bg-(--brand-soft)" : "border-slate-200"}`}>
              <input type="radio" name="kind" value={k} checked={kind === k} onChange={() => setKind(k)} />
              {k.toUpperCase()}
            </label>
          ))}
        </fieldset>
        <div className="grid grid-cols-2 gap-2">
          <label className="block space-y-1 text-sm text-slate-700">
            <span>Date</span>
            <select className={field} value={date} onChange={(e) => setDate(e.target.value)}>
              <option value={day}>{fmtDayLong(day)}</option>
              {nextDay <= today && <option value={nextDay}>{fmtDayLong(nextDay)} (next morning)</option>}
            </select>
          </label>
          <label className="block space-y-1 text-sm text-slate-700">
            <span>Time</span>
            <input type="time" className={field} value={time} onChange={(e) => setTime(e.target.value)} />
          </label>
        </div>
        <label className="block space-y-1 text-sm text-slate-700">
          <span>Reason (required)</span>
          <input className={field} value={reason} maxLength={300} placeholder="e.g. forgot to scan" onChange={(e) => setReason(e.target.value)} />
        </label>
        <button type="button" onClick={add} disabled={busy} className="min-h-13 w-full rounded-xl bg-(--brand) text-lg font-bold text-(--brand-contrast) hover:bg-(--brand-hover) disabled:opacity-60">
          Save
        </button>
        <p className="text-sm text-slate-500">Nothing is overwritten: the added time and its reason stay on record. {name} gets a notification.</p>
      </section>
      {error && <ErrorText>{error}</ErrorText>}
      {done && <p className="font-semibold text-emerald-700">{done}</p>}
    </div>
  );
}
