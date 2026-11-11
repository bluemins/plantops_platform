import { redirect } from "next/navigation";
import { can } from "@/server/access";
import { waitingCount } from "@/server/calls-tab";
import { kit } from "@/server/kit";
import { purchasesReceived } from "@/server/purchase-reports";
import { requirePageUser } from "@/server/session";
import { Header } from "../../header";
import { SectionTabs } from "../../parts";
import { day, field, one, PurchaseNav, qty } from "../parts";

type Search = Promise<Record<string, string | string[] | undefined>>;

/**
 * Purchases received: what was bought, by date (owner, Accounts, Store keeper, support). Never rates, amounts or payments:
 * the Store keeper checks deliveries against the stock count (owner, 2026-11-10; P5).
 */
export default async function PurchasesReceivedPage({ searchParams }: { searchParams: Search }) {
  const user = await requirePageUser("/purchases/received");
  if (!can(user, "purchases_received")) redirect("/");
  const sp = await searchParams;
  const store = user.who === "store";
  const [plant, data, waiting] = await Promise.all([
    kit.branding(user.tenantId),
    purchasesReceived(user, { from: one(sp.from), to: one(sp.to), q: one(sp.q) }),
    store ? Promise.resolve(0) : waitingCount(user),
  ]);
  const byDate = new Map<string, typeof data.lines>();
  for (const l of data.lines) byDate.set(l.date, [...(byDate.get(l.date) ?? []), l]);
  return (
    <div className="space-y-4">
      <Header user={user} plant={plant} />
      {store ? (
        <h1 className="text-2xl font-bold">Purchases received</h1>
      ) : (
        <>
          <SectionTabs current="purchases" waiting={waiting} bills={can(user, "ledger_view")} purchases calls={can(user, "calls_view")} cash={can(user, "cash_view")} />
          <PurchaseNav current="received" user={user} />
        </>
      )}
      <p className="text-sm text-slate-600">What was bought, from the purchase bills: check it against the stock count. Quantities as on the vendor&apos;s bill.</p>
      <form method="get" className="space-y-2">
        <input name="q" defaultValue={data.q} className={field} placeholder="Search item or vendor" />
        <div className="grid grid-cols-2 gap-2">
          <label className="text-sm">From<input type="date" name="from" defaultValue={data.from} className={field} /></label>
          <label className="text-sm">To<input type="date" name="to" defaultValue={data.to} className={field} /></label>
        </div>
        <button className="min-h-11 w-full rounded-xl border border-slate-300 bg-white text-sm font-semibold">Show</button>
      </form>
      {data.lines.length === 0 && <p className="text-sm text-slate-500">Nothing bought in these dates.</p>}
      {[...byDate].map(([date, lines]) => (
        <section key={date} className="space-y-2">
          <h2 className="text-sm font-bold text-slate-600">{day(date)}</h2>
          <ul className="space-y-2">
            {lines.map((l, i) => (
              <li key={`${l.bill_id}-${i}`} className="flex items-start justify-between gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-3">
                <span className="min-w-0">
                  <span className="block font-semibold break-words">{l.item}</span>
                  <span className="block text-sm text-slate-500">{l.vendor} · {l.number}{l.description ? ` · ${l.description}` : ""}</span>
                </span>
                <span className="shrink-0 text-right font-semibold">{qty(l.quantity)}{l.unit ? ` ${l.unit}` : ""}</span>
              </li>
            ))}
          </ul>
        </section>
      ))}
      {data.more && <p className="text-sm text-slate-500">Showing the latest 500 lines. Pick fewer days to see the rest.</p>}
    </div>
  );
}
