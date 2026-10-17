"use client";

import { useState } from "react";
import { addMonths, fmtDayLong, fmtMonth } from "@/lib/days";
import { halvesText, hoursText, paiseText, rupeesText } from "@/lib/salary";
import type { SalaryTab, TabRow } from "@/server/salary-tab";
import { CheckPanel } from "./check-panel";
import { PaidStatus } from "./pay-dialog";

const monthOnly = (ym: string) => fmtMonth(ym).split(" ")[0];
const signed = (paise: number) => `${paise > 0 ? "+" : ""}${paiseText(paise)}`;

/** Under a name: "Changed after payment: +₹400 → November" (paid months) and "Adjustment from September: +₹400". */
function RowNotes({ r, month }: { r: TabRow; month: string }) {
  return (
    <>
      {r.payment && r.changedPaise !== 0 && (
        <span className="block text-xs font-semibold text-amber-800">
          Changed after payment: {signed(r.changedPaise)} → {monthOnly(addMonths(month, 1))}
        </span>
      )}
      {r.result.adjustmentPaise !== 0 && (
        <span className="block text-xs text-slate-600">
          Adjustment from {monthOnly(r.adjustmentFrom ?? r.prevMonth)}: {signed(r.result.adjustmentPaise)}
        </span>
      )}
      {r.claimsWaiting > 0 && (
        <span className="hidden text-xs font-semibold text-amber-800 lg:block">
          {r.claimsWaiting} {r.claimsWaiting === 1 ? "claim" : "claims"} waiting
        </span>
      )}
    </>
  );
}

/** The small "per day" tag beside a per-day person's name (mock-up 6). */
function PerDayTag({ r }: { r: TabRow }) {
  return (
    <>
      {r.payBasis === "per_day" && <span className="ml-1.5 rounded-md bg-blue-100 px-1.5 py-0.5 text-xs font-bold text-blue-900">per day</span>}
      {/* Permanent / Temporary (docs/ATTENDANCE_ROLES_PHASE_PLAN.md mock-up 9) */}
      {r.staffType === "temporary" && <span className="ml-1.5 rounded-md bg-amber-100 px-1.5 py-0.5 text-xs font-bold text-amber-900 uppercase">temp</span>}
    </>
  );
}

/** "₹12,000" for a monthly person, "₹450 / day" for a per-day one. */
const payText = (r: TabRow) => (r.payBasis === "per_day" ? `${rupeesText(r.dayRatePaise ?? 0)} / day` : rupeesText(r.input.monthlyPaise));

const thBase = "px-2 py-2.5 text-xs font-semibold tracking-wide whitespace-nowrap text-slate-600 uppercase";
const th = `${thBase} text-right`;
const td = "px-2 py-1.5 text-right tabular-nums whitespace-nowrap";

/**
 * The month's people (mock-ups 1 and 3): a table on a PC (scrolling inside its box) with a total row, a list on a
 * phone. Tapping a person opens the checking panel: a drawer on the right on a PC (the page is too narrow for it
 * beside the table), full screen on a phone.
 */
export function SalaryTable({ tab, canPay }: { tab: SalaryTab; canPay: boolean }) {
  const [open, setOpen] = useState<string | null>(null);
  const row = tab.rows.find((r) => r.userId === open) ?? null;
  const t = tab.totals;

  return (
    <div className="space-y-2">
      <p className="text-sm text-slate-600">Tap a name to check how their salary was worked out.</p>
      {/* on a PC the table widens past the app's narrow page column (centred, up to 1200 px) so every column fits */}
      <section aria-label="Salary this month" className="rounded-2xl border border-slate-200 bg-white lg:relative lg:left-1/2 lg:w-[min(75rem,calc(100vw-2rem))] lg:-translate-x-1/2">
        {/* PC: the table */}
        <div className="hidden overflow-x-auto lg:block">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr>
                <th className={`${thBase} pl-4 text-left`}>Person</th>
                <th className={th}>Salary</th>
                <th className={th}>Present</th>
                <th className={th}>Half</th>
                <th className={th}>Absent</th>
                <th className={th}>Paid leave</th>
                <th className={th}>OT hours</th>
                <th className={th}>Earned</th>
                <th className={th}>OT pay</th>
                <th className={th}>TA</th>
                <th className={th}>DA</th>
                <th className={th}>Expenses</th>
                <th className={th}>Advances</th>
                <th className={th}>Carried in</th>
                <th className={th}>Remaining</th>
                <th className={`${thBase} pr-4 text-left`}>Paid</th>
              </tr>
            </thead>
            <tbody>
              {tab.rows.map((r) => (
                <tr key={r.userId} className={`border-t border-slate-100 ${open === r.userId ? "bg-(--brand-soft)" : ""}`}>
                  <td className="px-2 py-0.5">
                    <button type="button" onClick={() => setOpen(r.userId)} aria-expanded={open === r.userId} className="min-h-11 px-2 text-left font-semibold whitespace-nowrap">
                      {r.name}
                      <PerDayTag r={r} /> <span className="text-(--brand)">›</span>
                      {r.former && <span className="ml-1 text-xs font-normal text-slate-500">(left)</span>}
                    </button>
                    <span className="block px-2 pb-1">
                      <RowNotes r={r} month={tab.month} />
                    </span>
                  </td>
                  <td className={td}>{payText(r)}</td>
                  <td className={td}>{r.counts.present}</td>
                  <td className={td}>{r.counts.half}</td>
                  <td className={td}>{r.counts.absent}</td>
                  <td className={td}>{r.payBasis === "per_day" ? "—" : halvesText(r.result.leaveUsedHalves)}</td>
                  <td className={td}>{r.getsOvertime ? hoursText(r.result.otMinutes) : "—"}</td>
                  <td className={td}>{rupeesText(r.result.earnedPaise)}</td>
                  <td className={td}>{r.getsOvertime ? rupeesText(r.result.otPayPaise) : "—"}</td>
                  <td className={td}>{r.kmRatePaise || r.result.taPaise ? rupeesText(r.result.taPaise) : "—"}</td>
                  <td className={td}>{r.daDayPaise || r.result.daPaise ? rupeesText(r.result.daPaise) : "—"}</td>
                  <td className={td}>{rupeesText(r.result.expensesPaise)}</td>
                  <td className={td}>{rupeesText(r.result.advancesPaise)}</td>
                  <td className={td}>{rupeesText(r.result.carriedInPaise)}</td>
                  <td className={`${td} font-bold ${r.result.remainingPaise < 0 ? "text-red-700" : ""}`}>{rupeesText(r.result.remainingPaise)}</td>
                  <td className="px-2 py-1.5 pr-4 whitespace-nowrap">
                    <PaidStatus row={r} month={tab.month} today={tab.today} payable={tab.payable} payableFrom={tab.payableFrom} canPay={canPay} />
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-slate-200 font-bold">
                <td className="px-4 py-3">Total</td>
                {/* monthly salaries only; "—" when everyone is paid per day (₹0 would read as no pay) */}
                <td className={td}>{tab.rows.some((r) => r.payBasis === "monthly") ? rupeesText(t.salaryPaise) : "—"}</td>
                <td colSpan={5} />
                <td className={td}>{rupeesText(t.earnedPaise)}</td>
                <td className={td}>{rupeesText(t.otPayPaise)}</td>
                <td className={td}>{rupeesText(t.taPaise)}</td>
                <td className={td}>{rupeesText(t.daPaise)}</td>
                <td className={td}>{rupeesText(t.expensesPaise)}</td>
                <td className={td}>{rupeesText(t.advancesPaise)}</td>
                <td className={td}>{rupeesText(t.carriedInPaise)}</td>
                <td className={td}>{rupeesText(t.remainingPaise)}</td>
                <td className="px-2 py-3 pr-4 whitespace-nowrap text-emerald-800">
                  {tab.rows.filter((r) => r.payment).length} of {tab.rows.length} paid
                </td>
              </tr>
            </tfoot>
          </table>
        </div>

        {/* phone: the list */}
        <ul className="divide-y divide-slate-100 lg:hidden">
          {tab.rows.map((r) => {
            const parts = [`${r.counts.present} P`, `${r.counts.half} ½`, `${r.counts.absent} A`];
            if (r.payBasis === "per_day") parts.unshift(payText(r));
            if (r.getsOvertime) parts.push(`OT ${hoursText(r.result.otMinutes)} h`);
            // claims (mock-up 6): "TA ₹546 · DA ₹900 · Exp ₹1,650", only what there is
            if (r.result.taPaise) parts.push(`TA ${rupeesText(r.result.taPaise)}`);
            if (r.result.daPaise) parts.push(`DA ${rupeesText(r.result.daPaise)}`);
            if (r.result.expensesPaise) parts.push(`Exp ${rupeesText(r.result.expensesPaise)}`);
            if (r.result.advancesPaise) parts.push(`Adv ${rupeesText(r.result.advancesPaise)}`);
            if (r.result.carriedInPaise) parts.push(`carried ${rupeesText(r.result.carriedInPaise)}`);
            return (
              <li key={r.userId}>
                <button type="button" onClick={() => setOpen(r.userId)} className="flex min-h-14 w-full items-center justify-between gap-3 px-4 py-2.5 text-left">
                  <span className="min-w-0">
                    <span className="block font-semibold">
                      {r.name}
                      <PerDayTag r={r} />
                      {r.former && <span className="ml-1 text-xs font-normal text-slate-500">(left)</span>}
                    </span>
                    <span className="block text-xs text-slate-600">{parts.join(" · ")}</span>
                    {r.claimsWaiting > 0 && (
                      <span className="block text-xs font-semibold text-amber-800">
                        {r.claimsWaiting} {r.claimsWaiting === 1 ? "claim" : "claims"} waiting
                      </span>
                    )}
                    {r.payment && <span className="block text-xs font-semibold text-emerald-800">✓ Paid {fmtDayLong(r.payment.paidOn).replace(/^\w+, /, "")}</span>}
                    <RowNotes r={r} month={tab.month} />
                  </span>
                  <span className={`font-bold whitespace-nowrap ${r.result.remainingPaise < 0 ? "text-red-700" : ""}`}>{rupeesText(r.result.remainingPaise)} ›</span>
                </button>
              </li>
            );
          })}
        </ul>
      </section>

      {row && (
        <aside aria-label={`Check ${row.name}'s salary`} className="fixed inset-0 z-40 overflow-y-auto bg-white p-4 lg:left-auto lg:w-[28rem] lg:border-l-2 lg:border-(--brand) lg:shadow-2xl">
          <CheckPanel key={row.userId} row={row} month={tab.month} monthLength={tab.monthLength} complete={tab.complete} onClose={() => setOpen(null)}>
            <div className="space-y-2 border-t border-slate-200 pt-3">
              <h3 className="text-sm font-semibold text-slate-600">Paid</h3>
              <PaidStatus row={row} month={tab.month} today={tab.today} payable={tab.payable} payableFrom={tab.payableFrom} canPay={canPay} />
              {row.payment && <p className="text-sm text-slate-600">The figures above are the ones frozen when it was marked paid.</p>}
            </div>
          </CheckPanel>
        </aside>
      )}
    </div>
  );
}
