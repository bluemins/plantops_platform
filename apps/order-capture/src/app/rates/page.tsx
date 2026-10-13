import { redirect } from "next/navigation";
import { Card } from "@plantops/ui";
import { can } from "@/server/access";
import { kit } from "@/server/kit";
import { listRates } from "@/server/rates";
import { requirePageUser } from "@/server/session";
import { Header } from "../header";
import { BackLink, LinkRow } from "../parts";
import { RatesEditor } from "./editor";

/** The owner's units and default rates per product (PlantOps support: read-only; Order desk: not here). */
export default async function RatesPage() {
  const user = await requirePageUser("/rates");
  if (!can(user, "view_rates")) redirect("/");
  const [plant, rates] = await Promise.all([kit.branding(user.tenantId), listRates(user)]);
  return (
    <div className="space-y-5">
      <Header user={user} plant={plant} />
      <BackLink />
      <h1 className="text-2xl font-bold">Rates</h1>
      <p className="text-slate-600">
        Default rate per unit. For a customer who has ordered before, their last rate is filled in instead. Products come from PlantOps → Business details → Products.
      </p>
      {rates.length === 0 ? (
        <Card>
          <p className="font-semibold">No products to show.</p>
          <p className="mt-1 text-slate-600">
            Add your products in PlantOps → Business details → Products. If you already have, PlantOps can&apos;t be reached right now: try again in a minute.
          </p>
        </Card>
      ) : (
        <RatesEditor rates={rates} canEdit={can(user, "rates")} />
      )}
      <nav className="space-y-3" aria-label="More">
        <LinkRow href="/customers">{can(user, "customer_upload") ? "Customers · upload a list" : "Customers"}</LinkRow>
        {can(user, "view_changes") && <LinkRow href="/changes">Recent changes</LinkRow>}
      </nav>
    </div>
  );
}
