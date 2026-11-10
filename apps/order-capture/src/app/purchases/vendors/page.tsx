import { redirect } from "next/navigation";
import { Card } from "@plantops/ui";
import { money } from "@/lib/money";
import { can } from "@/server/access";
import { waitingCount } from "@/server/calls-tab";
import { kit } from "@/server/kit";
import { vendorsList } from "@/server/purchases";
import { requirePageUser } from "@/server/session";
import { Header } from "../../header";
import { SectionTabs } from "../../parts";
import { day, field, one, PurchaseNav } from "../parts";

type Search = Promise<Record<string, string | string[] | undefined>>;

/** Every vendor: bought, paid, still owed; biggest first (owner, Accounts, support). */
export default async function VendorsPage({ searchParams }: { searchParams: Search }) {
  const user = await requirePageUser("/purchases/vendors");
  if (!can(user, "purchases_view")) redirect("/");
  const sp = await searchParams;
  const q = one(sp.q).slice(0, 100);
  const [plant, data, waiting] = await Promise.all([kit.branding(user.tenantId), vendorsList(user, { q }), waitingCount(user)]);
  return (
    <div className="space-y-4">
      <Header user={user} plant={plant} />
      <SectionTabs current="purchases" waiting={waiting} bills={can(user, "ledger_view")} purchases calls={can(user, "calls_view")} />
      <PurchaseNav current="vendors" user={user} />
      <Card className="grid grid-cols-2 gap-3">
        <div>
          <p className="text-xs text-slate-500">Bought, all time</p>
          <p className="text-2xl font-bold">{money(data.totals.billed)}</p>
          <p className="text-xs text-slate-500">{data.vendors.length} vendors</p>
        </div>
        <div>
          <p className="text-xs text-slate-500">You owe</p>
          <p className={`text-2xl font-bold ${data.totals.owed !== "0.00" ? "text-amber-700" : ""}`}>{money(data.totals.owed)}</p>
        </div>
      </Card>
      <form method="get">
        <input name="q" defaultValue={q} className={field} placeholder="Search vendor, phone or GSTIN" />
      </form>
      <ul className="space-y-2">
        {data.vendors.length === 0 && <p className="text-sm text-slate-500">No vendors here.</p>}
        {data.vendors.map((v) => (
          <li key={v.id}>
            <a href={`/purchases/vendors/${v.id}`} className={`flex items-start justify-between gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-3 hover:bg-slate-50 ${v.active ? "" : "opacity-60"}`}>
              <span className="min-w-0">
                <span className="block font-semibold break-words">{v.name}</span>
                <span className="block text-sm text-slate-500">
                  {v.bills} {v.bills === 1 ? "bill" : "bills"}{v.last_bill ? ` · last ${day(v.last_bill)}` : ""}{v.gstin ? ` · ${v.gstin}` : ""}{v.active ? "" : " · switched off"}
                </span>
              </span>
              <span className="shrink-0 text-right">
                <span className="block font-semibold">{money(v.billed)}</span>
                {v.balance !== "0.00" && <span className="block text-sm text-amber-700">{v.balance.startsWith("-") ? `${money(v.balance.slice(1))} advance` : `${money(v.balance)} to pay`}</span>}
              </span>
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}
