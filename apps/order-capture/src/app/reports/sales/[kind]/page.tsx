import { notFound, redirect } from "next/navigation";
import { rupees } from "@/lib/ledger";
import { money } from "@/lib/money";
import { GROUP_LABEL, GROUPS, PERIOD_LABEL, PERIODS, qtyText, type Cell, type ReportKind } from "@/lib/report";
import { can } from "@/server/access";
import { kit } from "@/server/kit";
import { readParams, salesReport } from "@/server/reports";
import { requirePageUser } from "@/server/session";
import { Header } from "../../../header";
import { PrintButton } from "../../../ledger-forms";
import { BackLink } from "../../../parts";

type Props = { params: Promise<{ kind: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> };
const field = "min-h-10 rounded-lg border border-slate-300 bg-white px-2 text-sm";
const label = "flex flex-col gap-1 text-xs text-slate-600";
const day = (d: string) => d.split("-").reverse().join("-");
const TITLE: Record<ReportKind, string> = { item: "Sales by Item", customer: "Sales by Customer" };
const m = (p: bigint) => money(rupees(p));

/** Sales by Item / Sales by Customer with the filters (mock-ups 3–5). Owner (support reads). */
export default async function SalesReportPage({ params, searchParams }: Props) {
  const { kind: k } = await params;
  if (k !== "item" && k !== "customer") notFound();
  const kind = k as ReportKind;
  const user = await requirePageUser(`/reports/sales/${kind}`);
  if (!can(user, "reports")) redirect("/");
  const sp = Object.fromEntries(Object.entries(await searchParams).map(([a, b]) => [a, Array.isArray(b) ? b[0] : b]));
  const p = readParams(sp);
  const [plant, r] = await Promise.all([kit.branding(user.tenantId), salesReport(user, kind, p)]);
  const query = new URLSearchParams(Object.entries(p).filter(([, v]) => v !== "") as [string, string][]).toString();
  const broken = r.buckets.length > 1 || p.breakdown !== "none";
  const groups = GROUPS.filter((g) => !(kind === "customer" && g === "customer"));
  const amountWord = p.amount === "with" ? "with GST" : "before GST";

  // the number cells of one line, the same for rows, group lines and the total
  const cells = (c: Cell) =>
    kind === "item"
      ? broken
        ? [...c.amounts.map(m), qtyText(c.qty), m(c.amount)]
        : [qtyText(c.qty), m(c.amount)]
      : broken
        ? [String(c.bills), ...c.amounts.map(m), m(c.amount)]
        : [String(c.bills), m(c.before), m(c.with_gst)];
  const heads =
    kind === "item"
      ? broken
        ? [...r.buckets.map((b) => b.label), "Quantity", "Total"]
        : ["Quantity", "Amount"]
      : broken
        ? ["Bills", ...r.buckets.map((b) => b.label), "Total"]
        : ["Bills", "Sales", "Sales with GST"];
  const firstCols = kind === "item" ? ["Item", "SKU"] : ["Customer"];
  const gridCols = `minmax(180px, 2.4fr) ${kind === "item" ? "minmax(90px, 1.2fr) " : ""}repeat(${heads.length}, minmax(96px, 1fr))`;
  const salespersonLink = (name: string) => `/reports/sales/item?${new URLSearchParams({ ...Object.fromEntries(new URLSearchParams(query)), salesperson: name, group: "none" })}`;

  return (
    <div className="space-y-4 pb-8">
      <div className="print:hidden"><Header user={user} plant={plant} /></div>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="print:hidden"><BackLink href="/reports">← Reports · Sales</BackLink></div>
          <h1 className="text-2xl font-bold">{TITLE[kind]}</h1>
        </div>
        <div className="flex gap-4 print:hidden">
          <a href={`/api/reports/sales/${kind}?${query}`} className="min-h-10 text-sm font-semibold text-(--brand)">CSV</a>
          <PrintButton />
        </div>
      </div>

      <form method="get" className="flex flex-wrap items-end gap-3 rounded-2xl border border-slate-200 bg-white p-3 print:hidden">
        <label className={label}>Period
          <select name="period" defaultValue={p.period} className={field}>
            {PERIODS.map((x) => <option key={x} value={x}>{PERIOD_LABEL[x]}</option>)}
          </select>
        </label>
        <label className={label}>From (custom)<input type="date" name="from" defaultValue={p.from} className={field} /></label>
        <label className={label}>To (custom)<input type="date" name="to" defaultValue={p.to} className={field} /></label>
        <label className={label}>Break down by
          <select name="breakdown" defaultValue={p.breakdown} className={field}>
            <option value="none">None</option><option value="month">Month</option><option value="quarter">Quarter</option>
          </select>
        </label>
        <label className={label}>Salesperson
          <select name="salesperson" defaultValue={p.salesperson} className={field}>
            <option value="">All</option>
            <option value="Not mentioned">Not mentioned</option>
            {r.choices.salespeople.map((x) => <option key={x} value={x}>{x}</option>)}
          </select>
        </label>
        <label className={label}>Place
          <select name="place" defaultValue={p.place} className={field}>
            <option value="">All</option>
            {r.choices.places.map((x) => <option key={x} value={x}>{x}</option>)}
          </select>
        </label>
        <label className={label}>Vehicle
          <select name="vehicle" defaultValue={p.vehicle} className={field}>
            <option value="">All</option>
            {r.choices.vehicles.map((x) => <option key={x} value={x}>{x}</option>)}
          </select>
        </label>
        <label className={label}>Group by
          <select name="group" defaultValue={p.group} className={field}>
            {groups.map((g) => <option key={g} value={g}>{GROUP_LABEL[g]}</option>)}
          </select>
        </label>
        <label className={label}>Amount
          <select name="amount" defaultValue={p.amount} className={field}>
            <option value="before">Before GST</option><option value="with">With GST</option>
          </select>
        </label>
        <button className="min-h-10 rounded-lg bg-(--brand) px-4 text-sm font-bold text-(--brand-contrast)">Run report</button>
      </form>
      <p className="text-xs text-slate-500 print:hidden">From / To are used when the period is "Custom dates".</p>

      <section className="rounded-2xl border border-slate-200 bg-white">
        <div className="space-y-0.5 py-4 text-center">
          <p className="text-sm text-slate-500">{plant?.name}</p>
          <p className="text-lg font-bold">{TITLE[kind]}{broken ? ` · by ${p.breakdown}` : ""}</p>
          <p className="text-sm text-slate-500">
            From {day(p.from)} to {day(p.to)} · {r.total.bills} bills · amounts {amountWord}
            {p.salesperson ? ` · salesperson: ${p.salesperson}` : ""}{p.place ? ` · place: ${p.place}` : ""}{p.vehicle ? ` · vehicle: ${p.vehicle}` : ""}
          </p>
        </div>
        <div className="overflow-x-auto">
          <div className="min-w-max text-sm">
            <div className="grid border-y border-slate-200 bg-slate-50 px-4 py-2 text-xs font-bold tracking-wide text-slate-600" style={{ gridTemplateColumns: gridCols }}>
              {firstCols.map((h) => <span key={h}>{h.toUpperCase()}</span>)}
              {heads.map((h) => <span key={h} className="text-right">{h.toUpperCase()}</span>)}
            </div>
            {r.groups.length === 0 && <p className="px-4 py-6 text-center text-slate-500">No sales in this period.</p>}
            {r.groups.map((g) => (
              <div key={g.key}>
                {r.group !== "none" && (
                  <div className="grid border-b border-slate-100 bg-slate-50/60 px-4 py-2 font-bold" style={{ gridTemplateColumns: gridCols }}>
                    {r.group === "salesperson" && kind === "customer" ? <a href={salespersonLink(g.label)} className="text-(--brand)">{g.label}</a> : <span>{g.label}</span>}
                    {kind === "item" && <span />}
                    {cells(g).map((c, i) => <span key={i} className="text-right">{c}</span>)}
                  </div>
                )}
                {g.rows.map((row) => (
                  <div key={row.key} className="grid border-b border-slate-100 px-4 py-2" style={{ gridTemplateColumns: gridCols }}>
                    <span className={r.group !== "none" ? "pl-4" : ""}>{row.label}</span>
                    {kind === "item" && <span className="text-slate-500">{row.sku ?? ""}</span>}
                    {cells(row).map((c, i) => <span key={i} className="text-right">{c}</span>)}
                  </div>
                ))}
              </div>
            ))}
            {r.groups.length > 0 && (
              <div className="grid px-4 py-3 text-base font-bold" style={{ gridTemplateColumns: gridCols }}>
                <span>Total</span>
                {kind === "item" && <span />}
                {cells(r.total).map((c, i) => <span key={i} className="text-right">{c}</span>)}
              </div>
            )}
          </div>
        </div>
      </section>
      <p className="text-xs text-slate-500">
        Rows by PlantOps product (Zoho&apos;s different names for one product code count as one). Salesperson and vehicle as typed on each bill; Zoho
        bills have no vehicle.
      </p>
    </div>
  );
}
