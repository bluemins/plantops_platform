import { redirect } from "next/navigation";
import { can } from "@/server/access";
import { cashLists } from "@/server/cash";
import { waitingCount } from "@/server/calls-tab";
import { kit } from "@/server/kit";
import { requirePageUser } from "@/server/session";
import { Header } from "../../header";
import { SectionTabs } from "../../parts";
import { ListEditor } from "../cash-forms";
import { CashNav } from "../parts";

/** Owner: the plant's expense types and vehicles (switched off, never deleted). */
export default async function CashSettingsPage() {
  const user = await requirePageUser("/cash/settings");
  if (!can(user, "cash_owner")) redirect("/cash");
  const [plant, lists, waiting] = await Promise.all([kit.branding(user.tenantId), cashLists(user), waitingCount(user)]);
  return (
    <div className="space-y-4">
      <Header user={user} plant={plant} />
      <SectionTabs current="cash" waiting={waiting} bills={can(user, "ledger_view")} purchases={can(user, "purchases_view")} cash calls={can(user, "calls_view")} />
      <CashNav current="settings" owner />
      <ListEditor list="category" items={lists.categories} title="Expense types" />
      <ListEditor list="vehicle" items={lists.vehicles} title="Vehicles" />
      <p className="text-xs text-slate-500">Alerts: a close off by ₹100 or more, and an expense of ₹2,000 or more, come to your phone. A day with entries left open is reminded at 7:00 the next morning.</p>
    </div>
  );
}
