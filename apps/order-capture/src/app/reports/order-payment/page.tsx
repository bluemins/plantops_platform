import { redirect } from "next/navigation";
import { money } from "@/lib/money";
import {
  FLOW_PERIOD_LABEL,
  FLOW_PERIODS,
  FLOW_STAGE_ABOUT,
  FLOW_STAGE_LABEL,
  recentlyPaid,
  type FlowRow,
  type FlowStage,
} from "@/lib/order-flow";
import { can } from "@/server/access";
import { kit } from "@/server/kit";
import { istToday } from "@/server/ledger";
import { orderFlowReport, readFlowParams, type FlowParams } from "@/server/reports";
import { requirePageUser } from "@/server/session";
import { Header } from "../../header";
import { PrintButton } from "../../ledger-forms";
import { BackLink } from "../../parts";

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };
const field = "min-h-10 rounded-lg border border-slate-300 bg-white px-2 text-sm";
const label = "flex flex-col gap-1 text-xs text-slate-600";
/** most cards a column shows; the rest are in the List */
const CARDS = 60;

// full class names, so Tailwind keeps them
const TONE: Record<FlowStage, { top: string; text: string; chip: string }> = {
  pending: { top: "border-t-slate-500", text: "text-slate-700", chip: "bg-slate-100 text-slate-800" },
  delivered: { top: "border-t-amber-600", text: "text-amber-800", chip: "bg-amber-100 text-amber-900" },
  billed: { top: "border-t-red-700", text: "text-red-800", chip: "bg-red-100 text-red-900" },
  part: { top: "border-t-violet-600", text: "text-violet-800", chip: "bg-violet-100 text-violet-900" },
  paid: { top: "border-t-green-700", text: "text-green-800", chip: "bg-green-100 text-green-900" },
  cancelled: { top: "border-t-slate-400", text: "text-slate-600", chip: "bg-slate-100 text-slate-600" },
};

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const dm = (d: string | null) => (d ? `${Number(d.slice(8, 10))} ${MONTHS[Number(d.slice(5, 7)) - 1]}` : "—");
const days = (n: number) => (n === 1 ? "1 day" : `${n} days`);

/** The address with some settings changed ("" removes one). */
function href(p: FlowParams, change: Partial<Record<keyof FlowParams, string | boolean>>) {
  const all: Record<string, string | boolean> = { ...p, ...change };
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(all)) {
    if (v === "" || v === false) continue;
    if ((k === "from" || k === "to") && all.period !== "custom") continue;
    if (k === "period" && v === "all") continue;
    if (k === "view" && v === "board") continue;
    q.set(k, v === true ? "1" : String(v));
  }
  const s = q.toString();
  return `/reports/order-payment${s ? `?${s}` : ""}`;
}

function waitText(r: FlowRow) {
  if (r.days === null) return r.stage === "paid" ? `paid ${dm(r.paid_on)}` : "";
  const since = r.stage === "pending" ? "since entered" : r.stage === "delivered" ? "since delivered" : "since bill";
  return `${days(r.days)} ${since}`;
}

function Card({ r, today }: { r: FlowRow; today: string }) {
  const pill = r.overdue
    ? "bg-red-100 text-red-900"
    : r.stage === "paid"
      ? "bg-green-100 text-green-900"
      : (r.stage === "pending" || r.stage === "delivered") && (r.days ?? 0) >= 7
        ? "bg-amber-100 text-amber-900"
        : "bg-slate-100 text-slate-700";
  const pillText = r.stage === "paid" ? (r.paid_on === today ? "paid today" : `paid ${dm(r.paid_on)}`) : r.days === null ? "" : days(r.days);
  return (
    <div className="relative flex flex-col gap-0.5 rounded-xl border border-slate-200 bg-white px-3 py-2.5 hover:bg-slate-50">
      <div className="flex items-center justify-between gap-2">
        <a href={r.href} className="text-xs font-bold text-(--brand) after:absolute after:inset-0 after:content-['']">{r.ref}</a>
        {pillText && <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${pill}`}>{pillText}</span>}
      </div>
      <span className="text-sm leading-snug font-bold break-words">{r.customer_name}</span>
      {r.place && <span className="text-xs text-slate-600">{r.place}</span>}
      <div className="mt-0.5 flex items-baseline justify-between gap-2">
        <span className="text-sm font-bold">
          {money(r.amount)}
          {r.stage === "part" && r.bill && <span className="font-normal text-slate-600"> of {money(r.bill.total)}</span>}
        </span>
        {r.bill && <a href={r.bill.href} className="relative z-10 text-xs text-slate-600 hover:underline">{r.bill.number}</a>}
      </div>
      {r.overdue && <span className="self-start rounded bg-red-100 px-1.5 py-0.5 text-[11px] font-bold text-red-900">OVERDUE</span>}
    </div>
  );
}

/** Order to Payment (Reports → Sales): where every order stands, as a Board or a List, with filters. Owner (support reads). */
export default async function OrderPaymentPage({ searchParams }: Props) {
  const user = await requirePageUser("/reports/order-payment");
  if (!can(user, "reports")) redirect("/");
  const sp = Object.fromEntries(Object.entries(await searchParams).map(([a, b]) => [a, Array.isArray(b) ? b[0] : b]));
  const today = istToday();
  const p = readFlowParams(sp, today);
  const [plant, { rows, sums, choices }] = await Promise.all([kit.branding(user.tenantId), orderFlowReport(user, p, today)]);
  const shown = p.stage ? rows.filter((r) => r.stage === p.stage) : rows;
  const open = sums.filter((s) => s.stage !== "paid" && s.stage !== "cancelled");
  const openAll = { count: open.reduce((t, s) => t + s.count, 0), amount: open.reduce((t, s) => t + s.amount, 0n) };
  const csvQuery = href(p, { view: "board" }).split("?")[1] ?? "";

  return (
    <div className="space-y-4 pb-8">
      <div className="print:hidden"><Header user={user} plant={plant} /></div>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="print:hidden"><BackLink href="/reports?section=sales">← Reports · Sales</BackLink></div>
          <h1 className="text-2xl font-bold">Order to Payment</h1>
          <p className="text-sm text-slate-600">
            Where every order stands: delivered, billed, paid. Every order and bill, including the history imported from Zoho.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-4 print:hidden">
          <nav aria-label="View" className="flex overflow-hidden rounded-lg border border-slate-300 bg-white text-sm">
            {(["board", "list"] as const).map((v) =>
              p.view === v ? (
                <span key={v} aria-current="page" className="bg-(--brand) px-4 py-2 font-bold text-(--brand-contrast)">{v === "board" ? "Board" : "List"}</span>
              ) : (
                <a key={v} href={href(p, { view: v })} className="px-4 py-2 font-semibold text-(--brand)">{v === "board" ? "Board" : "List"}</a>
              ),
            )}
          </nav>
          <a href={`/api/reports/order-payment${csvQuery ? `?${csvQuery}` : ""}`} className="min-h-10 py-2 text-sm font-semibold text-(--brand)">CSV</a>
          <PrintButton />
        </div>
      </div>

      <form method="get" className="flex flex-wrap items-end gap-3 rounded-2xl border border-slate-200 bg-white p-3 print:hidden">
        {p.view === "list" && <input type="hidden" name="view" value="list" />}
        {p.stage && <input type="hidden" name="stage" value={p.stage} />}
        <label className={label}>Orders entered
          <select name="period" defaultValue={p.period} className={field}>
            {FLOW_PERIODS.map((x) => <option key={x} value={x}>{FLOW_PERIOD_LABEL[x]}</option>)}
          </select>
        </label>
        <label className={label}>From (custom)<input type="date" name="from" defaultValue={p.period === "custom" ? p.from : ""} className={field} /></label>
        <label className={label}>To (custom)<input type="date" name="to" defaultValue={p.period === "custom" ? p.to : ""} className={field} /></label>
        <label className={label}>Customer<input name="customer" defaultValue={p.customer} placeholder="Name or mobile" className={`${field} w-40`} /></label>
        <label className={label}>Salesperson
          <select name="salesperson" defaultValue={p.salesperson} className={field}>
            <option value="">All</option>
            <option value="Not mentioned">Not mentioned</option>
            {choices.salespeople.map((x) => <option key={x} value={x}>{x}</option>)}
          </select>
        </label>
        <label className={label}>Place
          <select name="place" defaultValue={p.place} className={field}>
            <option value="">All</option>
            {choices.places.map((x) => <option key={x} value={x}>{x}</option>)}
          </select>
        </label>
        <label className={label}>Brand
          <select name="brand" defaultValue={p.brand} className={field}>
            <option value="">All</option>
            {choices.brands.map((x) => <option key={x} value={x}>{x}</option>)}
          </select>
        </label>
        <label className="flex min-h-10 items-center gap-2 text-sm font-semibold"><input type="checkbox" name="overdue" value="1" defaultChecked={p.overdue} className="size-5" /> Only overdue</label>
        <label className="flex min-h-10 items-center gap-2 text-sm font-semibold"><input type="checkbox" name="cancelled" value="1" defaultChecked={p.cancelled} className="size-5" /> Show cancelled</label>
        <button className="min-h-10 rounded-lg bg-(--brand) px-4 text-sm font-bold text-(--brand-contrast)">Run report</button>
      </form>
      <p className="text-xs text-slate-500 print:hidden">
        Amounts: Pending and Delivered = the order · Billed and Part paid = still due on the bill (with GST) · Paid = the bill. A card opens its
        order; the bill number opens the bill. Orders move on when you Mark delivered, Make bill or Receive payment.
      </p>

      {can(user, "bill_link_view") && (sums.find((s) => s.stage === "delivered")?.count ?? 0) > 0 && (
        <p className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 print:hidden">
          Some delivered orders may be billed in Zoho with the bill not linked to the order.{" "}
          <a href="/bills/link" className="font-bold text-(--brand) underline">Link bills to orders →</a>
        </p>
      )}

      {p.view === "board" ? (
        <div className="relative overflow-x-auto pb-2 lg:left-1/2 lg:w-[min(1440px,calc(100vw-2rem))] lg:-translate-x-1/2 print:static print:w-full print:translate-x-0">
          <div className="grid items-start gap-3" style={{ gridTemplateColumns: `repeat(${sums.length}, minmax(220px, 1fr))`, minWidth: sums.length * 232 }}>
            {sums.map((s) => {
              const all = rows.filter((r) => r.stage === s.stage);
              const cards = s.stage === "paid" ? all.filter((r) => recentlyPaid(r, today)) : all;
              const more = all.length - Math.min(cards.length, CARDS);
              return (
                <section key={s.stage} aria-label={FLOW_STAGE_LABEL[s.stage]} className="flex flex-col gap-2 rounded-2xl bg-slate-100 p-2.5">
                  <a href={href(p, { view: "list", stage: s.stage })} className={`rounded-xl border-t-4 bg-white px-3 py-2.5 ${TONE[s.stage].top}`}>
                    <span className="flex items-baseline justify-between gap-2">
                      <span className="text-sm font-bold">{FLOW_STAGE_LABEL[s.stage]}</span>
                      <span className="text-sm font-bold text-slate-600">{s.count}</span>
                    </span>
                    <span className={`block text-xl font-bold ${TONE[s.stage].text}`}>
                      {money(s.amount)}{s.stage === "billed" || s.stage === "part" ? " due" : ""}
                    </span>
                    <span className="block text-xs text-slate-600">
                      {s.stage === "paid" ? `Paid in the last 7 days: ${cards.length}` : FLOW_STAGE_ABOUT[s.stage]}
                      {s.overdue ? ` · ${s.overdue} overdue` : ""}
                    </span>
                  </a>
                  {cards.slice(0, CARDS).map((r) => <Card key={r.id} r={r} today={today} />)}
                  {cards.length === 0 && all.length === 0 && <p className="px-2 py-3 text-center text-xs text-slate-500">Nothing here</p>}
                  {more > 0 && (
                    <a href={href(p, { view: "list", stage: s.stage })} className="rounded-xl border border-dashed border-slate-400 bg-slate-50 p-2.5 text-center text-sm font-semibold text-(--brand)">
                      {s.stage === "paid" ? `All ${all.length} paid in the List` : `+ ${more} more in the List`}
                    </a>
                  )}
                </section>
              );
            })}
          </div>
        </div>
      ) : (
        <>
          <nav aria-label="Stages" className="grid grid-cols-[repeat(auto-fit,minmax(160px,1fr))] gap-2 print:hidden">
            {[{ stage: "" as const, label: "All open", count: openAll.count, amount: openAll.amount, overdue: 0 }, ...sums.map((s) => ({ ...s, label: FLOW_STAGE_LABEL[s.stage] }))].map((s) => {
              const on = p.stage === s.stage;
              return (
                <a
                  key={s.stage || "all"}
                  href={href(p, { stage: s.stage })}
                  aria-current={on ? "page" : undefined}
                  className={`flex flex-col rounded-xl border-2 bg-white px-3 py-2 ${on ? "border-(--brand)" : "border-slate-200"}`}
                >
                  <span className={`text-xs font-bold ${s.stage ? TONE[s.stage].text : "text-(--brand)"}`}>{s.label}</span>
                  <span className="text-lg font-bold">{money(s.amount)}</span>
                  <span className="text-xs text-slate-600">{s.count} orders{s.overdue ? ` · ${s.overdue} overdue` : ""}</span>
                </a>
              );
            })}
          </nav>
          {!p.stage && <p className="text-xs text-slate-500">“All open” = Pending + Delivered + Billed + Part paid. The table lists every stage: money waiting first, oldest first.</p>}
          <section className="relative rounded-2xl border border-slate-200 bg-white lg:left-1/2 lg:w-[min(1280px,calc(100vw-2rem))] lg:-translate-x-1/2 print:static print:w-full print:translate-x-0">
            <div className="space-y-0.5 py-3 text-center">
              <p className="text-sm text-slate-500">{plant?.name}</p>
              <p className="text-lg font-bold">Order to Payment{p.stage ? ` · ${FLOW_STAGE_LABEL[p.stage]}` : ""}</p>
              <p className="text-sm text-slate-500">
                {p.period === "all" ? "All orders" : `Entered ${dm(p.from)} – ${dm(p.to)} ${p.to.slice(0, 4)}`} · {shown.length} orders · as of {dm(today)} {today.slice(0, 4)}
              </p>
            </div>
            <p className="px-4 pb-2 text-xs text-slate-500 sm:hidden print:hidden">Swipe the table sideways to see every column →</p>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[1100px] text-sm">
                <thead>
                  <tr className="border-y border-slate-200 bg-slate-50 text-left text-xs font-bold tracking-wide text-slate-600">
                    <th className="px-3 py-2">STAGE</th>
                    <th className="px-3 py-2">ORDER</th>
                    <th className="px-3 py-2">ENTERED</th>
                    <th className="px-3 py-2">CUSTOMER</th>
                    <th className="px-3 py-2 text-right">ORDER AMOUNT</th>
                    <th className="px-3 py-2">DELIVERED</th>
                    <th className="px-3 py-2">BILL</th>
                    <th className="px-3 py-2 text-right">BILL AMOUNT</th>
                    <th className="px-3 py-2 text-right">RECEIVED</th>
                    <th className="px-3 py-2 text-right">STILL DUE</th>
                    <th className="px-3 py-2 text-right">WAITING</th>
                  </tr>
                </thead>
                <tbody>
                  {shown.length === 0 && (
                    <tr><td colSpan={11} className="px-4 py-6 text-center text-slate-500">No orders for these filters.</td></tr>
                  )}
                  {shown.map((r) => (
                    <tr key={r.id} className="border-b border-slate-100 align-top">
                      <td className="px-3 py-2"><span className={`rounded-full px-2 py-0.5 text-xs font-bold whitespace-nowrap ${TONE[r.stage].chip}`}>{FLOW_STAGE_LABEL[r.stage]}</span></td>
                      <td className="px-3 py-2 font-semibold"><a href={r.href} className="text-(--brand) hover:underline">{r.ref}</a></td>
                      <td className="px-3 py-2 whitespace-nowrap">{dm(r.entered)}</td>
                      <td className="px-3 py-2">
                        <a href={r.customer_href} className="font-semibold hover:underline">{r.customer_name}</a>
                        {r.place && <span className="block text-xs text-slate-600">{r.place}</span>}
                      </td>
                      <td className="px-3 py-2 text-right whitespace-nowrap">{money(r.order_total)}</td>
                      <td className="px-3 py-2 whitespace-nowrap">{dm(r.delivered)}</td>
                      <td className="px-3 py-2 whitespace-nowrap">{r.bill ? <a href={r.bill.href} className="text-(--brand) hover:underline">{r.bill.number}</a> : "—"}</td>
                      <td className="px-3 py-2 text-right whitespace-nowrap">{r.bill ? money(r.bill.total) : "—"}</td>
                      <td className="px-3 py-2 text-right whitespace-nowrap">{r.bill ? money(r.bill.received) : "—"}</td>
                      <td className="px-3 py-2 text-right font-bold whitespace-nowrap">{r.bill ? (r.due ? money(r.due) : "—") : "—"}</td>
                      <td className={`px-3 py-2 text-right whitespace-nowrap ${r.overdue ? "font-semibold text-red-800" : ""}`}>
                        {waitText(r)}{r.overdue ? " · overdue" : ""}
                      </td>
                    </tr>
                  ))}
                </tbody>
                {shown.length > 0 && (
                  <tfoot>
                    <tr className="border-t-2 border-slate-300 bg-slate-50 font-bold">
                      <td className="px-3 py-2.5" colSpan={4}>Total · {shown.length} orders</td>
                      <td className="px-3 py-2.5 text-right">{money(shown.reduce((t, r) => t + r.order_total, 0n))}</td>
                      <td colSpan={2} />
                      <td className="px-3 py-2.5 text-right">{money(shown.reduce((t, r) => t + (r.bill?.total ?? 0n), 0n))}</td>
                      <td className="px-3 py-2.5 text-right">{money(shown.reduce((t, r) => t + (r.bill?.received ?? 0n), 0n))}</td>
                      <td className="px-3 py-2.5 text-right">{money(shown.reduce((t, r) => t + r.due, 0n))}</td>
                      <td />
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
          </section>
        </>
      )}
    </div>
  );
}
