import { addMonths, fmtMinutes, fmtMonth, istMonth } from "@/lib/days";
import { fmtTime } from "@/lib/punch";
import { can } from "@/server/access";
import type { AtUser } from "@/server/session";
import type { TodayBoard } from "@/server/today";

const nowText = () => new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", weekday: "long", day: "numeric", month: "short" }).format(new Date());

function Group({ title, tone, count, children }: { title: string; tone: "green" | "slate" | "amber"; count: number; children: React.ReactNode }) {
  const box = tone === "amber" ? "border-amber-200 bg-amber-50" : "border-slate-200 bg-white";
  const dot = tone === "green" ? "bg-emerald-600" : tone === "amber" ? "bg-amber-600" : "bg-slate-500";
  return (
    <section className={`rounded-2xl border px-4 py-3 ${box}`}>
      <h2 className={`flex items-center gap-2 text-base font-bold ${tone === "amber" ? "text-amber-900" : ""}`}>
        <span className={`h-2.5 w-2.5 rounded-full ${dot}`} aria-hidden="true" />
        {title} · {count}
      </h2>
      {count === 0 ? <p className="mt-1 text-sm text-slate-500">Nobody</p> : <ul className="mt-1">{children}</ul>}
    </section>
  );
}

const row = "flex min-h-11 items-center justify-between gap-3 border-t border-black/5 first:border-t-0";

/**
 * The Today board (mock-up "Owner · Today"; Supervisor: docs/ATTENDANCE_ROLES_PHASE_PLAN.md mock-up 5). For those who
 * see everyone's days (owner, Office staff, support) every name opens that person's day; a Supervisor's board is
 * read-only: names only, no links, no Fix.
 */
export function TodayView({ user, board }: { user: AtUser; board: TodayBoard }) {
  const months = Array.from({ length: 12 }, (_, i) => addMonths(istMonth(), -i));
  const linked = can(user, "see_everyone");
  const Item = ({ href, className, children }: { href: string; className: string; children: React.ReactNode }) =>
    linked ? (
      <a href={href} className={className}>
        {children}
      </a>
    ) : (
      <div className={className}>{children}</div>
    );
  const dayLink = (userId: string, date: string) => `/staff/${userId}/${date}`;
  return (
    <div className="space-y-3">
      <h1 className="text-xl font-bold">{nowText()}</h1>
      {board.platformDown && (
        <p className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">PlantOps can&apos;t be reached right now, so this list shows only people who marked in the last days.</p>
      )}
      <Group title="Inside now" tone="green" count={board.inside.length}>
        {board.inside.map((p) => (
          <li key={p.userId}>
            <Item href={dayLink(p.userId, board.today)} className={row}>
              <span className="font-semibold">{p.name}</span>
              <span className="text-sm text-slate-600">
                since {fmtTime(p.since)}
                {p.by ? ` · by ${p.by}` : ""}
              </span>
            </Item>
          </li>
        ))}
      </Group>
      <Group title="Came and left" tone="slate" count={board.cameLeft.length}>
        {board.cameLeft.map((p) => (
          <li key={p.userId}>
            <Item href={dayLink(p.userId, board.today)} className={row}>
              <span className="font-semibold">{p.name}</span>
              <span className="text-sm text-slate-600">
                {p.firstIn ? fmtTime(p.firstIn) : "—"} → {p.lastOut ? fmtTime(p.lastOut) : "—"} · {fmtMinutes(p.minutes)}
              </span>
            </Item>
          </li>
        ))}
      </Group>
      <Group title="Not marked today" tone="amber" count={board.notMarked.length}>
        {board.notMarked.map((p) => (
          <li key={p.userId}>
            <Item href={dayLink(p.userId, board.today)} className={`${row} font-semibold text-amber-950`}>
              {p.name}
            </Item>
          </li>
        ))}
      </Group>
      <Group title="No exit yesterday" tone="amber" count={board.noExitYesterday.length}>
        {board.noExitYesterday.map((p) => (
          <li key={p.userId}>
            <Item href={dayLink(p.userId, board.yesterday)} className={`${row} text-amber-950`}>
              <span className="font-semibold">{p.name}</span>
              <span className="text-sm">
                IN {fmtTime(p.inAt)}, no OUT{can(user, "fix") ? " · Fix" : ""}
              </span>
            </Item>
          </li>
        ))}
      </Group>
      {can(user, "export") && (
        <form action="/api/export" method="get" className="flex items-center gap-2 pt-2">
          <label className="sr-only" htmlFor="month">
            Month
          </label>
          <select id="month" name="month" className="min-h-11 flex-1 rounded-xl border border-slate-300 bg-white px-3">
            {months.map((m) => (
              <option key={m} value={m}>
                {fmtMonth(m)}
              </option>
            ))}
          </select>
          <button type="submit" className="min-h-11 rounded-xl border border-slate-300 bg-white px-4 font-semibold">
            Download CSV
          </button>
        </form>
      )}
    </div>
  );
}
