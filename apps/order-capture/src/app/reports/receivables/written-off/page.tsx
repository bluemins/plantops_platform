import { redirect } from "next/navigation";
import { money } from "@/lib/money";
import { dmy } from "@/lib/receivables";
import { PERIOD_LABEL, PERIODS } from "@/lib/report";
import { can } from "@/server/access";
import { kit } from "@/server/kit";
import { writeOffsReport } from "@/server/ledger";
import { requirePageUser } from "@/server/session";
import { readWriteOffParams } from "@/server/write-off-report";
import { Header } from "../../../header";
import { PrintButton } from "../../../ledger-forms";
import { BackLink } from "../../../parts";

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };
const field = "min-h-10 rounded-lg border border-slate-300 bg-white px-2 text-sm";
const label = "flex flex-col gap-1 text-xs text-slate-600";

/** Every write-off in a period: who, which bills, why, how much (owner, 2026-11-20; support reads). */
export default async function WrittenOffPage({ searchParams }: Props) {
  const user = await requirePageUser("/reports/receivables/written-off");
  if (!can(user, "reports")) redirect("/");
  const sp = Object.fromEntries(Object.entries(await searchParams).map(([a, b]) => [a, Array.isArray(b) ? b[0] : b]));
  const p = readWriteOffParams(sp);
  const [plant, r] = await Promise.all([kit.branding(user.tenantId), writeOffsReport(user, p)]);
  const query = new URLSearchParams({ period: p.period, from: p.from, to: p.to }).toString();
  const href = (x: { customer_id: string | null; contact_id: string | null }) => (x.customer_id ? `/customers/${x.customer_id}` : x.contact_id ? `/customers/z/${x.contact_id}` : null);

  return (
    <div className="space-y-4 pb-8">
      <div className="print:hidden"><Header user={user} plant={plant} /></div>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="print:hidden"><BackLink href="/reports?section=receivables">← Reports · Receivables</BackLink></div>
          <h1 className="text-2xl font-bold">Written off</h1>
          <p className="text-sm text-slate-600">Dues written off as not coming back, {dmy(p.from)} to {dmy(p.to)}. Amounts with GST.</p>
        </div>
        <div className="flex gap-4 print:hidden">
          <a href={`/api/reports/receivables/written-off?${query}`} className="min-h-10 text-sm font-semibold text-(--brand)">CSV</a>
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
        <button className="min-h-10 rounded-lg border border-slate-300 bg-white px-4 text-sm font-semibold">Show</button>
      </form>

      {r.rows.length === 0 ? (
        <p className="rounded-2xl border border-slate-200 bg-white p-4 text-sm text-slate-600">Nothing written off in this period.</p>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white">
          <table className="w-full min-w-[640px] text-sm tabular-nums">
            <thead>
              <tr className="border-b border-slate-200 text-left text-xs tracking-wide text-slate-500 uppercase">
                <th className="px-3 py-2 font-semibold">Date</th>
                <th className="px-3 py-2 font-semibold">Customer</th>
                <th className="px-3 py-2 font-semibold">Bills</th>
                <th className="px-3 py-2 font-semibold">Reason</th>
                <th className="px-3 py-2 font-semibold">By</th>
                <th className="px-3 py-2 text-right font-semibold">Amount</th>
              </tr>
            </thead>
            <tbody>
              {r.rows.map((x, i) => {
                const h = href(x);
                return (
                  <tr key={i} className="border-b border-slate-100 align-top">
                    <td className="px-3 py-2 whitespace-nowrap">{dmy(x.on)}</td>
                    <td className="px-3 py-2">{h ? <a href={h} className="font-semibold text-(--brand) hover:underline">{x.name}</a> : x.name}</td>
                    <td className="px-3 py-2">{x.bills}</td>
                    <td className="px-3 py-2">{x.reason}</td>
                    <td className="px-3 py-2 whitespace-nowrap">{x.by}</td>
                    <td className="px-3 py-2 text-right whitespace-nowrap">{money(x.amount)}</td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr className="font-semibold">
                <td className="px-3 py-2" colSpan={5}>{r.rows.length} write-off{r.rows.length === 1 ? "" : "s"}</td>
                <td className="px-3 py-2 text-right whitespace-nowrap">{money(r.total)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </div>
  );
}
