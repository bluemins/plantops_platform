// Reports → Business Overview (docs/REPORTS_PHASE_PLAN.md section 9), like Zoho's Home dashboard: what customers owe and
// what the plant owes vendors, cash flow, income and expense, top expenses. Owner (support reads).
import { businessOverview, overviewMonths, readOverviewParams } from "@/server/business";
import { istToday } from "@/server/ledger";
import type { OcUser } from "@/server/session";
import { Chart, ChartCard, fullRupees, HBars, salaryNote, SLOT, SplitBar, toRupees } from "./charts";

const GROUP_COLOR = { purchases: SLOT[0], salary: SLOT[1], van: SLOT[2], other: SLOT[3] } as const;
const R = (xs: bigint[]) => xs.map(toRupees);
const cut = (b: bigint) => fullRupees(toRupees(b));
const longDay = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

export async function BusinessOverviewPanel({ user, q }: { user: OcUser; q: Record<string, string | undefined> }) {
  const p = readOverviewParams(q);
  const o = await businessOverview(user, p);
  const link = (over: Partial<{ period: string; basis: string }>) =>
    `/reports?${new URLSearchParams({ section: "business", period: p.period, ...(p.period === "month" ? { month: p.month } : {}), basis: p.basis, ...over }).toString()}`;
  const months = overviewMonths(istToday(), o.recordsFrom);
  const monthName = (m: string) => new Date(`${m}-01T00:00:00Z`).toLocaleDateString("en-IN", { month: "long", year: "numeric", timeZone: "UTC" });
  const each = p.by === "day" ? "day" : "month";
  const chip = (on: boolean) => `flex min-h-10 items-center rounded-xl border px-3 text-sm ${on ? "border-(--brand) bg-(--brand) font-semibold text-(--brand-contrast)" : "border-slate-300 bg-white"}`;
  const labels = o.buckets.map((b) => b.label);
  const axis = o.buckets.map((b) => b.axis);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm text-slate-600">Period:</span>
        <a href={link({ period: "last_12" })} className={chip(p.period === "last_12")}>Last 12 months</a>
        <a href={link({ period: "this_fy" })} className={chip(p.period === "this_fy")}>This financial year</a>
        <form method="get" action="/reports" className="flex items-center gap-1.5">
          <input type="hidden" name="section" value="business" />
          <input type="hidden" name="period" value="month" />
          <input type="hidden" name="basis" value={p.basis} />
          <label className="sr-only" htmlFor="ov-month">Month</label>
          <select id="ov-month" name="month" defaultValue={p.period === "month" ? p.month : months[0]} className={`${chip(p.period === "month")} pr-2`}>
            {months.map((m) => <option key={m} value={m} className="bg-white text-slate-900">{monthName(m)}</option>)}
          </select>
          <button className="min-h-10 rounded-xl border border-slate-300 bg-white px-3 text-sm font-semibold">Show month</button>
        </form>
      </div>
      {p.period === "month" && <p className="text-sm text-slate-600">{monthName(p.month)}, day by day.</p>}
      {o.recordsFrom && p.from < o.recordsFrom && (
        <p className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
          Your sales records start in <b>{new Date(`${o.recordsFrom}T00:00:00Z`).toLocaleDateString("en-IN", { month: "long", year: "numeric", timeZone: "UTC" })}</b>{" "}
          (the Zoho history): months before that show little or nothing.
        </p>
      )}
      <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,18rem),1fr))] gap-3">
        <ChartCard title="Customers owe you" sub="Unpaid bills today (by due date)" foot={<a href="/reports/receivables/aging" className="font-semibold text-(--brand)">Receivables ›</a>}>
          <p className="text-2xl font-bold">{cut(o.receivables.total)}</p>
          <SplitBar notDue={toRupees(o.receivables.notDue)} overdue={toRupees(o.receivables.overdue)} />
        </ChartCard>
        <ChartCard title="You owe vendors" sub="Unpaid purchase bills today" foot={<a href="/purchases/payables" className="font-semibold text-(--brand)">Payables ›</a>}>
          <p className="text-2xl font-bold">{cut(o.payables.total)}</p>
          <SplitBar notDue={toRupees(o.payables.notDue)} overdue={toRupees(o.payables.overdue)} />
        </ChartCard>
      </div>

      <ChartCard title="Cash flow" sub={`Money in − money out each ${each}, added up from the start of the period (not a bank balance)`}>
        <div className="flex flex-wrap gap-4">
          <div className="min-w-0 flex-[999_1_26rem]">
            <Chart label="Cash flow: running total" labels={labels} axis={axis} series={[]} line={{ name: "Running total", color: SLOT[0], values: R(o.cash.running) }} />
          </div>
          <dl className="flex flex-[1_1_12rem] flex-col gap-3 text-right text-sm text-slate-600">
            <div><dt>On {longDay(p.from)}</dt><dd className="text-lg font-bold text-slate-900">{cut(o.cash.start)}</dd></div>
            <div><dt>Money in</dt><dd className="text-lg font-bold text-slate-900">{cut(o.cash.totalIn)} (+)</dd></div>
            <div><dt>Money out</dt><dd className="text-lg font-bold text-slate-900">{cut(o.cash.totalOut)} (−)</dd></div>
            <div><dt>On {longDay(p.to)}</dt><dd className="text-lg font-bold text-slate-900">{cut(o.cash.end)} (=)</dd></div>
          </dl>
        </div>
      </ChartCard>

      <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,24rem),1fr))] gap-3">
        <ChartCard
          title="Income and expense"
          sub={p.basis === "bill" ? "By bill: sales billed vs purchases billed + expenses (before GST)" : "By payment: money received vs money paid out"}
          foot={`${salaryNote(o.salary)} Not a profit: power, rent and most cash costs are not in yet.`}
        >
          <div className="flex flex-wrap gap-2">
            <a href={link({ basis: "bill" })} className={chip(p.basis === "bill")}>By bill</a>
            <a href={link({ basis: "payment" })} className={chip(p.basis === "payment")}>By payment</a>
          </div>
          <div className="flex gap-6 text-sm">
            <span>Income<br /><b className="text-lg">{cut(o.totals.income)}</b></span>
            <span>Expenses<br /><b className="text-lg">{cut(o.totals.expense)}</b></span>
          </div>
          <Chart label={`Income and expense by ${each}`} mode="group" height={160} labels={labels} axis={axis} series={[{ name: "Income", color: SLOT[2], values: R(o.income) }, { name: "Expenses", color: SLOT[1], values: R(o.expense) }]} />
        </ChartCard>
        <ChartCard title="Top expenses" sub="Before GST, biggest first" foot={<a href="/reports/business/charts#types" className="font-semibold text-(--brand)">All expense types ›</a>}>
          <HBars label="Top expenses" rows={o.types.map((r) => ({ label: r.label, value: toRupees(r.amount), color: r.group ? GROUP_COLOR[r.group] : "#94a3b8" }))} />
        </ChartCard>
      </div>
    </div>
  );
}
