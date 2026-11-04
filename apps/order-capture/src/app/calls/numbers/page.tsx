import { Card } from "@plantops/ui";
import { fmtDate } from "@plantops/module-kit/format";
import { can } from "@/server/access";
import { callsNumbers, periodFor, type PeriodKey } from "@/server/calls-numbers";
import { kit } from "@/server/kit";
import { requirePageUser } from "@/server/session";
import { Header } from "../../header";
import { BackLink } from "../../parts";

type Search = Promise<Record<string, string | string[] | undefined>>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";
const field = "min-h-12 w-full min-w-0 rounded-xl border border-slate-300 bg-white px-3 text-base focus:border-(--brand) focus:outline-none focus:ring-2 focus:ring-(--brand-ring)";
const dayName = (ymd: string) => new Intl.DateTimeFormat("en-IN", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(`${ymd}T00:00:00Z`));

/** The owner's calls numbers (mock-up screen 5): how many called, missed, were attended or are waiting. Owner + support. */
export default async function CallsNumbersPage({ searchParams }: { searchParams: Search }) {
  const user = await requirePageUser("/calls/numbers");
  const plant = await kit.branding(user.tenantId);
  if (!can(user, "calls_numbers")) {
    return (
      <div className="space-y-5">
        <Header user={user} plant={plant} />
        <Card>Only the plant owner sees this page.</Card>
      </div>
    );
  }
  const sp = await searchParams;
  const period = periodFor({ p: one(sp.p), from: one(sp.from), to: one(sp.to) });
  const n = await callsNumbers(user, period);
  const month = new Intl.DateTimeFormat("en-IN", { month: "long", timeZone: "Asia/Kolkata" }).format(new Date());
  const chips: [PeriodKey, string, string][] = [
    ["today", "Today", "/calls/numbers"],
    ["week", "This week", "/calls/numbers?p=week"],
    ["month", month, "/calls/numbers?p=month"],
  ];
  const t = n.totals;
  const stat = (value: number, label: string) => (
    <div className="rounded-xl border border-slate-200 bg-white px-1 py-3 text-center">
      <b className="block text-2xl tabular-nums">{value}</b>
      <small className="text-xs text-slate-500">{label}</small>
    </div>
  );
  const th = "border-b border-slate-200 px-2 py-2 text-xs font-bold uppercase tracking-wide text-slate-500";
  const td = "border-b border-slate-100 px-2 py-2 tabular-nums";

  return (
    <div className="space-y-4">
      <Header user={user} plant={plant} />
      <BackLink href="/calls">← Calls</BackLink>
      <h1 className="text-xl font-bold">Calls numbers</h1>

      <nav aria-label="Period" className="flex flex-wrap gap-2">
        {chips.map(([key, label, href]) => (
          <a
            key={key}
            href={href}
            aria-current={period.key === key ? "page" : undefined}
            className={`inline-flex min-h-10 items-center rounded-full border px-4 text-sm font-semibold ${period.key === key ? "border-(--brand) bg-(--brand) text-(--brand-contrast)" : "border-slate-300 bg-white text-slate-700"}`}
          >
            {label}
          </a>
        ))}
      </nav>
      <form method="get" className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] items-end gap-2">
        <label className="block text-xs text-slate-500">
          From
          <input type="date" name="from" defaultValue={period.key === "dates" ? period.from : ""} className={field} />
        </label>
        <label className="block text-xs text-slate-500">
          To
          <input type="date" name="to" defaultValue={period.key === "dates" ? period.to : ""} className={field} />
        </label>
        <button type="submit" className={`min-h-12 rounded-xl border px-4 font-semibold ${period.key === "dates" ? "border-(--brand) text-(--brand)" : "border-slate-300 bg-white"}`}>
          Show
        </button>
      </form>
      <p className="text-sm text-slate-500">{period.from === period.to ? fmtDate(period.from) : `${fmtDate(period.from)} to ${fmtDate(period.to)}`}</p>

      <div className="grid grid-cols-4 gap-2">
        {stat(t.calls, "calls")}
        {stat(t.numbers, "numbers")}
        {stat(t.attended, "attended")}
        {stat(t.waiting, "waiting")}
      </div>
      <p className="text-sm text-slate-600">
        {t.missed} of the {t.calls} call{t.calls === 1 ? "" : "s"} {t.missed === 1 ? "was" : "were"} missed · {t.new} new customer{t.new === 1 ? "" : "s"} from calls
      </p>

      <h2 className="text-xs font-bold uppercase tracking-wide text-slate-500">By day</h2>
      {n.days.length === 0 ? (
        <Card>
          <p className="text-slate-500">No calls in this period.</p>
        </Card>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white">
          <table className="w-full min-w-[30rem] text-sm">
            <thead>
              <tr>
                <th className={`${th} text-left`}>Day</th>
                {["Calls", "Missed", "Numbers", "Attended", "New"].map((h) => (
                  <th key={h} className={`${th} text-right`}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {n.days.map((d) => (
                <tr key={d.day}>
                  <td className={td}>{dayName(d.day)}</td>
                  {[d.calls, d.missed, d.numbers, d.attended, d.new].map((v, i) => (
                    <td key={i} className={`${td} text-right`}>
                      {v}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {n.rang_most.length > 0 && (
        <>
          <h2 className="text-xs font-bold uppercase tracking-wide text-slate-500">Rang most</h2>
          <ul className="divide-y divide-slate-100 rounded-2xl border border-slate-200 bg-white">
            {n.rang_most.map((m, i) => (
              <li key={i} className="flex justify-between gap-3 px-4 py-2 text-sm">
                <span className="min-w-0 truncate">{m.name}</span>
                <span className="shrink-0 tabular-nums">
                  {m.calls} call{m.calls === 1 ? "" : "s"}
                </span>
              </li>
            ))}
          </ul>
        </>
      )}

      {n.attended_by.length > 0 && (
        <>
          <h2 className="text-xs font-bold uppercase tracking-wide text-slate-500">Attended by</h2>
          <ul className="divide-y divide-slate-100 rounded-2xl border border-slate-200 bg-white">
            {n.attended_by.map((a) => (
              <li key={a.name} className="flex justify-between gap-3 px-4 py-2 text-sm">
                <span className="min-w-0 truncate">{a.name}</span>
                <span className="shrink-0 tabular-nums">
                  {a.numbers} number{a.numbers === 1 ? "" : "s"}
                </span>
              </li>
            ))}
          </ul>
        </>
      )}

      <section aria-label="What the numbers mean" className="space-y-1 rounded-2xl border border-dashed border-slate-300 p-4 text-sm text-slate-600">
        <p>
          <b>Calls</b> count every ring (a missed call is one ring). <b>Missed</b> are rings nobody answered.
        </p>
        <p>
          <b>Numbers</b> are the different people who rang. <b>Attended</b> and <b>waiting</b> count numbers, so attended + waiting = numbers.
        </p>
        <p>
          <b>New</b> are callers saved to the customer list from Calls. Numbers on Not an order number are left out.
        </p>
      </section>
    </div>
  );
}
