import { redirect } from "next/navigation";
import { Card } from "@plantops/ui";
import { rupees } from "@/lib/ledger";
import { money } from "@/lib/money";
import { AGE_BANDS } from "@/lib/purchase-report";
import { can } from "@/server/access";
import { waitingCount } from "@/server/calls-tab";
import { kit } from "@/server/kit";
import { payablesReport } from "@/server/purchase-reports";
import { requirePageUser } from "@/server/session";
import { Header } from "../../header";
import { PrintButton } from "../../ledger-forms";
import { SectionTabs } from "../../parts";
import { day, PurchaseNav } from "../parts";

const R = (p: bigint) => money(rupees(p));
const TONE: Record<string, string> = { not_due: "text-slate-700", d1_15: "text-amber-700", d16_30: "text-amber-800", d31_45: "text-red-700", d45: "text-red-800" };

/** Payables: what is owed to each vendor today, by how late (owner, Accounts, support). Oldest bill first. */
export default async function PayablesPage() {
  const user = await requirePageUser("/purchases/payables");
  if (!can(user, "payables")) redirect("/purchases");
  const [plant, p, waiting] = await Promise.all([kit.branding(user.tenantId), payablesReport(user), waitingCount(user)]);
  return (
    <div className="space-y-4 pb-8">
      <div className="space-y-4 print:hidden">
        <Header user={user} plant={plant} />
        <SectionTabs current="purchases" waiting={waiting} bills={can(user, "ledger_view")} purchases calls={can(user, "calls_view")} cash={can(user, "cash_view")} />
        <PurchaseNav current="payables" user={user} />
      </div>
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-2xl font-bold">Payables · {day(p.today)}</h1>
        <span className="print:hidden"><PrintButton /></span>
      </div>
      <Card className="space-y-3">
        <div className="flex items-end justify-between gap-3">
          <div>
            <p className="text-xs text-slate-500">You owe vendors</p>
            <p className={`text-3xl font-bold ${p.owed ? "text-amber-700" : ""}`}>{R(p.owed)}</p>
            {p.advance > 0n && <p className="text-xs text-slate-500">less {R(p.advance)} paid in advance = {R(p.owed - p.advance)}</p>}
          </div>
          <p className="text-sm text-slate-500">{p.vendors.length} {p.vendors.length === 1 ? "vendor" : "vendors"}</p>
        </div>
        <div className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-5">
          {AGE_BANDS.map((b) => (
            <div key={b.key} className="rounded-lg bg-slate-50 px-3 py-2">
              <p className="text-xs text-slate-500">{b.label}</p>
              <p className={`font-semibold ${p.totals[b.key] ? TONE[b.key] : "text-slate-400"}`}>{R(p.totals[b.key])}</p>
            </div>
          ))}
        </div>
        <p className="text-xs text-slate-500">Late = days after the bill&apos;s due date (Due on Receipt = the bill date).</p>
      </Card>
      {p.vendors.length === 0 && <p className="text-sm text-slate-500">Nothing owed to any vendor.</p>}
      {p.vendors.map((v) => (
        <Card key={v.id} className="space-y-2">
          <div className="flex items-start justify-between gap-3">
            <a href={`/purchases/vendors/${v.id}`} className="font-semibold break-words text-(--brand)">{v.label}</a>
            <span className="shrink-0 text-right">
              <span className="block text-lg font-bold">{R(v.owed)}</span>
              {v.advance > 0n && <span className="block text-xs text-slate-500">{R(v.advance)} advance</span>}
            </span>
          </div>
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
            {AGE_BANDS.filter((b) => v.bands[b.key] > 0n).map((b) => <span key={b.key} className={TONE[b.key]}>{b.label}: {R(v.bands[b.key])}</span>)}
          </div>
          <ul className="divide-y divide-slate-100 text-sm">
            {v.bills.map((b) => (
              <li key={b.id} className="flex justify-between gap-3 py-1">
                <a href={`/purchases/bills/${b.id}`} className="text-slate-700">{b.number} · {day(b.bill_date)}{b.late > 0 ? <span className={TONE[b.band]}> · {b.late} days late</span> : " · not due yet"}</a>
                <span className="shrink-0">{R(b.due)}</span>
              </li>
            ))}
          </ul>
        </Card>
      ))}
    </div>
  );
}
