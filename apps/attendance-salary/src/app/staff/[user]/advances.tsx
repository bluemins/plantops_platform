"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { ErrorText } from "@plantops/ui";
import { api } from "@/lib/api";
import { fmtDayLong, fmtMonth } from "@/lib/days";
import { paiseText } from "@/lib/salary";
import type { AdvanceEntry } from "@/server/salary-edit";

const field = "min-h-12 w-full min-w-0 rounded-xl border border-slate-300 bg-white px-3 text-base focus:border-(--brand) focus:outline-none focus:ring-2 focus:ring-(--brand-ring)";
const label = "block space-y-1 text-sm font-semibold text-slate-800";
const dayShort = (ymd: string) => fmtDayLong(ymd).replace(/^\w+, /, "");

/**
 * Advances for the month (mock-up 2): the entries, the total, + Advance, and a Correct button per advance. Entries are
 * never changed or deleted: a mistake gets a correcting (negative) entry with a reason, on the same date.
 * `editable` = false for PlantOps support (the list only).
 */
export function Advances({ personId, month, today, firstDate, entries, expect, editable }: { personId: string; month: string; today: string; firstDate: string | null; entries: AdvanceEntry[]; expect: string | null; editable: boolean }) {
  const router = useRouter();
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState(today);
  const [note, setNote] = useState("");
  const [correcting, setCorrecting] = useState<string | null>(null);
  const [fixAmount, setFixAmount] = useState("");
  const [fixReason, setFixReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [done, setDone] = useState<string>();
  const total = entries.reduce((sum, e) => sum + e.amountPaise, 0);

  async function send(body: Record<string, unknown>, ok: (onDate: string) => string) {
    setBusy(true);
    setError(undefined);
    setDone(undefined);
    const r = await api<{ onDate: string }>("/api/salary/advances", { body: { ...body, user_id: personId, expect } });
    setBusy(false);
    if (!r.ok) {
      setError(r.error);
      if (r.status === 409) router.refresh();
      return false;
    }
    setDone(ok(r.data.onDate));
    router.refresh();
    return true;
  }

  async function add() {
    if (!amount.trim()) return setError("Write the amount");
    if (await send({ kind: "advance", amount, on_date: date, note: note || null }, (d) => (d.startsWith(month) ? "Advance saved." : `Advance saved for ${fmtMonth(d.slice(0, 7))}.`))) {
      setAmount("");
      setNote("");
    }
  }

  async function correct(id: string) {
    if (!fixAmount.trim()) return setError("Write the amount to take off");
    if (fixReason.trim().length < 3) return setError("Write a reason (at least 3 characters)");
    if (await send({ kind: "correction", corrects_id: id, amount: fixAmount, reason: fixReason }, () => "Correction saved. Both entries stay on record.")) {
      setCorrecting(null);
      setFixAmount("");
      setFixReason("");
    }
  }

  return (
    <section aria-labelledby="adv-h" className="space-y-4 rounded-2xl border border-slate-200 bg-white p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="adv-h" className="text-lg font-bold">
          Advances · {fmtMonth(month)}
        </h2>
        <span className="font-bold tabular-nums">Total {paiseText(total)}</span>
      </div>

      {entries.length === 0 ? (
        <p className="text-sm text-slate-600">No advances in {fmtMonth(month)}.</p>
      ) : (
        <ul className="divide-y divide-slate-100 rounded-xl border border-slate-100 text-sm">
          {entries.map((e) => (
            <li key={e.id} className={`space-y-2 px-3 py-2.5 ${e.amountPaise < 0 ? "bg-amber-50" : ""}`}>
              <div className="grid grid-cols-[4.5rem_6.5rem_minmax(0,1fr)] items-baseline gap-2">
                <span className="text-slate-600">{dayShort(e.onDate)}</span>
                <span className={`font-bold tabular-nums ${e.amountPaise < 0 ? "text-red-700" : ""}`}>{paiseText(e.amountPaise)}</span>
                <span className="min-w-0 break-words">
                  {e.amountPaise < 0 ? `Correction: ${e.reason}` : e.note || "—"} <span className="text-slate-600">· {e.byName}</span>
                </span>
              </div>
              {editable && e.leftPaise !== null && e.leftPaise > 0 && correcting !== e.id && (
                <button type="button" onClick={() => (setCorrecting(e.id), setFixAmount(""), setFixReason(""), setError(undefined))} className="min-h-10 rounded-xl border border-slate-300 bg-white px-3 text-sm font-semibold">
                  Correct
                </button>
              )}
              {correcting === e.id && (
                <div className="space-y-2 rounded-xl border border-amber-300 bg-amber-50 p-3">
                  <p className="text-sm text-amber-950">Take an amount off this entry (at most {paiseText(e.leftPaise ?? 0)}). Both entries stay on record.</p>
                  <div className="grid gap-2 sm:grid-cols-2">
                    <label className={label}>
                      <span>Amount to take off (₹)</span>
                      <input className={field} inputMode="decimal" value={fixAmount} onChange={(x) => setFixAmount(x.target.value)} autoFocus />
                    </label>
                    <label className={label}>
                      <span>Reason (required)</span>
                      <input className={field} value={fixReason} maxLength={300} placeholder="e.g. typed twice" onChange={(x) => setFixReason(x.target.value)} />
                    </label>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <button type="button" onClick={() => setCorrecting(null)} className="min-h-11 rounded-xl border border-slate-300 bg-white font-semibold">
                      Keep it
                    </button>
                    <button type="button" disabled={busy} onClick={() => correct(e.id)} className="min-h-11 rounded-xl bg-amber-700 font-bold text-white disabled:opacity-60">
                      Save correction
                    </button>
                  </div>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      {editable && firstDate && (
        <div className="space-y-3 rounded-xl border border-dashed border-slate-300 bg-slate-50 p-3">
          <h3 className="font-bold">+ Advance</h3>
          <div className="grid gap-3 sm:grid-cols-[1fr_1fr_2fr]">
            <label className={label}>
              <span>Amount (₹)</span>
              <input className={field} inputMode="decimal" value={amount} placeholder="e.g. 1000" onChange={(e) => setAmount(e.target.value)} />
            </label>
            <label className={label}>
              <span>Date</span>
              <input className={field} type="date" value={date} min={firstDate} max={today} onChange={(e) => setDate(e.target.value)} />
            </label>
            <label className={label}>
              <span>Note (optional)</span>
              <input className={field} value={note} maxLength={200} placeholder="Cash / UPI / what for" onChange={(e) => setNote(e.target.value)} />
            </label>
          </div>
          <button type="button" onClick={add} disabled={busy} className="min-h-12 rounded-xl bg-(--brand) px-6 font-bold text-(--brand-contrast) hover:bg-(--brand-hover) disabled:opacity-60">
            Save advance
          </button>
          <p className="text-xs text-slate-600">Entries are never deleted. A mistake gets a correcting entry.</p>
        </div>
      )}
      {editable && !firstDate && <p className="text-sm text-slate-600">Set a salary first; advances can be entered after that.</p>}
      {error && <ErrorText>{error}</ErrorText>}
      {done && <p className="font-semibold text-emerald-700">{done}</p>}
    </section>
  );
}
