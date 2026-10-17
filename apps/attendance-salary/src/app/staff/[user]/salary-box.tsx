"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { ErrorText } from "@plantops/ui";
import { api } from "@/lib/api";
import { fmtDayLong, fmtMonth, istDay } from "@/lib/days";
import { halvesText, hoursText, paiseText, toPaise, type PayBasis } from "@/lib/salary";
import { settingText } from "@/lib/changes";
import type { HistoryRow } from "@/server/salary-edit";

const field = "min-h-12 w-full min-w-0 rounded-xl border border-slate-300 bg-white px-3 text-base focus:border-(--brand) focus:outline-none focus:ring-2 focus:ring-(--brand-ring)";
const label = "block space-y-1 text-sm font-semibold text-slate-800";
const hint = "block text-xs font-normal text-slate-600";

/** Paise as the rupees a form shows: 1200000 -> "12000", 1200050 -> "12000.50". */
const typed = (paise: number | null | undefined) => (paise == null ? "" : paise % 100 ? (paise / 100).toFixed(2) : String(paise / 100));
const dayShort = (ymd: string) => fmtDayLong(ymd).replace(/^\w+, /, "");

function initial(applies: HistoryRow | null, thisMonth: string) {
  return {
    basis: (applies?.payBasis ?? "monthly") as PayBasis,
    monthly: typed(applies?.monthlyPaise),
    dayRate: typed(applies?.dayRatePaise),
    ta: typed(applies?.kmRatePaise),
    da: typed(applies?.daDayPaise),
    field: applies?.fieldStaff ?? false,
    shift: applies ? hoursText(applies.shiftMinutes) : "8",
    leave: applies ? halvesText(applies.paidLeaveHalfdays) : "2",
    ot: applies?.getsOvertime ?? false,
    rate: typed(applies?.otRatePaise),
    from: thisMonth,
    joined: applies?.joinedOn ?? "",
    left: applies?.leftOn ?? "",
    reason: "",
  };
}

/**
 * The owner's Salary box (mock-up 2; Pay choice from docs/SALARY_EXTRAS_PHASE_PLAN.md mock-up 1): Monthly (salary +
 * paid leave) or Per day (a day rate, no paid leave), shift hours, Gets overtime + rate, from month,
 * Joined on / Last day, and the history. Saving makes a new setting from the chosen month; earlier months keep their
 * figures unless the from month is in the past (then a reason is required).
 */
export function SalaryBox({ personId, applies, history, thisMonth, months, expect }: { personId: string; applies: HistoryRow | null; history: HistoryRow[]; thisMonth: string; months: string[]; expect: string | null }) {
  const router = useRouter();
  const [f, setF] = useState(() => initial(applies, thisMonth));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [done, setDone] = useState<string>();
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((x) => ({ ...x, [k]: e.target.value }));
  const shift = Number(f.shift);
  const past = f.from < thisMonth;
  const perDay = f.basis === "per_day";
  const rate = toPaise(f.dayRate);

  async function save() {
    setBusy(true);
    setError(undefined);
    setDone(undefined);
    const r = await api("/api/salary/settings", {
      body: {
        user_id: personId,
        pay_basis: f.basis,
        // only the fields of the chosen basis are sent; the server ignores the other one anyway
        ...(perDay ? { day_rate: f.dayRate } : { monthly: f.monthly, leave_days: Number(f.leave) }),
        field_staff: f.field,
        // rates only with the Field staff tick (the server refuses them otherwise)
        ta_rate: f.field ? f.ta || null : null,
        da_rate: f.field ? f.da || null : null,
        shift_hours: Number(f.shift),
        gets_overtime: f.ot,
        ot_rate: f.ot ? f.rate : null,
        from_month: f.from,
        joined_on: f.joined || null,
        left_on: f.left || null,
        reason: f.reason || null,
        expect,
      },
    });
    setBusy(false);
    if (!r.ok) {
      setError(r.error);
      if (r.status === 409) router.refresh();
      return;
    }
    setDone(`Saved from ${fmtMonth(f.from)}.`);
    setF((x) => ({ ...x, reason: "" }));
    router.refresh();
  }

  return (
    <section aria-labelledby="salary-h" className="space-y-4 rounded-2xl border border-slate-200 bg-white p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="salary-h" className="text-lg font-bold">
          Salary
        </h2>
        <span className="text-sm text-slate-600">Only the owner sees this box.</span>
      </div>

      <fieldset className="space-y-1.5">
        <legend className="mb-1.5 text-sm font-semibold text-slate-800">Pay</legend>
        <div className="grid max-w-md grid-cols-2 overflow-hidden rounded-xl border border-slate-300">
          {(
            [
              ["monthly", "Monthly"],
              ["per_day", "Per day"],
            ] as const
          ).map(([value, text]) => (
            <label key={value} className={`flex min-h-12 cursor-pointer items-center justify-center gap-2 font-semibold ${f.basis === value ? "bg-(--brand) text-(--brand-contrast)" : "bg-white text-slate-800"}`}>
              <input type="radio" name="pay-basis" value={value} checked={f.basis === value} onChange={() => setF((x) => ({ ...x, basis: value }))} className="h-4 w-4" />
              {text}
            </label>
          ))}
        </div>
      </fieldset>

      <div className="grid gap-3 sm:grid-cols-3">
        {perDay ? (
          <label className={label}>
            <span>Day rate (₹)</span>
            <input className={field} inputMode="decimal" value={f.dayRate} onChange={set("dayRate")} placeholder="e.g. 450" />
            {rate !== null && rate > 0 && (
              <span className={hint}>
                Present day = {paiseText(rate)} · half day = {paiseText(Math.round(rate / 2))} · absent = nothing
              </span>
            )}
          </label>
        ) : (
          <label className={label}>
            <span>Monthly salary (₹)</span>
            <input className={field} inputMode="decimal" value={f.monthly} onChange={set("monthly")} placeholder="e.g. 12000" />
          </label>
        )}
        <label className={label}>
          <span>Shift hours a day</span>
          <input className={field} type="number" inputMode="decimal" min={1} max={16} step={0.5} value={f.shift} onChange={set("shift")} />
          {shift >= 1 && <span className={hint}>Full day ≥ {hoursText(shift * 60)} h · half day ≥ {hoursText(shift * 30)} h</span>}
        </label>
        {perDay ? (
          <p className="self-start rounded-xl bg-slate-100 px-3 py-2.5 text-sm text-slate-700 sm:mt-6">Paid leave doesn&apos;t apply to per-day pay.</p>
        ) : (
          <label className={label}>
            <span>Paid leave per month (days)</span>
            <input className={field} type="number" inputMode="decimal" min={0} max={10} step={0.5} value={f.leave} onChange={set("leave")} />
            <span className={hint}>Unused leave lapses at month end</span>
          </label>
        )}
      </div>

      <div className="space-y-3 rounded-xl border border-slate-200 bg-slate-50 p-3">
        <label className="flex min-h-11 items-center gap-3 font-semibold">
          <input type="checkbox" className="h-5 w-5 accent-(--brand)" checked={f.ot} onChange={(e) => setF((x) => ({ ...x, ot: e.target.checked }))} />
          Gets overtime
        </label>
        {f.ot ? (
          <div className="flex flex-wrap items-end gap-3">
            <label className={`${label} w-48`}>
              <span>Overtime rate (₹ / hour)</span>
              <input className={field} inputMode="decimal" value={f.rate} onChange={set("rate")} placeholder="e.g. 60" />
            </label>
            <span className="pb-3 text-sm text-slate-600">Hours beyond {shift >= 1 ? hoursText(shift * 60) : "the shift"} h a day are paid at this rate.</span>
          </div>
        ) : (
          <p className="text-sm text-slate-600">No overtime counted or paid. Extra hours still count towards a full day.</p>
        )}
      </div>

      <div className="space-y-3 rounded-xl border border-slate-200 bg-slate-50 p-3">
        <label className="flex min-h-11 items-center gap-3 font-semibold">
          <input type="checkbox" className="h-5 w-5 accent-(--brand)" checked={f.field} onChange={(e) => setF((x) => ({ ...x, field: e.target.checked }))} />
          Field staff: can send field duty and expense claims
        </label>
        {f.field ? (
          <>
            <div className="grid grid-cols-2 gap-3 sm:max-w-md">
              <label className={label}>
                <span>TA ₹ per km</span>
                <input className={field} inputMode="decimal" value={f.ta} onChange={set("ta")} placeholder="e.g. 3" />
              </label>
              <label className={label}>
                <span>DA ₹ per day</span>
                <input className={field} inputMode="decimal" value={f.da} onChange={set("da")} placeholder="e.g. 150" />
              </label>
            </div>
            <p className="text-sm text-slate-600">For approved field-duty claims. Leave both blank for expenses only.</p>
          </>
        ) : (
          <p className="text-sm text-slate-600">No claims from this person. You can still enter an expense for them below.</p>
        )}
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <label className={label}>
          <span>From month</span>
          <select className={field} value={f.from} onChange={set("from")}>
            {months.map((m) => (
              <option key={m} value={m}>
                {fmtMonth(m)}
              </option>
            ))}
          </select>
          <span className={hint}>Earlier months keep their old figures</span>
        </label>
        <label className={label}>
          <span>Joined on (optional)</span>
          <input className={field} type="date" value={f.joined} onChange={set("joined")} />
        </label>
        <label className={label}>
          <span>Last day (optional)</span>
          <input className={field} type="date" value={f.left} onChange={set("left")} />
        </label>
      </div>
      <p className="-mt-1 text-xs text-slate-600">Joined on / Last day only for someone who joined or left during a month: those months are paid for the days worked.</p>

      {past && (
        <label className="block space-y-1 rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm font-semibold text-amber-950">
          <span>Reason (required: {fmtMonth(f.from)} is in the past, so its figures change)</span>
          <input className={field} value={f.reason} maxLength={300} onChange={set("reason")} placeholder="e.g. raise agreed in October" />
        </label>
      )}

      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={save} disabled={busy} className="min-h-12 rounded-xl bg-(--brand) px-6 font-bold text-(--brand-contrast) hover:bg-(--brand-hover) disabled:opacity-60">
          Save salary
        </button>
        <button type="button" onClick={() => (setF(initial(applies, thisMonth)), setError(undefined), setDone(undefined))} className="min-h-12 rounded-xl border border-slate-300 bg-white px-5 font-semibold">
          Cancel
        </button>
      </div>
      {error && <ErrorText>{error}</ErrorText>}
      {done && <p className="font-semibold text-emerald-700">{done}</p>}

      <History history={history} />
    </section>
  );
}

/** "From Oct 2026: ₹12,000 · 8 h · overtime ₹60/h — bluemins, 1 Oct", newest first. */
export function History({ history }: { history: HistoryRow[] }) {
  if (history.length === 0) return <p className="text-sm text-slate-600">No salary saved yet.</p>;
  return (
    <div className="space-y-2">
      <h3 className="text-sm font-semibold text-slate-600">History</h3>
      <ul className="divide-y divide-slate-100 rounded-xl border border-slate-100 text-sm">
        {history.map((h) => (
          <li key={h.id} className="space-y-0.5 px-3 py-2.5">
            <div className="flex flex-wrap justify-between gap-x-3">
              <span>
                <strong>From {fmtMonth(h.fromMonth)}:</strong>{" "}
                {settingText({ monthly: h.monthlyPaise, day_rate: h.dayRatePaise, km_rate: h.kmRatePaise, da_day: h.daDayPaise, field: h.fieldStaff, shift: h.shiftMinutes, leave: h.paidLeaveHalfdays, ot_rate: h.getsOvertime ? h.otRatePaise : null, joined: h.joinedOn, left: h.leftOn })}
              </span>
              <span className="text-slate-600">
                {h.byName}, {dayShort(istDay(new Date(h.at)))}
              </span>
            </div>
            {h.reason && <p className="text-slate-600">Reason: {h.reason}</p>}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** "Can see own salary" (mock-up 2): saved at once, on its own. */
export function VisibilityTick({ personId, name, canSee, expect }: { personId: string; name: string; canSee: boolean; expect: string | null }) {
  const router = useRouter();
  const [on, setOn] = useState(canSee);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  async function change(next: boolean) {
    setBusy(true);
    setError(undefined);
    setOn(next);
    const r = await api("/api/salary/visibility", { body: { user_id: personId, can_see: next, expect } });
    setBusy(false);
    if (!r.ok) {
      setOn(!next);
      setError(r.error);
    }
    router.refresh();
  }

  return (
    <section className="space-y-1 rounded-2xl border border-slate-200 bg-white p-4">
      <label className="flex min-h-11 items-center gap-3 font-semibold">
        <input type="checkbox" className="h-5 w-5 accent-(--brand)" checked={on} disabled={busy} onChange={(e) => change(e.target.checked)} />
        Can see own salary
      </label>
      <p className="text-sm text-slate-700">{on ? `${name} can see how their salary was worked out, only for months you tick Paid.` : `${name} sees attendance only. No salary is shown to them.`}</p>
      {error && <ErrorText>{error}</ErrorText>}
    </section>
  );
}

/** Support's read-only view of the same box. */
export function SalaryReadOnly({ applies, history, canSee, name }: { applies: HistoryRow | null; history: HistoryRow[]; canSee: boolean; name: string }) {
  return (
    <section className="space-y-3 rounded-2xl border border-slate-200 bg-white p-4">
      <h2 className="text-lg font-bold">Salary</h2>
      {applies ? (
        <p>{settingText({ monthly: applies.monthlyPaise, day_rate: applies.dayRatePaise, km_rate: applies.kmRatePaise, da_day: applies.daDayPaise, field: applies.fieldStaff, shift: applies.shiftMinutes, leave: applies.paidLeaveHalfdays, ot_rate: applies.getsOvertime ? applies.otRatePaise : null, joined: applies.joinedOn, left: applies.leftOn })}</p>
      ) : (
        <p className="text-slate-600">No salary set.</p>
      )}
      <p className="text-sm text-slate-700">Can see own salary: {canSee ? "on" : `off (${name} sees attendance only)`}</p>
      <History history={history} />
    </section>
  );
}
