import { orNotFound } from "@/server/pages";
import { monthFor } from "@/server/calendar";
import { kit } from "@/server/kit";
import { myState } from "@/server/marks";
import type { AtUser } from "@/server/session";
import { CalendarKey, MonthCalendar } from "./calendar";

/** The worker's own month (mock-up "Worker · My attendance"): today's state, the calendar, the key, phone alerts. */
export async function MyMonth({ user, month, base }: { user: AtUser; month: string | null; base: string }) {
  const [view, me] = await Promise.all([orNotFound(monthFor(user, user.userId, month)), myState(user)]);
  return (
    <div className="space-y-4">
      <section className="flex items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-3">
        <div>
          <p className="text-sm text-slate-500">Today</p>
          <p className="text-lg font-bold">{me.state}</p>
        </div>
        <p className="max-w-40 text-right text-sm text-slate-500">Scan the QR at the plant to mark {me.next.toUpperCase()}</p>
      </section>
      <MonthCalendar view={view} dayHref={(d) => `/day/${d}`} monthHref={(m) => `${base}?m=${m}`} />
      <CalendarKey />
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
