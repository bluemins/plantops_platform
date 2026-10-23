import { dayStart, fmtDayLong, fmtMinutes, fmtSpan } from "@/lib/days";
import { shortDaysText } from "@/lib/salary";
import { fmtTime } from "@/lib/punch";
import type { Block, Mark, WorkDay } from "@/lib/sessions";

const DAY_MS = 24 * 3600_000;
const pct = (n: number) => `${Math.max(0, Math.min(100, n * 100)).toFixed(2)}%`;

/** "IN scan (30 m)", "IN by Ramesh" (Mark for someone) or "OUT added by Sujata: forgot to scan" */
function how(m: Mark) {
  const kind = m.kind.toUpperCase();
  if (m.source === "desk") return <span>{kind} by {m.byName}</span>;
  return m.source === "owner" ? (
    <span className="rounded-md bg-violet-50 px-2 py-0.5 text-violet-800">
      {kind} added by {m.byName}: {m.reason}
    </span>
  ) : (
    <span>
      {kind} scan{m.distanceM != null ? ` (${m.distanceM} m)` : ""}
    </span>
  );
}

/** One block on the 24-hour bar: worked (brand colour), no exit (amber stripes, to the day's end), inside now. */
function BarPart({ block, start, now }: { block: Block; start: number; now: number }) {
  const from = (block.start.at.getTime() - start) / DAY_MS;
  const until = block.status === "done" ? (block.end!.at.getTime() - start) / DAY_MS : block.status === "open" ? (now - start) / DAY_MS : 1;
  const style = { left: pct(from), width: pct(Math.min(1, until) - from) };
  const look =
    block.status === "done" ? "bg-(--brand)" : block.status === "open" ? "bg-(--brand) opacity-60" : "bg-[repeating-linear-gradient(45deg,#fcd34d_0_6px,#fef3c7_6px_12px)]";
  return <div className={`absolute inset-y-0 ${look}`} style={style} />;
}

/** One person's day (mock-up "Worker · One day"): total, the 24-hour bar, and every mark in time order. */
export function DayView({ day }: { day: WorkDay }) {
  const start = dayStart(day.date).getTime();
  const now = Date.now();
  const flag = day.noExit ? "no exit" : day.open ? "in now" : null;
  const barLabel = day.blocks.map((b) => (b.status === "done" ? `${fmtTime(b.start.at)} to ${fmtTime(b.end!.at)}` : `${fmtTime(b.start.at)}, ${b.status === "open" ? "inside now" : "no OUT"}`)).join("; ");
  return (
    <div className="space-y-4">
      <section className="space-y-3 rounded-2xl border border-slate-200 bg-white p-4">
        <div className="flex items-baseline justify-between gap-3">
          <h1 className="text-xl font-bold">{fmtDayLong(day.date)}</h1>
          <div className="flex items-center gap-2">
            {flag && <span className={`rounded-md px-2 py-0.5 text-sm font-bold ${day.noExit ? "bg-amber-100 text-amber-900" : "bg-(--brand-soft) text-(--brand)"}`}>{flag}</span>}
            <span className="text-xl font-bold">{fmtMinutes(day.minutes)}</span>
          </div>
        </div>
        <div className="relative h-9 overflow-hidden rounded-lg bg-slate-100" role="img" aria-label={barLabel ? `Worked: ${barLabel}` : "Nothing marked"}>
          {day.blocks.map((b, i) => (
            <BarPart key={i} block={b} start={start} now={now} />
          ))}
          {[25, 50, 75].map((x) => (
            <div key={x} className="absolute inset-y-0 w-px bg-slate-300" style={{ left: `${x}%` }} />
          ))}
        </div>
        <div className="-mt-1 flex justify-between text-xs text-slate-500">
          <span>0:00</span>
          <span>6:00</span>
          <span>12:00</span>
          <span>18:00</span>
          <span>24:00</span>
        </div>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white px-4 py-1">
        {day.entries.length === 0 ? (
          <p className="py-4 text-slate-500">Nothing marked this day.</p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {day.entries.map((e, i) => {
              if (e.type === "cancelled") {
                return (
                  <li key={i} className="space-y-1 py-3">
                    <div className="flex justify-between gap-2 text-slate-400">
                      <span className="line-through">
                        {e.mark.kind.toUpperCase()} {fmtTime(e.mark.at)} {e.mark.source === "owner" ? `added by ${e.mark.byName}` : e.mark.source === "desk" ? `by ${e.mark.byName}` : "scan"}
                      </span>
                      <span className="text-sm">cancelled</span>
                    </div>
                    <p className="text-sm text-slate-500">Cancelled by {e.cancel.byName}: {e.cancel.reason}</p>
                  </li>
                );
              }
              if (e.type === "no_entry") {
                return (
                  <li key={i} className="space-y-1 py-3">
                    <div className="flex justify-between gap-2">
                      <span className="text-base font-bold">OUT {fmtTime(e.mark.at)}</span>
                      <span className="text-sm font-semibold text-amber-800">no IN before it</span>
                    </div>
                    <p className="text-sm text-slate-500">{how(e.mark)} · not counted</p>
                  </li>
                );
              }
              const b = e.block;
              return (
                <li key={i} className="space-y-1 py-3">
                  <div className="flex justify-between gap-2">
                    <span className="text-base font-bold">
                      {b.status === "done" ? `${fmtTime(b.start.at)} → ${fmtTime(b.end!.at)}${b.nextDay ? " next day" : ""}` : `IN ${fmtTime(b.start.at)}`}
                    </span>
                    <span className={`text-sm font-semibold ${b.status === "no_exit" ? "text-amber-800" : ""}`}>
                      {b.status === "done" ? fmtMinutes(b.minutes) : b.status === "open" ? "inside now" : "no OUT · 0h"}
                    </span>
                  </div>
                  <div className="flex flex-wrap gap-x-2 gap-y-1 text-sm text-slate-500">
                    {how(b.start)}
                    {b.end && <>· {how(b.end)}</>}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}

/**
 * "Work for salary" under a counted day (rule 21): time at the plant − lunch = work, and what the day counts as. Hours
 * only, never money. Nothing for today (counted tomorrow) or without a salary setting.
 */
export function WorkBox({ atPlant, day, shiftMinutes, lunchMinutes, getsOvertime }: { atPlant: number; day: { status: string; workMinutes: number; otMinutes: number; mark?: string }; shiftMinutes: number; lunchMinutes: number; getsOvertime: boolean }) {
  const lunch = atPlant - day.workMinutes;
  const row = (label: string, value: string, strong = false) => (
    <div className={`flex justify-between gap-3 ${strong ? "font-bold" : ""}`}>
      <span className={strong ? "" : "text-slate-600"}>{label}</span>
      <span className="tabular-nums">{value}</span>
    </div>
  );
  const verdict = day.mark
    ? day.mark === "off"
      ? "OFF (owner): a paid day off"
      : "ON (owner): counted as a full day"
    : day.status === "present"
      ? `Full day (${fmtHours(shiftMinutes)} work)`
      : day.status === "short"
        ? `Short day: ${fmtMinutes(day.workMinutes)} ÷ ${fmtHours(shiftMinutes)} = ${shortDaysText(day.workMinutes, shiftMinutes)} of a day`
        : "Absent: no work counted";
  return (
    <section aria-label="Work for salary" className="space-y-1.5 rounded-2xl border border-slate-200 bg-white p-4 text-sm">
      <h2 className="text-base font-bold">Work for salary</h2>
      {row("At plant", fmtMinutes(atPlant))}
      {lunchMinutes > 0 && row(`Lunch break (${fmtHours(lunchMinutes)})`, lunch > 0 ? `− ${fmtMinutes(lunch)}` : "not taken off")}
      {row("Work", fmtMinutes(day.workMinutes), true)}
      <p className={`rounded-lg px-3 py-2 font-semibold ${day.status === "short" && !day.mark ? "bg-amber-50 text-amber-900" : "bg-slate-100 text-slate-800"}`}>
        {verdict}
        {getsOvertime && day.otMinutes > 0 ? ` · overtime ${fmtSpan(day.otMinutes)}` : ""}
      </p>
    </section>
  );
}

/** 480 -> "8 h", 90 -> "1.5 h" */
const fmtHours = (minutes: number) => `${Math.round((minutes / 60) * 100) / 100} h`;
