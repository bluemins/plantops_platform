import { redirect } from "next/navigation";
import { can } from "@/server/access";
import { waitingCount } from "@/server/calls-tab";
import { kit } from "@/server/kit";
import { requirePageUser } from "@/server/session";
import { Header } from "../../header";
import { SectionTabs } from "../../parts";
import { PurchaseNav } from "../parts";
import { PurchaseImport } from "./purchase-import";

/** Owner only: bring Zoho's vendors, purchase items, bills and payments made into Purchases (docs/PURCHASES_PHASE_PLAN.md). */
export default async function PurchaseImportPage() {
  const user = await requirePageUser("/purchases/import");
  if (!can(user, "purchase_import")) redirect("/purchases");
  const [plant, waiting] = await Promise.all([kit.branding(user.tenantId), waitingCount(user)]);
  return (
    <div className="space-y-4">
      <Header user={user} plant={plant} />
      <SectionTabs current="purchases" waiting={waiting} bills={can(user, "ledger_view")} purchases calls={can(user, "calls_view")} />
      <PurchaseNav current="import" user={user} />
      <h1 className="text-2xl font-bold">Import purchases from Zoho</h1>
      <PurchaseImport />
    </div>
  );
}
