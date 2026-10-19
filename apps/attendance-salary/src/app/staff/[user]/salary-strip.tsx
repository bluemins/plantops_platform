import { fmtMonth } from "@/lib/days";
import { halvesText, hoursText, rupeesText } from "@/lib/salary";
import type { SalaryMonth } from "@/server/salary";

/** The month summary strip above the Salary box (mock-up 2): counts, paid leave, overtime and remaining to pay. */
export function SalaryStrip({ month, figures }: { month: string; figures: SalaryMonth | null }) {
  if (!figures) {
    return <p className="rounded-2xl border border-slate-200 bg-white p-4 text-slate-600">No salary set for {fmtMonth(month)}.</p>;
  }
  const { counts, counted, setting, chain } = figures;
  const live = chain.live;
  const items: [string, string, string?][] = [
    ["Present", String(counts.present)],
    ["Half days", String(counts.half)],
    ["Absent", String(counts.absent)],
    ...(counts.off ? ([["Days off (paid)", String(counts.off)]] as [string, string][]) : []),
    ["Paid leave used", setting.payBasis === "per_day" ? "—" : `${halvesText(live.leaveUsedHalves)} of ${halvesText(setting.paidLeaveHalfdays)}`],
    ["Overtime", setting.getsOvertime ? `${hoursText(live.otMinutes)} h` : "—"],
    ["Remaining to pay", rupeesText(live.remainingPaise), live.remainingPaise < 0 ? "text-red-700" : "text-(--brand)"],
  ];
  return (
    <section aria-label={`${fmtMonth(month)} summary`} className="space-y-2 rounded-2xl border border-slate-200 bg-white p-4">
      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
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
