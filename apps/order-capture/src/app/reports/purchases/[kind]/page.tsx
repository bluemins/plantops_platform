import { notFound, redirect } from "next/navigation";
import { Card } from "@plantops/ui";
import { rupees } from "@/lib/ledger";
import { money } from "@/lib/money";
import { qtyText } from "@/lib/purchase-report";
import { PERIOD_LABEL, PERIODS } from "@/lib/report";
import { can } from "@/server/access";
import { kit } from "@/server/kit";
import { PURCHASE_REPORT_KINDS, PURCHASE_REPORT_TITLE, purchaseReport, type PurchaseReportKind } from "@/server/purchase-reports";
import { requirePageUser } from "@/server/session";
import { Header } from "../../../header";
import { PrintButton } from "../../../ledger-forms";
import { BackLink } from "../../../parts";

type Params = Promise<{ kind: string }>;
type Search = Promise<Record<string, string | string[] | undefined>>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";
const R = (p: bigint) => money(rupees(p));
const field = "min-h-11 rounded-xl border border-slate-300 bg-white px-3 text-sm";
const day = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
const th = "px-2 py-2 text-left text-xs font-semibold text-slate-500";
const td = "px-2 py-2 align-top";

/** Reports → Purchases: by item, by vendor, GST paid per month (owner; support reads). From the purchase bills. */
export default async function PurchaseReportPage({ params, searchParams }: { params: Params; searchParams: Search }) {
  const kind = (await params).kind as PurchaseReportKind;
  if (!PURCHASE_REPORT_KINDS.includes(kind)) notFound();
  const user = await requirePageUser(`/reports/purchases/${kind}`);
  if (!can(user, "reports")) redirect("/");
  const sp = await searchParams;
  const [plant, r] = await Promise.all([kit.branding(user.tenantId), purchaseReport(user, kind, { period: one(sp.period), from: one(sp.from), to: one(sp.to) })]);
  return (
    <div className="space-y-4 pb-8">
      <div className="space-y-3 print:hidden">
        <Header user={user} plant={plant} />
        <BackLink href="/reports?section=purchases">← Reports</BackLink>
        <nav aria-label="Purchase reports" className="flex flex-wrap gap-x-4 gap-y-1 text-sm font-semibold">
          {PURCHASE_REPORT_KINDS.map((k) =>
            k === kind ? <span key={k} className="border-b-2 border-(--brand) pb-1">{PURCHASE_REPORT_TITLE[k]}</span> : <a key={k} href={`/reports/purchases/${k}?period=${r.period}`} className="pb-1 text-slate-600">{PURCHASE_REPORT_TITLE[k]}</a>,
          )}
          <a href="/purchases/payables" className="pb-1 text-slate-600">Payables</a>
        </nav>
        <form method="get" className="flex flex-wrap items-end gap-2">
          <label className="text-sm">Period<br />
            <select name="period" defaultValue={r.period} className={field}>{PERIODS.map((p) => <option key={p} value={p}>{PERIOD_LABEL[p]}</option>)}</select>
          </label>
          <label className="text-sm">From<br /><input type="date" name="from" defaultValue={r.from} className={field} /></label>
          <label className="text-sm">To<br /><input type="date" name="to" defaultValue={r.to} className={field} /></label>
          <button className="min-h-11 rounded-xl border border-slate-300 bg-white px-4 text-sm font-semibold">Show</button>
          <span className="ml-auto"><PrintButton /></span>
        </form>
        <p className="text-xs text-slate-500">From / To are used with “Custom dates”.</p>
      </div>
      <h1 className="text-2xl font-bold">{PURCHASE_REPORT_TITLE[kind]}</h1>
      <p className="text-sm text-slate-600">{plant?.name} · {day(r.from)} – {day(r.to)} · purchase bills from Zoho and PlantOps; cancelled ones left out</p>
      <Card className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div><p className="text-xs text-slate-500">Bills</p><p className="text-xl font-bold">{r.totals.bills}</p></div>
        <div><p className="text-xs text-slate-500">Before GST</p><p className="text-xl font-bold">{R(r.totals.amount)}</p></div>
        <div><p className="text-xs text-slate-500">GST</p><p className="text-xl font-bold">{R(r.totals.tax)}</p></div>
        <div><p className="text-xs text-slate-500">Total</p><p className="text-xl font-bold">{R(r.totals.total)}</p></div>
      </Card>

      <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white">
        {r.kind === "item" && (
          <table className="w-full min-w-[640px] text-sm">
            <thead className="border-b border-slate-200"><tr><th className={th}>Item</th><th className={`${th} text-right`}>Quantity</th><th className={`${th} text-right`}>Avg rate</th><th className={`${th} text-right`}>Bills</th><th className={`${th} text-right`}>Before GST</th><th className={`${th} text-right`}>GST</th><th className={`${th} text-right`}>With GST</th></tr></thead>
            <tbody className="divide-y divide-slate-100">
              {r.items.map((i) => (
                <tr key={i.label}>
                  <td className={td}><span className="font-semibold">{i.label}</span><span className="block text-xs text-slate-500">{i.vendors.join(", ")} · last {day(i.last)}</span></td>
                  <td className={`${td} text-right`}>{i.qty.map((q) => `${qtyText(q.milli)}${q.unit ? ` ${q.unit}` : ""}`).join(" + ")}</td>
                  <td className={`${td} text-right`}>{i.avg_rate === null ? "—" : R(i.avg_rate)}</td>
                  <td className={`${td} text-right`}>{i.bills}</td>
                  <td className={`${td} text-right`}>{R(i.amount)}</td>
                  <td className={`${td} text-right`}>{R(i.tax)}</td>
                  <td className={`${td} text-right font-semibold`}>{R(i.with_gst)}</td>
                </tr>
              ))}
              {r.items.length === 0 && <tr><td className={td} colSpan={7}>Nothing bought in these dates.</td></tr>}
            </tbody>
          </table>
        )}
        {r.kind === "vendor" && (
          <table className="w-full min-w-[640px] text-sm">
            <thead className="border-b border-slate-200"><tr><th className={th}>Vendor</th><th className={`${th} text-right`}>Bills</th><th className={`${th} text-right`}>Before GST</th><th className={`${th} text-right`}>GST</th><th className={`${th} text-right`}>Total</th><th className={`${th} text-right`}>Paid</th><th className={`${th} text-right`}>To pay</th></tr></thead>
            <tbody className="divide-y divide-slate-100">
              {r.vendors.map((v) => (
                <tr key={v.id}>
                  <td className={td}><a href={`/purchases/vendors/${v.id}`} className="font-semibold text-(--brand)">{v.label}</a></td>
                  <td className={`${td} text-right`}>{v.bills}</td>
                  <td className={`${td} text-right`}>{R(v.amount)}</td>
                  <td className={`${td} text-right`}>{R(v.tax)}</td>
                  <td className={`${td} text-right font-semibold`}>{R(v.total)}</td>
                  <td className={`${td} text-right`}>{R(v.paid)}</td>
                  <td className={`${td} text-right ${v.due > 0n ? "text-amber-700" : ""}`}>{R(v.due)}</td>
                </tr>
              ))}
              {r.vendors.length === 0 && <tr><td className={td} colSpan={7}>Nothing bought in these dates.</td></tr>}
            </tbody>
          </table>
        )}
        {r.kind === "gst" && (
          <table className="w-full min-w-[560px] text-sm">
            <thead className="border-b border-slate-200"><tr><th className={th}>Month</th><th className={`${th} text-right`}>Bills</th><th className={`${th} text-right`}>Before GST</th><th className={`${th} text-right`}>CGST</th><th className={`${th} text-right`}>SGST</th><th className={`${th} text-right`}>IGST</th><th className={`${th} text-right`}>Total GST</th></tr></thead>
            <tbody className="divide-y divide-slate-100">
              {r.months.map((m) => (
                <tr key={m.key}>
                  <td className={`${td} font-semibold`}>{m.label}</td>
                  <td className={`${td} text-right`}>{m.bills}</td>
                  <td className={`${td} text-right`}>{R(m.amount)}</td>
                  <td className={`${td} text-right`}>{R(m.cgst)}</td>
                  <td className={`${td} text-right`}>{R(m.sgst)}</td>
                  <td className={`${td} text-right`}>{R(m.igst)}</td>
                  <td className={`${td} text-right font-semibold`}>{R(m.tax)}</td>
                </tr>
              ))}
              {r.months.length === 0 && <tr><td className={td} colSpan={7}>Nothing bought in these dates.</td></tr>}
            </tbody>
          </table>
        )}
      </div>
      {r.kind === "gst" && <p className="text-xs text-slate-500">By the vendor&apos;s bill date. GSTR-2B shows what vendors filed, so a bill filed late by the vendor can sit in a later month there.</p>}
    </div>
  );
}
