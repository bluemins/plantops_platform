"use client";

import { useState, type ReactNode } from "react";
import { fmtMonth } from "@/lib/days";
import { DAYS_FOR_PAY, halvesText, hoursText, monthPay, paiseText, panelInput, rupeesText, type PanelField } from "@/lib/salary";
import type { TabRow } from "@/server/salary-tab";

const box = "min-h-10 w-full min-w-0 rounded-lg border border-slate-300 px-2 text-right text-base tabular-nums focus:border-(--brand) focus:outline-none focus:ring-2 focus:ring-(--brand-ring)";
const num = (n: number) => String(Math.round(n * 100) / 100);

/**
 * The owner's checking panel (mock-ups 1 and 4): the automatic figures next to boxes the owner can change, worked out
 * again at every keystroke with the SAME src/lib/salary.ts functions the server uses. A calculator only: nothing is
 * sent or saved. Reset (or closing it) puts the automatic figures back.
 */
export function CheckPanel({ row, month, monthLength, complete, onClose, children }: { row: TabRow; month: string; monthLength: number; complete: boolean; onClose: () => void; children?: ReactNode }) {
  const [typed, setTyped] = useState<Partial<Record<PanelField, string>>>({});
  const auto = monthPay(row.input);
  const yours = monthPay(panelInput(row.input, typed));
  const yin = panelInput(row.input, typed);

  const perDay = row.input.payBasis === "per_day";
  // per-day people (rule 15): a day rate instead of the salary, and no paid leave
  const fields: [PanelField, string, number][] = [
    perDay ? ["dayRate", "Day rate (₹)", (row.input.dayRatePaise ?? 0) / 100] : ["monthly", "Monthly salary (₹)", row.input.monthlyPaise / 100],
    ["present", "Present days", row.input.present],
    ["half", "Half days", row.input.half],
    ["absent", "Absent days", row.input.absent],
  ];
  if (!perDay) fields.push(["leave", "Paid leave allowed (days)", row.input.paidLeaveHalfdays / 2]);
  if (row.getsOvertime) {
    fields.push(["otHours", "Overtime hours", Math.round((row.input.otMinutes / 60) * 100) / 100]);
    fields.push(["otRate", "Overtime ₹ / hour", (row.input.otRatePaise ?? 0) / 100]);
  }
  fields.push(["advances", "Advances (₹)", row.input.advancesPaise / 100]);
  fields.push(["carried", "Carried in (₹)", row.input.carriedInPaise / 100]);

  const total = yin.present + yin.half + yin.absent;
  const daysOk = total === row.countedDays;
  const target = complete && row.fullMonth ? `${fmtMonth(month).split(" ")[0]} has ${monthLength}` : complete ? `${row.countedDays} days worked here` : `${row.countedDays} days so far`;
  const daysText = `${num(yin.present)} present + ${num(yin.half)} half + ${num(yin.absent)} absent = ${num(total)} days`;
  const diff = yours.remainingPaise - auto.remainingPaise;

  const line = (label: string, value: string, strong = false) => (
    <div className={`flex justify-between gap-3 ${strong ? "font-semibold" : ""}`}>
      <span className={strong ? "" : "text-slate-600"}>{label}</span>
      <span className="tabular-nums">{value}</span>
    </div>
  );

  return (
    <div className="space-y-3">
      <div className="flex items-start justify-between gap-2">
        <button type="button" onClick={onClose} aria-label="Close" className="grid h-11 w-11 shrink-0 place-items-center rounded-xl border border-slate-200 text-xl">
          ×
        </button>
        <div className="min-w-0 flex-1 text-center lg:text-left">
          <h2 className="truncate text-lg font-bold">{row.name}</h2>
          <p className="text-sm text-slate-600">{fmtMonth(month)} · check my working</p>
        </div>
        <button type="button" onClick={() => setTyped({})} className="min-h-11 rounded-xl border border-slate-300 px-3 text-sm font-semibold">
          Reset
        </button>
      </div>

      <div className="grid grid-cols-[minmax(0,1.5fr)_minmax(0,0.8fr)_minmax(0,1fr)] items-center gap-x-2.5 gap-y-1.5 text-sm">
        <span />
        <span className="text-right text-xs font-semibold text-slate-600">AUTO</span>
        <span className="text-right text-xs font-semibold text-(--brand)">YOURS</span>
        {fields.map(([k, label, a]) => {
          const changed = typed[k] !== undefined && typed[k]!.trim() !== "" && Number(typed[k]) !== a;
          return (
            <div key={k} className="contents">
              <label htmlFor={`chk-${k}`}>{label}</label>
              <span className="text-right text-slate-600 tabular-nums">{num(a)}</span>
              <input
                id={`chk-${k}`}
                className={`${box} ${changed ? "border-(--brand) bg-(--brand-soft)" : "bg-white"}`}
                type="number"
                inputMode="decimal"
                min={0}
                step={k === "present" || k === "half" || k === "absent" || k === "leave" ? 0.5 : "any"}
                value={typed[k] ?? String(a)}
                onChange={(e) => setTyped((t) => ({ ...t, [k]: e.target.value }))}
              />
            </div>
          );
        })}
      </div>

      <p className={`rounded-lg px-3 py-2 text-sm ${daysOk ? "bg-slate-100 text-slate-700" : "bg-amber-100 text-amber-950"}`}>{daysOk ? `${daysText} ✓` : `${daysText}, but ${target}`}</p>

      <div className="space-y-1.5 border-t border-slate-100 pt-3 text-sm">
        {perDay
          ? line("Day rate", paiseText(yours.dayPayPaise))
          : line(`Day's pay (${rupeesText(yin.monthlyPaise)} ÷ ${DAYS_FOR_PAY})`, paiseText(yours.dayPayPaise))}
        {perDay
          ? line(`Paid days ${halvesText(yours.paidHalves)} × ${paiseText(yours.dayPayPaise)}`, paiseText(yours.earnedPaise))
          : yin.fullMonth
          ? line(`Unpaid days ${halvesText(yours.unpaidHalves)} × day's pay`, yours.deductionPaise ? `−${paiseText(yours.deductionPaise)}` : "₹0")
          : line(`Paid days ${halvesText(yours.paidHalves)} × day's pay`, paiseText(yours.earnedPaise))}
        {line("Salary earned", paiseText(yours.earnedPaise), true)}
        {row.getsOvertime && line(`Overtime ${hoursText(yours.otMinutes)} h × ${paiseText(yin.otRatePaise ?? 0)}`, `+${paiseText(yours.otPayPaise)}`)}
        {line("Advances", `−${paiseText(yours.advancesPaise)}`)}
        {line(`Carried in from ${fmtMonth(row.prevMonth)}`, yours.carriedInPaise ? `−${paiseText(yours.carriedInPaise)}` : "₹0")}
        {yours.adjustmentPaise !== 0 && line(`Adjustment from ${fmtMonth(row.adjustmentFrom ?? row.prevMonth)}`, `${yours.adjustmentPaise > 0 ? "+" : ""}${paiseText(yours.adjustmentPaise)}`)}
        <div className="flex justify-between gap-3 border-t border-slate-100 pt-2 text-lg font-extrabold">
          <span>Remaining (yours)</span>
          <span className={`tabular-nums ${yours.remainingPaise < 0 ? "text-red-700" : ""}`}>{rupeesText(yours.remainingPaise)}</span>
        </div>
        {line("Remaining (auto)", rupeesText(auto.remainingPaise))}
      </div>

      <p role="status" className={`rounded-xl px-3 py-2.5 font-bold ${diff === 0 ? "bg-emerald-50 text-emerald-800" : "bg-amber-100 text-amber-950"}`}>
        {diff === 0 ? "Matches the automatic figure" : `Yours is ${paiseText(Math.abs(diff))} ${diff > 0 ? "more" : "less"} than auto`}
      </p>
      <p className="text-xs text-slate-600">Only for checking: nothing here is saved. If your figure is right, fix the attendance time, salary or advance it came from.</p>
      {children}
    </div>
  );
}
