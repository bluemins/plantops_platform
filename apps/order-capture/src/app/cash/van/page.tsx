import { redirect } from "next/navigation";
import { Card } from "@plantops/ui";
import { paise, signedMoney } from "@/lib/cash";
import { can } from "@/server/access";
import { waitingCount } from "@/server/calls-tab";
import { waitingToPost } from "@/server/collections";
import { kit } from "@/server/kit";
import { requirePageUser } from "@/server/session";
import { vanReportsList } from "@/server/van";
import { Header } from "../../header";
import { SectionTabs } from "../../parts";
import { CashNav, shortDay } from "../parts";

/** Cash → Vans: recent van reports, newest first (owner, Accounts; support reads). */
export default async function VansPage() {
  const user = await requirePageUser("/cash/van");
  if (!can(user, "cash_view")) redirect("/");
  const [plant, list, waiting, toPost] = await Promise.all([kit.branding(user.tenantId), vanReportsList(user), waitingCount(user), waitingToPost(user)]);
  return (
    <div className="space-y-4">
      <Header user={user} plant={plant} />
      <SectionTabs current="cash" waiting={waiting} bills={can(user, "ledger_view")} purchases={can(user, "purchases_view")} cash calls={can(user, "calls_view")} />
      <CashNav current="van" owner={can(user, "cash_owner")} toPost={toPost} />
      {can(user, "cash_enter") && <a href="/cash/van/new" className="flex min-h-12 items-center justify-center rounded-xl bg-(--brand) font-semibold text-(--brand-contrast)">+ Van report</a>}
      {list.length === 0 ? (
        <Card><p className="text-sm text-slate-600">No van reports yet.</p></Card>
      ) : (
        <ul className="divide-y divide-slate-100 rounded-2xl border border-slate-200 bg-white">
          {list.map((v) => (
            <li key={v.id}>
              <a href={`/cash/van/${v.id}`} className={`flex items-start justify-between gap-3 px-4 py-3 ${v.cancelled ? "opacity-60" : ""}`}>
                <span className="min-w-0">
                  <span className={`block font-semibold ${v.cancelled ? "line-through" : ""}`}>{v.vehicle} · {shortDay(v.work_date)}</span>
                  <span className="text-xs text-slate-500">{v.ref} · {v.person} · sold {signedMoney(paise(v.sales))}</span>
                </span>
                <span className="shrink-0 text-right">
                  <span className="block font-bold">{signedMoney(paise(v.handed_in))}</span>
                  {paise(v.difference) !== 0n && <span className="text-xs font-semibold text-red-700">{paise(v.difference) < 0n ? "short" : "extra"} {signedMoney(paise(v.difference) < 0n ? -paise(v.difference) : paise(v.difference))}</span>}
                </span>
              </a>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
