import { addMonths, fmtDayLong, fmtMinutes, fmtMonth } from "@/lib/days";
import { DAYS_FOR_PAY, halvesText, hoursText, kmText, paiseText, rupeesText, shortDaysText } from "@/lib/salary";
import { kit } from "@/server/kit";
import { orNotFound } from "@/server/pages";
import { mySlip } from "@/server/salary-slip";
import { requirePageUser } from "@/server/session";
import { Header } from "../../../header";
import { MyTabs, myTabs } from "../../../my-tabs";

const shortDay = (ymd: string) => fmtDayLong(ymd).replace(/^\w+, /, "");
const monthOnly = (ym: string) => fmtMonth(ym).split(" ")[0];

/**
 * A worker's salary slip for one paid month (mock-up 7): ONLY the figures frozen when the owner marked it paid. Only
 * with "Can see own salary", only their own, only paid (not undone) months; 404 in every other case.
 */
export default async function MySlipPage({ params }: { params: Promise<{ month: string }> }) {
  const { month } = await params;
  const user = await requirePageUser(`/my/salary/${month}`);
  const [plant, slip] = await Promise.all([kit.branding(user.tenantId), orNotFound(mySlip(user, month))]);
  const f = slip.figures;
  const r = f.result;
  const ot = f.setting.getsOvertime;
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
    <div className="space-y-4">
      <Header user={user} plant={plant} />
      <MyTabs {...await myTabs(user)} current="salary" />
      <section className="space-y-3 rounded-2xl border border-slate-200 bg-white p-4">
        <div className="flex items-baseline justify-between gap-2">
          <h1 className="text-xl font-bold">{fmtMonth(month)}</h1>
          <span className="rounded-full bg-emerald-50 px-2.5 py-0.5 text-xs font-bold text-emerald-800">Paid {shortDay(slip.paidOn)}</span>
        </div>
        {f.band && <p className="text-xs text-slate-600">Salary type: {f.band}</p>}
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
          <span className="text-(--brand) tabular-nums">{rupeesText(slip.paidPaise)}</span>
        </div>
        {slip.remainingPaise < 0 && <p className="text-sm text-red-700">Nothing paid this month: {rupeesText(slip.remainingPaise)} is taken off next month.</p>}
        <p className="text-xs text-slate-600">
          Paid on {shortDay(slip.paidOn)} by {slip.byName}
          {slip.note ? ` · ${slip.note}` : ""}.{" "}
          {perDay ? <>Day rate {paiseText(r.dayPayPaise)}.</> : <>Day&apos;s pay = {rupeesText(f.input.monthlyPaise)} ÷ {DAYS_FOR_PAY}.</>}
        </p>
      </section>
      <a href="/my/salary" className="block text-sm font-semibold text-(--brand)">
        ‹ All paid months
      </a>
    </div>
  );
}
