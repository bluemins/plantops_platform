"use client";

import { useEffect, useState } from "react";
import { addMonths, fmtDayLong, fmtMinutes, fmtMonth } from "@/lib/days";
import { halvesText, paiseText, rupeesText } from "@/lib/salary";
import { daysText, extrasPaise, takenPaise } from "@/lib/salary-view";
import type { SalaryTab, TabRow } from "@/server/salary-tab";
import { CheckPanel } from "./check-panel";
import { PaidStatus } from "./pay-dialog";

const monthOnly = (ym: string) => fmtMonth(ym).split(" ")[0];
const signed = (paise: number) => `${paise > 0 ? "+" : ""}${paiseText(paise)}`;
/** "—" for nothing, so a column of zeros stays quiet */
const moneyOrDash = (paise: number) => (paise ? rupeesText(paise) : "—");

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

const perDayTag = "rounded-md bg-blue-100 px-1.5 py-0.5 text-xs font-bold text-blue-900";
const tempTag = "rounded-md bg-amber-100 px-1.5 py-0.5 text-xs font-bold text-amber-900 uppercase";

/** The small "per day" / "temp" tags beside a per-day or temporary person's name (phone list). */
function PerDayTag({ r }: { r: TabRow }) {
  return (
    <>
      {r.payBasis === "per_day" && <span className={`ml-1.5 ${perDayTag}`}>per day</span>}
      {r.payBasis === "fixed" && <span className={`ml-1.5 ${perDayTag}`}>fixed</span>}
      {/* Permanent / Temporary (docs/ATTENDANCE_ROLES_PHASE_PLAN.md mock-up 9) */}
      {r.staffType === "temporary" && <span className={`ml-1.5 ${tempTag}`}>temp</span>}
    </>
  );
}

/** The same tags under the name (PC table), so the Person column stays narrow (owner, 2026-10-19). */
function TagsUnder({ r }: { r: TabRow }) {
  if (r.payBasis === "monthly" && r.staffType !== "temporary" && !r.former) return null;
  return (
    <span className="mt-0.5 flex gap-1">
      {r.payBasis === "per_day" && <span className={perDayTag}>per day</span>}
      {r.payBasis === "fixed" && <span className={perDayTag}>fixed</span>}
      {r.staffType === "temporary" && <span className={tempTag}>temp</span>}
      {r.former && <span className="text-xs font-normal text-slate-500">(left)</span>}
    </span>
  );
}

/** "₹12,000" for a monthly person, "₹450 / day" for a per-day one. */
const payText = (r: TabRow) => (r.payBasis === "per_day" ? `${rupeesText(r.dayRatePaise ?? 0)} / day` : rupeesText(r.input.monthlyPaise));
/** no paid leave on the day-rate and fixed types */
const leaveOf = (r: TabRow) => (r.payBasis === "monthly" ? r.result.leaveUsedHalves : null);
/** the work hours the row's days were counted with (the frozen ones for a paid month) */
const shiftOf = (r: TabRow) => r.input.shiftMinutes ?? r.shiftMinutes;

const thBase = "px-2 py-2.5 text-xs font-semibold tracking-wide whitespace-nowrap text-slate-600 uppercase";
const th = `${thBase} text-right`;
const td = "px-2 py-1.5 text-right tabular-nums whitespace-nowrap";
const SHOW_ALL_KEY = "attendance.salary.showAllColumns";

/**
 * The month's people: a table on a PC (scrolling inside its box) with a total row, a list on a phone. The table's
 * short form (owner, 2026-10-19) merges columns into Days, Extras and Taken; "Show all columns" shows each one again.
 * Tapping a person opens the checking panel with every figure: a drawer on the right on a PC, full screen on a phone.
 */
export function SalaryTable({ tab, canPay }: { tab: SalaryTab; canPay: boolean }) {
  const [open, setOpen] = useState<string | null>(null);
  const [all, setAll] = useState(false);
  const row = tab.rows.find((r) => r.userId === open) ?? null;
  const t = tab.totals;

  // the switch is remembered per browser; read after the first render so server and browser HTML match
  useEffect(() => {
    try {
      setAll(localStorage.getItem(SHOW_ALL_KEY) === "1");
    } catch {
      /* storage blocked: start with the short form */
    }
  }, []);
  function toggleAll(on: boolean) {
    setAll(on);
    try {
      localStorage.setItem(SHOW_ALL_KEY, on ? "1" : "0");
    } catch {
      /* not remembered, still switched */
    }
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-slate-600">
          {/* the salary types on this tab, keyed to the row tags ("per day", "fixed"; monthly has no tag) */}
          {[...new Set(tab.rows.map((r) => (r.band ? `${r.band}${r.payBasis === "per_day" ? " (per day)" : r.payBasis === "fixed" ? " (fixed)" : ""}` : null)).filter(Boolean))].join(" · ")}
          {tab.rows.some((r) => r.band) ? ". " : ""}Tap a name to check how their salary was worked out.
        </p>
        <label htmlFor="salary-show-all" className="hidden cursor-pointer items-center gap-2 text-sm font-medium lg:flex">
          <input id="salary-show-all" type="checkbox" checked={all} onChange={(e) => toggleAll(e.target.checked)} className="size-4 accent-(--brand)" />
          Show all columns
        </label>
      </div>
      {/* on a PC the table widens past the app's narrow page column (centred, up to 1200 px) so every column fits */}
      <section aria-label="Salary this month" className="rounded-2xl border border-slate-200 bg-white lg:relative lg:left-1/2 lg:w-[min(75rem,calc(100vw-2rem))] lg:-translate-x-1/2">
        {/* PC: the table */}
        <div className="hidden overflow-x-auto lg:block">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr>
                <th className={`${thBase} w-px pr-1 pl-4 text-right`}>#</th>
                <th className={`${thBase} text-left`}>Person</th>
                <th className={th}>Salary</th>
                {all ? (
                  <>
                    <th className={th}>Full</th>
                    <th className={th}>Short</th>
                    <th className={th}>Absent</th>
                    <th className={th}>Days off</th>
                    <th className={th}>Paid leave</th>
                    <th className={th}>OT hours</th>
                    <th className={th}>Earned</th>
                    <th className={th}>OT pay</th>
                    <th className={th}>TA</th>
                    <th className={th}>DA</th>
                    <th className={th}>Expenses</th>
                    <th className={th}>Advances</th>
                    <th className={th}>Carried in</th>
                  </>
                ) : (
                  <>
                    <th className={`${thBase} text-left`}>Days</th>
                    <th className={th}>Earned</th>
                    <th className={th}>Extras</th>
                    <th className={th}>Taken</th>
                  </>
                )}
                <th className={th}>Remaining</th>
                <th className={`${thBase} pr-4 text-left`}>Paid</th>
              </tr>
            </thead>
            <tbody>
              {tab.rows.map((r, i) => {
                const days = daysText(r.counts, leaveOf(r), shiftOf(r));
                return (
                  <tr key={r.userId} className={`border-t border-slate-100 ${open === r.userId ? "bg-(--brand-soft)" : ""}`}>
                    <td className={`${td} w-px pr-1 pl-4 text-slate-500`}>{i + 1}</td>
                    {/* as wide as the name or its tags, whichever is wider; notes under it may wrap */}
                    <td className="w-px px-2 py-0.5 whitespace-nowrap">
                      <button type="button" onClick={() => setOpen(r.userId)} aria-expanded={open === r.userId} className="min-h-11 py-1 text-left font-semibold">
                        {r.name} <span className="text-(--brand)">›</span>
                        <TagsUnder r={r} />
                      </button>
                      <span className="block max-w-48 pb-1 whitespace-normal">
                        <RowNotes r={r} month={tab.month} />
                      </span>
                    </td>
                    <td className={td}>{payText(r)}</td>
                    {all ? (
                      <>
                        <td className={td}>{r.counts.present}</td>
                        <td className={td}>{r.counts.short ? `${r.counts.short} · ${fmtMinutes(r.counts.shortMinutes ?? 0)}` : r.counts.half ? `${r.counts.half} half` : 0}</td>
                        <td className={td}>{r.counts.absent}</td>
                        <td className={td}>{r.counts.off ?? 0}</td>
                        <td className={td}>{r.payBasis === "monthly" ? halvesText(r.result.leaveUsedHalves) : "—"}</td>
                        <td className={td}>{r.getsOvertime ? fmtMinutes(r.result.otMinutes) : "—"}</td>
                        <td className={td}>{rupeesText(r.result.earnedPaise)}</td>
                        <td className={td}>{r.getsOvertime ? rupeesText(r.result.otPayPaise) : "—"}</td>
                        <td className={td}>{r.kmRatePaise || r.result.taPaise ? rupeesText(r.result.taPaise) : "—"}</td>
                        <td className={td}>{r.daDayPaise || r.result.daPaise ? rupeesText(r.result.daPaise) : "—"}</td>
                        <td className={td}>{rupeesText(r.result.expensesPaise)}</td>
                        <td className={td}>{rupeesText(r.result.advancesPaise)}</td>
                        <td className={td}>{rupeesText(r.result.carriedInPaise)}</td>
                      </>
                    ) : (
                      <>
                        <td className="px-2 py-1.5 text-left tabular-nums whitespace-nowrap">
                          <span className="block font-medium">{days.main}</span>
                          <span className="block text-xs text-slate-600">{days.sub}</span>
                        </td>
                        <td className={td}>{rupeesText(r.result.earnedPaise)}</td>
                        <td className={td}>{moneyOrDash(extrasPaise(r.result))}</td>
                        <td className={td}>{moneyOrDash(takenPaise(r.result))}</td>
                      </>
                    )}
                    <td className={`${td} font-bold ${r.result.remainingPaise < 0 ? "text-red-700" : ""}`}>{rupeesText(r.result.remainingPaise)}</td>
                    <td className="px-2 py-1.5 pr-4 whitespace-nowrap">
                      <PaidStatus row={r} month={tab.month} today={tab.today} payable={tab.payable} payableFrom={tab.payableFrom} canPay={canPay} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-slate-200 font-bold">
                <td />
                <td className="px-2 py-3">Total</td>
                {/* monthly salaries only; "—" when everyone is paid per day (₹0 would read as no pay) */}
                <td className={td}>{tab.rows.some((r) => r.payBasis !== "per_day") ? rupeesText(t.salaryPaise) : "—"}</td>
                {all ? (
                  <>
                    <td colSpan={6} />
                    <td className={td}>{rupeesText(t.earnedPaise)}</td>
                    <td className={td}>{rupeesText(t.otPayPaise)}</td>
                    <td className={td}>{rupeesText(t.taPaise)}</td>
                    <td className={td}>{rupeesText(t.daPaise)}</td>
                    <td className={td}>{rupeesText(t.expensesPaise)}</td>
                    <td className={td}>{rupeesText(t.advancesPaise)}</td>
                    <td className={td}>{rupeesText(t.carriedInPaise)}</td>
                  </>
                ) : (
                  <>
                    <td />
                    <td className={td}>{rupeesText(t.earnedPaise)}</td>
                    <td className={td}>{moneyOrDash(extrasPaise(t))}</td>
                    <td className={td}>{moneyOrDash(takenPaise(t))}</td>
                  </>
                )}
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
          {tab.rows.map((r, i) => {
            const days = daysText(r.counts, leaveOf(r), shiftOf(r));
            const extras = extrasPaise(r.result);
            const taken = takenPaise(r.result);
            const money = [`${rupeesText(r.result.earnedPaise)} earned`];
            if (extras) money.push(`+ ${rupeesText(extras)} extras`);
            if (taken) money.push(`− ${rupeesText(taken)} taken`);
            const dayLine = [days.main, days.sub];
            if (r.payBasis === "per_day") dayLine.push(payText(r));
            if (r.getsOvertime && r.result.otMinutes) dayLine.push(`OT ${fmtMinutes(r.result.otMinutes)}`);
            return (
              <li key={r.userId}>
                <button type="button" onClick={() => setOpen(r.userId)} className="flex min-h-14 w-full items-center justify-between gap-3 px-4 py-2.5 text-left">
                  <span className="min-w-0">
                    <span className="block font-semibold">
                      <span className="font-normal text-slate-500">{i + 1}.</span> {r.name}
                      <PerDayTag r={r} />
                      {r.former && <span className="ml-1 text-xs font-normal text-slate-500">(left)</span>}
                    </span>
                    <span className="block text-xs text-slate-600">{money.join(" ")}</span>
                    <span className="block text-xs text-slate-600">{dayLine.join(" · ")}</span>
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
