import { fmtMinutes, fmtMonth, weekdayMon0 } from "@/lib/days";
import { hoursText } from "@/lib/salary";
import type { MonthView } from "@/server/calendar";
import type { MonthStatuses } from "@/server/salary";

const WEEK = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/**
 * One person's month (mock-up "Worker · My attendance"): time worked per day, amber "no exit", purple "changed",
 * today outlined, future days greyed. `dayHref` / `monthHref` say where taps go (own pages, or the owner's person
 * pages in Phase 5).
 */
export function MonthCalendar({ view, dayHref, monthHref, statuses }: { view: MonthView; dayHref: (date: string) => string; monthHref: (month: string) => string; statuses?: MonthStatuses | null }) {
  const lead = weekdayMon0(view.days[0]!.date);
  return (
    <section className="space-y-2 rounded-2xl border border-slate-200 bg-white p-3">
      <div className="flex items-center justify-between">
        <a href={monthHref(view.prev)} aria-label="Previous month" className="grid h-11 w-11 place-items-center text-slate-700">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="m15 18-6-6 6-6" />
          </svg>
        </a>
        <h2 className="text-lg font-bold">{fmtMonth(view.month)}</h2>
        {view.next ? (
          <a href={monthHref(view.next)} aria-label="Next month" className="grid h-11 w-11 place-items-center text-slate-700">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="m9 18 6-6-6-6" />
            </svg>
          </a>
        ) : (
          <span className="h-11 w-11" aria-hidden="true" />
        )}
      </div>
      <div className="grid grid-cols-7 gap-1 text-center text-xs font-semibold text-slate-500">
        {WEEK.map((w) => (
          <div key={w}>{w}</div>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-1">
        {Array.from({ length: lead }, (_, i) => (
          <div key={`lead${i}`} aria-hidden="true" />
        ))}
        {view.days.map((d) => {
          const n = Number(d.date.slice(8));
          const future = d.date > view.today;
          const worked = d.minutes > 0 || d.blocks.length > 0 || d.entries.length > 0;
          // with a salary setting (docs/SALARY_PHASE_PLAN.md mock-up 5): half days and absent days get their own colour
          const st = statuses?.days[d.date];
          const tone = future
            ? "text-slate-300"
            : d.noExit
              ? "border border-amber-500 bg-amber-100 text-amber-950"
              : st?.status === "half"
                ? "border border-yellow-300 bg-yellow-50 text-slate-900"
                : st?.status === "absent"
                  ? "border border-red-200 bg-red-50 text-red-900"
                  : worked
                    ? "bg-(--brand-soft) text-slate-900"
                    : "bg-slate-50 text-slate-400";
          const today = d.date === view.today ? "ring-2 ring-(--brand)" : "";
          const body = (
            <>
              <span className="text-sm font-bold">{n}</span>
              <span className="text-[11px] leading-tight">
                {d.open ? "in now" : d.minutes > 0 ? `${fmtMinutes(d.minutes)}${st?.status === "half" ? " ½" : ""}` : d.noExit ? "0h" : st?.status === "absent" ? "absent" : ""}
              </span>
              {st && st.otMinutes > 0 && !d.noExit && <span className="text-[10px] font-bold text-(--brand)">+{hoursText(st.otMinutes)} h</span>}
              {d.noExit ? <span className="text-[10px] font-bold text-amber-800">no exit</span> : d.changed ? <span className="text-[10px] font-bold text-violet-700">changed</span> : null}
            </>
          );
          const cls = `flex min-h-16 flex-col items-center justify-center gap-0.5 rounded-lg px-0.5 py-1 ${tone} ${today}`;
          return future ? (
            <div key={d.date} className={cls}>
              {body}
            </div>
          ) : (
            <a key={d.date} href={dayHref(d.date)} className={cls}>
              {body}
            </a>
          );
        })}
      </div>
    </section>
  );
}

/** The colour key under the calendar. */
export function CalendarKey({ statuses }: { statuses?: MonthStatuses | null } = {}) {
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-2 px-1 text-sm text-slate-600">
      <span className="flex items-center gap-1.5">
        <span className="h-3 w-3 rounded bg-(--brand-soft)" />
        Worked
      </span>
      <span className="flex items-center gap-1.5">
        <span className="h-3 w-3 rounded border border-amber-500 bg-amber-100" />
        No exit (0 h until the owner fixes it)
      </span>
      {statuses && (
        <>
          <span className="flex items-center gap-1.5">
            <span className="h-3 w-3 rounded border border-yellow-300 bg-yellow-50" />
            Half day
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-3 w-3 rounded border border-red-200 bg-red-50" />
            Absent
          </span>
          {statuses.getsOvertime && (
            <span className="flex items-center gap-1.5">
              <span className="text-xs font-bold text-(--brand)">+2 h</span>
              overtime
            </span>
          )}
        </>
      )}
      <span className="flex items-center gap-1.5">
        <span className="text-xs font-bold text-violet-700">changed</span>
        Owner added or cancelled a time
      </span>
    </div>
  );
}
