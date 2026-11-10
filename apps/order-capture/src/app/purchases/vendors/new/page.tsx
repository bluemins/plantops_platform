import { redirect } from "next/navigation";
import { can } from "@/server/access";
import { kit } from "@/server/kit";
import { requirePageUser } from "@/server/session";
import { Header } from "../../../header";
import { BackLink } from "../../../parts";
import { EMPTY_VENDOR, VendorForm } from "../../forms";
import { one } from "../../parts";

type Search = Promise<Record<string, string | string[] | undefined>>;

/** Add a vendor (owner, Accounts). From the bill form (?back=bill) it goes back there. */
export default async function NewVendorPage({ searchParams }: { searchParams: Search }) {
  const user = await requirePageUser("/purchases/vendors/new");
  if (!can(user, "purchase_enter")) redirect("/purchases/vendors");
  const toBill = one((await searchParams).back) === "bill";
  const plant = await kit.branding(user.tenantId);
  return (
    <div className="space-y-4 pb-8">
      <Header user={user} plant={plant} />
      <BackLink href={toBill ? "/purchases/bills/new" : "/purchases/vendors"}>← {toBill ? "Record purchase bill" : "Vendors"}</BackLink>
      <h1 className="text-2xl font-bold">Add vendor</h1>
      <VendorForm values={EMPTY_VENDOR} back={toBill ? "/purchases/bills/new" : undefined} />
    </div>
  );
}
