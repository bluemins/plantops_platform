import { fmtMinutes, fmtMonth } from "@/lib/days";
import { halvesText, rupeesText, shortDaysText } from "@/lib/salary";
import type { SalaryMonth } from "@/server/salary";

/** "2 · 1 choice": paid holiday days, and how many of them are choice leave (rule 24). */
export const holidayText = (c: { holiday?: number; choice?: number }) => `${c.holiday ?? 0}${c.choice ? ` · ${c.choice} choice` : ""}`;

/** The month summary strip above the Salary box (mock-up 2): counts, paid leave, overtime and remaining to pay. */
export function SalaryStrip({ month, figures }: { month: string; figures: SalaryMonth | null }) {
  if (!figures) {
    return <p className="rounded-2xl border border-slate-200 bg-white p-4 text-slate-600">No salary set for {fmtMonth(month)}.</p>;
  }
  const { counts, counted, setting, chain } = figures;
  const live = chain.live;
  const items: [string, string, string?][] = [
    ["Full days", String(counts.present)],
    // rule 21: short days, their work and what it counts as
    ["Short days", counts.short ? `${counts.short} · ${fmtMinutes(counts.shortMinutes ?? 0)} = ${shortDaysText(counts.shortMinutes ?? 0, setting.shiftMinutes)} d` : "0"],
    ["Absent", String(counts.absent)],
    ...(counts.off ? ([["Days off (not paid)", String(counts.off)]] as [string, string][]) : []),
    // rule 24: the person's own holidays (Paid + choice leave taken) and work on Paid holidays, paid on top
    ...(counts.holiday ? ([["Paid holidays", holidayText(counts)]] as [string, string][]) : []),
    ...(live.holidayWorkPaise ? ([["Worked on holiday", `+${rupeesText(live.holidayWorkPaise)}`]] as [string, string][]) : []),
    ["Paid leave used", setting.payBasis !== "monthly" ? "—" : `${halvesText(live.leaveUsedHalves)} of ${halvesText(setting.paidLeaveHalfdays)}`],
    ...(setting.payBasis === "per_day" ? ([["Days paid", halvesText(live.paidHalves)]] as [string, string][]) : []),
    ["Overtime", setting.getsOvertime ? fmtMinutes(live.otMinutes) : "—"],
    ["Remaining to pay", rupeesText(live.remainingPaise), live.remainingPaise < 0 ? "text-red-700" : "text-(--brand)"],
  ];
  return (
    <section aria-label={`${fmtMonth(month)} summary`} className="space-y-2 rounded-2xl border border-slate-200 bg-white p-4">
      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        {items.map(([label, value, tone]) => (
          <div key={label}>
            <dt className="text-sm text-slate-600">{label}</dt>
            <dd className={`text-xl font-bold tabular-nums ${tone ?? ""}`}>{value}</dd>
          </div>
        ))}
      </dl>
      {!counted.complete && (
        <p className="text-sm text-slate-600">
          So far · {counted.dates.length} of {counted.monthLength} days
        </p>
      )}
    </section>
  );
}
