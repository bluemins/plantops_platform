import { redirect } from "next/navigation";
import { can } from "@/server/access";
import { kit } from "@/server/kit";
import { entryChoices } from "@/server/purchase-entry";
import { requirePageUser } from "@/server/session";
import { Header } from "../../../header";
import { BackLink } from "../../../parts";
import { PurchaseBillForm } from "../../forms";
import { one } from "../../parts";

type Search = Promise<Record<string, string | string[] | undefined>>;

/** Record a vendor's bill (owner, Accounts): items, GST, total, optionally paid now. */
export default async function NewPurchaseBillPage({ searchParams }: { searchParams: Search }) {
  const user = await requirePageUser("/purchases/bills/new");
  if (!can(user, "purchase_enter")) redirect("/purchases");
  const vendor = one((await searchParams).vendor);
  const [plant, choices] = await Promise.all([kit.branding(user.tenantId), entryChoices(user)]);
  return (
    <div className="space-y-4 pb-8">
      <Header user={user} plant={plant} />
      <BackLink href={vendor ? `/purchases/vendors/${vendor}` : "/purchases"}>← {vendor ? "Vendor" : "Purchase bills"}</BackLink>
      <h1 className="text-2xl font-bold">Record purchase bill</h1>
      <PurchaseBillForm choices={choices} vendorId={vendor || undefined} />
    </div>
  );
}
