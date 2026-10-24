import { addMonths, fmtDayLong, fmtMinutes, fmtMonth } from "@/lib/days";
import { DAYS_FOR_PAY, halvesText, hoursText, kmText, paiseText, rupeesText, shortDaysText, type FrozenMonth } from "@/lib/salary";
import type { SlipPayment } from "@/server/salary-slip";

const shortDay = (ymd: string) => fmtDayLong(ymd).replace(/^\w+, /, "");
const monthOnly = (ym: string) => fmtMonth(ym).split(" ")[0];

/**
 * The worker's salary slip for one month (mock-up 7), drawn from frozen figures only. The worker's own page and the
 * owner's "See as worker" preview both use it, so the preview is exactly what the worker gets. Called as a function
 * (not `<SlipCard />`) so the tests can read its text.
 */
export function slipCard({ month, figures: f, payment }: { month: string; figures: FrozenMonth; payment: SlipPayment }) {
  const r = f.result;
  const ot = f.setting.getsOvertime;
  const preview = "preview" in payment;
  // what the worker is paid: the remaining, never below zero (payMonth's rule)
  const paidPaise = preview ? Math.max(0, payment.remainingPaise) : payment.paidPaise;
  // per-day pay (rule 15): one line instead of salary / absent days / paid leave / unpaid days
  const perDay = f.input.payBasis === "per_day";
  const line = (label: string, value: string, strong = false) => (
    <div className={`flex justify-between gap-3 ${strong ? "font-bold" : ""}`}>
      <span className={strong ? "" : "text-slate-600"}>{label}</span>
      <span className="tabular-nums">{value}</span>
    </div>
  );
  // rule 21: short days and their work; slips paid before it had half days instead
  const short = f.counts.short ?? 0;
  const shortMinutes = f.counts.shortMinutes ?? 0;
  const shift = f.input.shiftMinutes ?? f.setting.shiftMinutes;
  const tiles: [string, string][] = [
    ["Full", String(f.counts.present)],
    f.counts.half ? ["Half", String(f.counts.half)] : ["Short", String(short)],
    ["Absent", String(f.counts.absent)],
  ];
  if (f.counts.off) tiles.push(["Days off", String(f.counts.off)]); // rule 20
  if (ot) tiles.push(["Overtime", fmtMinutes(r.otMinutes)]);
  const shortText = short ? ` + ${short} short (${fmtMinutes(shortMinutes)} ÷ ${hoursText(shift)} h = ${shortDaysText(shortMinutes, shift)} days)` : "";
  const halfText = f.counts.half ? ` + ${f.counts.half} half days` : "";

  return (
    <section className="space-y-3 rounded-2xl border border-slate-200 bg-white p-4">
      <div className="flex items-baseline justify-between gap-2">
        <h1 className="text-xl font-bold">{fmtMonth(month)}</h1>
        {preview ? (
          <span className="rounded-full bg-amber-50 px-2.5 py-0.5 text-xs font-bold text-amber-800">Not paid yet</span>
        ) : (
          <span className="rounded-full bg-emerald-50 px-2.5 py-0.5 text-xs font-bold text-emerald-800">Paid {shortDay(payment.paidOn)}</span>
        )}
      </div>
      {/* no salary type name: it is the owner's label, not for the worker (owner 2026-10-24) */}
      <div className={`grid gap-1.5 text-center ${tiles.length >= 4 ? "grid-cols-4" : "grid-cols-3"}`}>
        {tiles.map(([label, value]) => (
          <div key={label} className="rounded-lg bg-slate-100 p-1.5">
            <div className="font-bold">{value}</div>
            <div className="text-xs text-slate-600">{label}</div>
          </div>
        ))}
      </div>
      <div className="space-y-1.5 text-sm">
        {f.input.payBasis === "fixed" ? (
          line(f.input.fullMonth ? "Fixed monthly salary" : `Part month: ${halvesText(r.paidHalves)} days × ${paiseText(r.dayPayPaise)}`, paiseText(r.earnedPaise))
        ) : perDay ? (
          line(`${f.counts.present} full${f.counts.off && f.rules < 7 ? ` + ${f.counts.off} off` : ""}${halfText}${shortText} = ${halvesText(r.paidHalves)} days × ${paiseText(r.dayPayPaise)}`, paiseText(r.earnedPaise))
        ) : (
          <>
            {line("Monthly salary", paiseText(f.input.monthlyPaise))}
            {line(`Days missed (${f.counts.absent} absent${f.counts.off && f.rules >= 7 ? ` + ${f.counts.off} off` : ""}${f.counts.half ? ` + ${f.counts.half} half` : ""}${short ? ` + time short on ${short} short days` : ""})`, halvesText(r.absentHalves))}
            {line("Paid leave used", `${halvesText(r.leaveUsedHalves)} of ${halvesText(f.input.paidLeaveHalfdays)}`)}
            {f.input.fullMonth
              ? line(`Unpaid days ${halvesText(r.unpaidHalves)} × ${paiseText(r.dayPayPaise)}`, r.deductionPaise ? `−${paiseText(r.deductionPaise)}` : "₹0")
              : line(`Paid days ${halvesText(r.paidHalves)} × ${paiseText(r.dayPayPaise)}`, paiseText(r.earnedPaise))}
          </>
        )}
        {line("Salary earned", paiseText(r.earnedPaise), true)}
        {ot && line(`Overtime ${fmtMinutes(r.otMinutes)} × ${paiseText(f.input.otRatePaise ?? 0)}/h`, `+${paiseText(r.otPayPaise)}`)}
      </div>
      {f.fieldDutyDays > 0 && (
        <div className="space-y-1 border-t border-slate-100 pt-2 text-sm">
          <p className="text-xs font-semibold tracking-wide text-slate-600 uppercase">Field duty</p>
          {line("Field duty", `${f.fieldDutyDays} ${f.fieldDutyDays === 1 ? "day" : "days"} · ${kmText(f.kmTenths)} km`)}
          {r.taPaise !== 0 && line(`TA ${kmText(f.kmTenths)} km × ${paiseText(f.setting.kmRatePaise ?? 0)}`, `+${paiseText(r.taPaise)}`)}
          {r.daPaise !== 0 && line(`DA ${f.daDays} ${f.daDays === 1 ? "day" : "days"} × ${paiseText(f.setting.daDayPaise ?? 0)}`, `+${paiseText(r.daPaise)}`)}
        </div>
      )}
      {f.claims.some((c) => c.kind === "expense") && (
        <div className="space-y-1 border-t border-slate-100 pt-2 text-sm">
          <p className="text-xs font-semibold tracking-wide text-slate-600 uppercase">Expenses</p>
          {f.claims
            .filter((c) => c.kind === "expense")
            .map((c, i) => (
              <div key={i} className="flex justify-between gap-3">
                <span className="min-w-0 break-words">
                  {shortDay(c.onDate)} · {c.note}
                </span>
                <span className="tabular-nums">+{paiseText(c.amountPaise ?? 0)}</span>
              </div>
            ))}
          {line("Expenses", `+${paiseText(r.expensesPaise)}`, true)}
        </div>
      )}
      {f.advances.length > 0 && (
        <div className="space-y-1 border-t border-slate-100 pt-2 text-sm">
          <p className="text-xs font-semibold tracking-wide text-slate-600 uppercase">Advances taken</p>
          {f.advances.map((a, i) => (
            <div key={i} className="flex justify-between gap-3">
              <span className="min-w-0 break-words">
                {shortDay(a.onDate)}
                {a.note ? ` · ${a.note}` : ""}
              </span>
              <span className="tabular-nums">{a.amountPaise > 0 ? `−${paiseText(a.amountPaise)}` : `+${paiseText(-a.amountPaise)}`}</span>
            </div>
          ))}
        </div>
      )}
      {(r.carriedInPaise !== 0 || r.adjustmentPaise !== 0) && (
        <div className="space-y-1 text-sm">
          {r.carriedInPaise !== 0 && line(`Carried in from ${monthOnly(addMonths(month, -1))}`, `−${paiseText(r.carriedInPaise)}`)}
          {r.adjustmentPaise !== 0 && line(`Adjustment from ${monthOnly(f.adjustmentFrom ?? month)}`, `${r.adjustmentPaise > 0 ? "+" : ""}${paiseText(r.adjustmentPaise)}`)}
        </div>
      )}
      <div className="flex justify-between gap-3 border-t border-slate-100 pt-2.5 text-xl font-extrabold">
        <span>Paid to you</span>
        <span className="text-(--brand) tabular-nums">{rupeesText(paidPaise)}</span>
      </div>
      {payment.remainingPaise < 0 && <p className="text-sm text-red-700">Nothing paid this month: {rupeesText(payment.remainingPaise)} is taken off next month.</p>}
      <p className="text-xs text-slate-600">
        {preview ? (
          <>Paid on … by … (filled in when the month is marked paid). </>
        ) : (
          <>
            Paid on {shortDay(payment.paidOn)} by {payment.byName}
            {payment.note ? ` · ${payment.note}` : ""}.{" "}
          </>
        )}
        {perDay ? <>Day rate {paiseText(r.dayPayPaise)}.</> : <>Day&apos;s pay = {rupeesText(f.input.monthlyPaise)} ÷ {DAYS_FOR_PAY}.</>}
      </p>
    </section>
  );
}
