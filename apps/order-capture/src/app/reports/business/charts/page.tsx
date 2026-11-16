import { redirect } from "next/navigation";
import { lastYear as lastYearOf, BY_LABEL, BYS, CHART_PERIOD_LABEL, CHART_PERIODS, EXPENSE_GROUP_LABEL, EXPENSE_GROUPS, NO_BRAND, OTHER_BRANDS, VAN_SALES } from "@/lib/business";
import { can } from "@/server/access";
import { businessCharts, readChartParams } from "@/server/business";
import { kit } from "@/server/kit";
import { requirePageUser } from "@/server/session";
import { Header } from "../../../header";
import { PrintButton } from "../../../ledger-forms";
import { BackLink } from "../../../parts";
import { Chart, ChartCard, fullRupees, GREY, HBars, SLOT, toRupees } from "../charts";

type Search = Promise<Record<string, string | string[] | undefined>>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
const field = "min-h-11 rounded-xl border border-slate-300 bg-white px-3 text-sm";
const monthName = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString("en-IN", { month: "long", year: "numeric", timeZone: "UTC" });
const day = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
const R = (xs: bigint[]) => xs.map(toRupees);
const GROUP_COLOR: Record<(typeof EXPENSE_GROUPS)[number], string> = { purchases: SLOT[0], salary: SLOT[1], van: SLOT[2], other: SLOT[3] };
const groupColor = (name: string) => GROUP_COLOR[EXPENSE_GROUPS.find((g) => EXPENSE_GROUP_LABEL[g] === name) ?? "other"];

/** Reports → Business Overview → Business charts (owner; support reads). docs/REPORTS_PHASE_PLAN.md section 9. */
export default async function BusinessChartsPage({ searchParams }: { searchParams: Search }) {
  const user = await requirePageUser("/reports/business/charts");
  if (!can(user, "reports")) redirect("/");
  const sp = await searchParams;
  const q = Object.fromEntries(Object.entries(sp).map(([k, v]) => [k, one(v)]));
  const p = readChartParams(q);
  const [plant, c] = await Promise.all([kit.branding(user.tenantId), businessCharts(user, p)]);
  const labels = c.buckets.map((b) => b.label);
  const axis = c.buckets.map((b) => b.axis);
  const unit = p.by === "month" ? "month" : p.by === "week" ? "week" : "day";
  // brand colours follow the brand (its place among the period's biggest), never the month
  const brandColor = (name: string, i: number) => (name === OTHER_BRANDS ? GREY : name === NO_BRAND ? SLOT[5] : name === VAN_SALES ? SLOT[6] : SLOT[i]!);
  const left = c.totals.sales - c.totals.expenses;
  const cut = (b: bigint) => fullRupees(toRupees(b));
  const csv = `/api/reports/business?${new URLSearchParams(Object.entries({ period: p.period, from: p.from, to: p.to, by: p.by, brand: p.brand, amount: p.amount }).filter(([, v]) => v)).toString()}`;
  const kpis = [
    { label: "Sales", value: cut(c.totals.sales), note: c.totals.lastYear && c.totals.lastYear > 0n ? `${c.totals.sales >= c.totals.lastYear ? "+" : "−"}${Math.abs(Math.round(((Number(c.totals.sales) - Number(c.totals.lastYear)) / Number(c.totals.lastYear)) * 100))} % on the same days last year` : c.recordsFrom && c.recordsFrom > lastYearOf(p.from) ? `No comparison: records start ${monthName(c.recordsFrom)}` : "No sales on the same days last year" },
    { label: "Expenses", value: cut(c.totals.expenses), note: "Purchases, van and cash expenses (salary comes next)" },
    { label: "Left over (sales − expenses)", value: cut(left), note: "Not a profit: salary, power, rent and most cash costs are not in yet" },
    { label: "Customers owe", value: cut(c.owed[c.owed.length - 1] ?? 0n), note: `On ${day(p.to)}` },
  ];

  return (
    <div className="space-y-4 pb-8">
      <div className="space-y-3 print:hidden">
        <Header user={user} plant={plant} />
        <BackLink href="/reports?section=business">← Reports · Business Overview</BackLink>
        <form method="get" className="flex flex-wrap items-end gap-2 rounded-2xl border border-slate-200 bg-white p-3">
          <label className="text-sm">Period<br />
            <select name="period" defaultValue={p.period} className={field}>{CHART_PERIODS.map((x) => <option key={x} value={x}>{CHART_PERIOD_LABEL[x]}</option>)}</select>
          </label>
          <label className="text-sm">From<br /><input type="date" name="from" defaultValue={p.from} className={field} /></label>
          <label className="text-sm">To<br /><input type="date" name="to" defaultValue={p.to} className={field} /></label>
          <label className="text-sm">Show by<br />
            <select name="by" defaultValue={p.asked} className={field}>{BYS.map((x) => <option key={x} value={x}>{BY_LABEL[x]}</option>)}</select>
          </label>
          <label className="text-sm">Brand<br />
            <select name="brand" defaultValue={p.brand} className={field}>
              <option value="">All brands</option>
              {c.sales.brands.map((b) => <option key={b} value={b}>{b}</option>)}
            </select>
          </label>
          <label className="text-sm">Amounts<br />
            <select name="amount" defaultValue={p.amount} className={field}><option value="before">Before GST</option><option value="with">With GST</option></select>
          </label>
          <button className="min-h-11 rounded-xl bg-(--brand) px-4 text-sm font-semibold text-(--brand-contrast)">Show</button>
          <span className="ml-auto flex gap-2">
            <a href={csv} className="flex min-h-11 items-center rounded-xl border border-slate-300 bg-white px-4 text-sm font-semibold">CSV</a>
            <PrintButton />
          </span>
        </form>
        <p className="text-xs text-slate-500">
          From / To are used with “Custom dates”.{p.by !== p.asked && ` ${BY_LABEL[p.asked]} is too fine for this period: shown by ${unit}.`}
        </p>
      </div>
      <h1 className="text-2xl font-bold">Business charts</h1>
      <p className="max-w-4xl text-sm text-slate-600">
        {plant?.name} · {day(p.from)} – {day(p.to)} · {p.amount === "with" ? "with GST" : "before GST"}{p.brand && ` · brand ${p.brand}`}. Sales = bills (PlantOps and the Zoho history) + van cash sales.
        Expenses = purchase bills + cash-book expenses + staff-cash spending + van diesel, meals and toll. Staff advances are not expenses.
        Tap or hover a bar for its amount; “Table” shows the numbers.
      </p>

      {c.recordsFrom && p.from < c.recordsFrom && (
        <p className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
          Your sales records start in <b>{monthName(c.recordsFrom)}</b> (the Zoho history). Months before that show little or nothing: that is
          missing records, not a fall in sales.
        </p>
      )}
      <div className="grid grid-cols-[repeat(auto-fit,minmax(13rem,1fr))] gap-3">
        {kpis.map((k) => (
          <div key={k.label} className="rounded-2xl border border-slate-200 bg-white p-4">
            <p className="text-sm text-slate-600">{k.label}</p>
            <p className="text-2xl font-bold">{k.value}</p>
            <p className="text-sm text-slate-600">{k.note}</p>
          </div>
        ))}
      </div>

      <h2 className="pt-2 text-lg font-bold">Sales</h2>
      <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,32rem),1fr))] gap-3">
        <ChartCard title={`Sales by ${unit}`} sub={c.sales.lastYear ? "With the same days last year as a dashed line" : undefined}>
          <Chart
            label={`Sales by ${unit}`}
            labels={labels} axis={axis}
            series={[{ name: "Sales", color: SLOT[0], values: R(c.sales.total) }]}
            line={c.sales.lastYear ? { name: "Last year", color: GREY, values: R(c.sales.lastYear), dash: true } : undefined}
          />
        </ChartCard>
        {!p.brand && c.sales.byBrand.length > 0 && (
          <ChartCard title="Sales by brand" sub="Brand from Rates (else guessed from the product name); van cash sales have no brand">
            <Chart label="Sales by brand" labels={labels} axis={axis} series={c.sales.byBrand.map((s, i) => ({ name: s.name, color: brandColor(s.name, i), values: R(s.values) }))} />
          </ChartCard>
        )}
        <ChartCard title="Orders by day of the week" sub="Average orders entered a day (cancelled left out): helps plan vans and staff">
          <Chart label="Orders by day of the week" count labels={c.weekdays.map((w) => w.label)} series={[{ name: "Orders a day", color: SLOT[0], values: c.weekdays.map((w) => w.avg) }]} />
        </ChartCard>
        <ChartCard title="Top 10 customers" sub="Bills in this period; tap a name for their page" foot={`The top 10 = ${c.topCustomers.share} % of sales.`}>
          <HBars label="Top 10 customers" rows={c.topCustomers.rows.map((r) => ({ label: r.label, value: toRupees(r.amount), color: SLOT[0], href: r.href }))} />
        </ChartCard>
      </div>

      <h2 className="pt-2 text-lg font-bold">Expenses</h2>
      <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,32rem),1fr))] gap-3">
        <ChartCard title={`Expenses by ${unit}`} foot="Salary is added in the next release (from Attendance's paid months).">
          <Chart label={`Expenses by ${unit}`} labels={labels} axis={axis} series={c.expenses.groups.map((s) => ({ name: s.name, color: groupColor(s.name), values: R(s.values) }))} />
        </ChartCard>
        <ChartCard id="types" title="Where the money went" sub="Expense types, biggest first">
          <HBars label="Where the money went" rows={c.expenses.types.map((r) => ({ label: r.label, value: toRupees(r.amount), color: r.group ? GROUP_COLOR[r.group] : GREY }))} />
        </ChartCard>
      </div>

      <h2 className="pt-2 text-lg font-bold">Putting them together</h2>
      <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,32rem),1fr))] gap-3">
        <ChartCard id="income" title="Sales and expenses" sub="Side by side; the gap is what is left" foot={`Left over in this period: ${cut(left)}. A rough guide: no rent, power, loans or GST unless entered as expenses.`}>
          <Chart label="Sales and expenses" mode="group" labels={labels} axis={axis} series={[{ name: "Sales", color: SLOT[0], values: R(c.sales.total) }, { name: "Expenses", color: SLOT[1], values: R(c.expenses.total) }]} />
        </ChartCard>
        <ChartCard id="money" title="Money in and money out" sub="When money actually moved: payments received + van cash vs vendors paid + cash expenses" foot={`In ${cut(c.totals.moneyIn)} · out ${cut(c.totals.moneyOut)} · difference ${cut(c.totals.moneyIn - c.totals.moneyOut)}. Not a bank balance.`}>
          <Chart label="Money in and money out" mode="group" labels={labels} axis={axis} series={[{ name: "Money in", color: SLOT[2], values: R(c.money.in) }, { name: "Money out", color: SLOT[1], values: R(c.money.out) }]} />
        </ChartCard>
        <ChartCard title="What customers owe" sub={`Total due at the end of each ${unit} (as Receivables)`}>
          <Chart label="What customers owe" labels={labels} axis={axis} series={[]} line={{ name: "Customers owe", color: SLOT[0], values: R(c.owed) }} />
        </ChartCard>
      </div>
    </div>
  );
}
