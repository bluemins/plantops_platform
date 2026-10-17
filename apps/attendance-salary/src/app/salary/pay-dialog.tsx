"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { createPortal } from "react-dom";
import { ErrorText } from "@plantops/ui";
import { api } from "@/lib/api";
import { fmtDayLong, fmtMonth } from "@/lib/days";
import { hoursText, paiseText, rupeesText } from "@/lib/salary";
import type { TabRow } from "@/server/salary-tab";

const field = "min-h-11 w-full min-w-0 rounded-xl border border-slate-300 bg-white px-3 text-base focus:border-(--brand) focus:outline-none focus:ring-2 focus:ring-(--brand-ring)";
const shortDay = (ymd: string) => fmtDayLong(ymd).replace(/^\w+, /, "");
const monthOnly = (ym: string) => fmtMonth(ym).split(" ")[0];

/**
 * "Mark paid" (mock-up 6): the figures that are being frozen, Paid on, a note, and whether the person will see it.
 * The page's remaining goes with it: if the figures changed meanwhile the server says so (409) and the page refreshes.
 */
export function PayDialog({ row, month, today, onClose }: { row: TabRow; month: string; today: string; onClose: () => void }) {
  const router = useRouter();
  const [paidOn, setPaidOn] = useState(today);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const r = row.result;
  const name = row.name;

  async function pay() {
    setBusy(true);
    setError(undefined);
    const res = await api("/api/salary/pay", { body: { user_id: row.userId, month, paid_on: paidOn, note: note || null, expect_remaining: r.remainingPaise } });
    setBusy(false);
    if (!res.ok) {
      setError(res.error);
      if (res.status === 409) router.refresh();
      return;
    }
    onClose();
    router.refresh();
  }

  const line = (label: string, value: string) => (
    <div className="flex justify-between gap-3">
      <span className="text-slate-600">{label}</span>
      <span className="tabular-nums">{value}</span>
    </div>
  );

  // drawn at the end of <body>: the table it is opened from widens itself with a CSS transform, which would trap a
  // fixed overlay inside the table's box
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/45 sm:items-center sm:p-4" role="presentation">
      <div role="dialog" aria-modal="true" aria-labelledby="pay-h" className="max-h-full w-full max-w-lg space-y-4 overflow-y-auto rounded-t-2xl bg-white p-5 sm:rounded-2xl">
        <h2 id="pay-h" className="text-lg font-bold">
          Mark {name}&apos;s {monthOnly(month)} salary as paid
        </h2>
        <div className="space-y-1 rounded-xl bg-slate-100 p-3 text-sm">
          {line("Salary earned", paiseText(r.earnedPaise))}
          {row.getsOvertime && line(`Overtime ${hoursText(r.otMinutes)} h × ${paiseText(row.otRatePaise ?? 0)}`, `+${paiseText(r.otPayPaise)}`)}
          {r.taPaise !== 0 && line("TA", `+${paiseText(r.taPaise)}`)}
          {r.daPaise !== 0 && line("DA", `+${paiseText(r.daPaise)}`)}
          {r.expensesPaise !== 0 && line("Expenses", `+${paiseText(r.expensesPaise)}`)}
          {r.advancesPaise !== 0 && line("Advances", `−${paiseText(r.advancesPaise)}`)}
          {r.carriedInPaise !== 0 && line(`Carried in from ${monthOnly(row.prevMonth)}`, `−${paiseText(r.carriedInPaise)}`)}
          {r.adjustmentPaise !== 0 && line(`Adjustment from ${monthOnly(row.adjustmentFrom ?? row.prevMonth)}`, `${r.adjustmentPaise > 0 ? "+" : ""}${paiseText(r.adjustmentPaise)}`)}
          <div className="mt-1 flex justify-between gap-3 border-t border-slate-200 pt-2 text-lg font-extrabold">
            <span>Paying now</span>
            <span className="tabular-nums">{paiseText(Math.max(0, r.remainingPaise))}</span>
          </div>
          {r.remainingPaise < 0 && (
            <p className="text-sm text-red-700">
              {rupeesText(r.remainingPaise)} carries to {monthOnly(row.carriesTo ?? month)}.
            </p>
          )}
        </div>
        {row.claimsWaiting > 0 && (
          <p role="alert" className="rounded-xl bg-amber-100 p-3 text-sm text-amber-950">
            {row.claimsWaiting} {row.claimsWaiting === 1 ? "claim" : "claims"} for {monthOnly(month)} {row.claimsWaiting === 1 ? "is" : "are"} still waiting. Approve or reject{" "}
            {row.claimsWaiting === 1 ? "it" : "them"} first; if you approve {row.claimsWaiting === 1 ? "it" : "them"} later {row.claimsWaiting === 1 ? "it comes" : "they come"} as an adjustment next month.
          </p>
        )}
        <div className="grid gap-3 sm:grid-cols-[1fr_1.4fr]">
          <label className="block space-y-1 text-sm font-semibold">
            <span>Paid on</span>
            <input className={field} type="date" value={paidOn} max={today} onChange={(e) => setPaidOn(e.target.value)} />
          </label>
          <label className="block space-y-1 text-sm font-semibold">
            <span>Note (optional)</span>
            <input className={field} value={note} maxLength={200} placeholder="Cash / UPI / bank" onChange={(e) => setNote(e.target.value)} />
          </label>
        </div>
        <p className="rounded-xl bg-(--brand-soft) p-3 text-sm">
          The figures are frozen now.{" "}
          {row.canSee ? (
            <>
              <strong>{name} can see how it was worked out</strong> (Can see own salary is on) and gets a notification.
            </>
          ) : (
            <>
              {name} sees attendance only (Can see own salary is off).
            </>
          )}
        </p>
        {error && <ErrorText>{error}</ErrorText>}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="min-h-12 rounded-xl border border-slate-300 bg-white px-5 font-semibold">
            Cancel
          </button>
          <button type="button" onClick={pay} disabled={busy} className="min-h-12 rounded-xl bg-(--brand) px-6 font-bold text-(--brand-contrast) hover:bg-(--brand-hover) disabled:opacity-60">
            Mark paid
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

/** Undo a payment, with a reason (once). */
export function UndoForm({ row, onDone }: { row: TabRow; onDone: () => void }) {
  const router = useRouter();
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  async function undo() {
    if (reason.trim().length < 3) return setError("Write a reason (at least 3 characters)");
    setBusy(true);
    setError(undefined);
    const res = await api("/api/salary/pay/undo", { body: { payment_id: row.payment!.id, reason } });
    setBusy(false);
    if (!res.ok) {
      setError(res.error);
      router.refresh();
      return;
    }
    onDone();
    router.refresh();
  }

  return (
    <div className="space-y-2 rounded-xl border border-red-200 bg-red-50 p-3 text-left whitespace-normal">
      <label className="block space-y-1 text-sm text-red-900">
        <span>Why undo {row.name}&apos;s payment? (required)</span>
        <input className={field} value={reason} maxLength={300} onChange={(e) => setReason(e.target.value)} autoFocus />
      </label>
      <div className="grid grid-cols-2 gap-2">
        <button type="button" onClick={onDone} className="min-h-11 rounded-xl border border-slate-300 bg-white font-semibold">
          Keep it
        </button>
        <button type="button" disabled={busy} onClick={undo} className="min-h-11 rounded-xl bg-red-700 font-bold text-white disabled:opacity-60">
          Undo paid
        </button>
      </div>
      {error && <ErrorText>{error}</ErrorText>}
    </div>
  );
}

/**
 * The Paid cell / section: "Mark paid" (from the month's last day), or "✓ Paid 31 Oct" with Undo. `canPay` = false
 * for PlantOps support (the text only).
 */
export function PaidStatus({ row, month, today, payable, payableFrom, canPay }: { row: TabRow; month: string; today: string; payable: boolean; payableFrom: string; canPay: boolean }) {
  const [paying, setPaying] = useState(false);
  const [undoing, setUndoing] = useState(false);
  if (row.payment) {
    return (
      <div className="space-y-1">
        <span className="font-semibold text-emerald-800">✓ Paid {shortDay(row.payment.paidOn)}</span>
        {canPay && !undoing && (
          <button type="button" onClick={() => setUndoing(true)} className="ml-2 min-h-9 text-sm font-semibold text-(--brand) underline">
            Undo
          </button>
        )}
        {undoing && <UndoForm row={row} onDone={() => setUndoing(false)} />}
      </div>
    );
  }
  if (!canPay) return <span className="text-slate-500">Not paid</span>;
  if (!payable) return <span className="text-sm text-slate-500">Mark paid from {shortDay(payableFrom)}</span>;
  return (
    <>
      <button type="button" onClick={() => setPaying(true)} className="min-h-10 rounded-xl border border-(--brand) px-3 text-sm font-semibold text-(--brand)">
        Mark paid
      </button>
      {paying && <PayDialog row={row} month={month} today={today} onClose={() => setPaying(false)} />}
    </>
  );
}
