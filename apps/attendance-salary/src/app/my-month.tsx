import { orNotFound } from "@/server/pages";
import { monthFor } from "@/server/calendar";
import { kit } from "@/server/kit";
import { myState } from "@/server/marks";
import { hoursText } from "@/lib/salary";
import { monthStatuses, type MonthStatuses } from "@/server/salary";
import type { AtUser } from "@/server/session";
import { CalendarKey, MonthCalendar } from "./calendar";

/** The worker's own month (mock-up "Worker · My attendance"): today's state, the calendar, the key, phone alerts. */
export async function MyMonth({ user, month, base }: { user: AtUser; month: string | null; base: string }) {
  const [view, me] = await Promise.all([orNotFound(monthFor(user, user.userId, month)), myState(user)]);
  const statuses = await monthStatuses(user, user.userId, view.month, new Map(view.days.map((d) => [d.date, d])));
  return (
    <div className="space-y-4">
      <section className="flex items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-3">
        <div>
          <p className="text-sm text-slate-500">Today</p>
          <p className="text-lg font-bold">{me.state}</p>
        </div>
        <p className="max-w-40 text-right text-sm text-slate-500">Scan the QR at the plant to mark {me.next.toUpperCase()}</p>
      </section>
      {statuses && <MonthTiles statuses={statuses} />}
      <MonthCalendar view={view} dayHref={(d) => `/day/${d}`} monthHref={(m) => `${base}?m=${m}`} statuses={statuses} />
      <CalendarKey statuses={statuses} />
      <a href={kit.notificationsUrl()} className="flex min-h-11 items-center justify-center gap-2 font-semibold text-(--brand)">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <rect x="7" y="2" width="10" height="20" rx="2" />
          <path d="M11 18h2" />
        </svg>
        Get alerts on this phone
      </a>
    </div>
  );
}

/** Present / half days / absent (and overtime, only with Gets overtime) for the month: days only, never money. */
export function MonthTiles({ statuses }: { statuses: MonthStatuses }) {
  const tiles: [string, string][] = [
    ["Present", String(statuses.counts.present)],
    ["Half days", String(statuses.counts.half)],
    ["Absent", String(statuses.counts.absent)],
  ];
  if (statuses.getsOvertime) tiles.push(["Overtime", `${hoursText(statuses.counts.otMinutes)} h`]);
  return (
    <section aria-label="This month" className="space-y-1">
      <div className={`grid gap-2 ${tiles.length === 4 ? "grid-cols-4" : "grid-cols-3"}`}>
        {tiles.map(([label, value]) => (
          <div key={label} className={`rounded-xl border p-2 text-center ${label === "Overtime" ? "border-(--brand) bg-(--brand-soft)" : "border-slate-200 bg-white"}`}>
            <div className="text-xl font-bold tabular-nums">{value}</div>
            <div className="text-xs text-slate-600">{label}</div>
          </div>
        ))}
      </div>
      {!statuses.complete && <p className="text-xs text-slate-600">So far: {statuses.countedDays} days counted (today is counted tomorrow)</p>}
    </section>
  );
}
