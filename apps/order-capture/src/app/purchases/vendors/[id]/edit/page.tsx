import { notFound, redirect } from "next/navigation";
import { can } from "@/server/access";
import { kit } from "@/server/kit";
import { orNotFound } from "@/server/pages";
import { vendorDetail } from "@/server/purchases";
import { requirePageUser } from "@/server/session";
import { Header } from "../../../../header";
import { BackLink } from "../../../../parts";
import { VendorForm } from "../../../forms";

type Params = Promise<{ id: string }>;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Edit a vendor's details or switch them off (owner, Accounts). */
export default async function EditVendorPage({ params }: { params: Params }) {
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const user = await requirePageUser(`/purchases/vendors/${id}/edit`);
  if (!can(user, "purchase_enter")) redirect(`/purchases/vendors/${id}`);
  const [plant, d] = await Promise.all([kit.branding(user.tenantId), orNotFound(vendorDetail(user, id))]);
  const v = d.vendor;
  return (
    <div className="space-y-4 pb-8">
      <Header user={user} plant={plant} />
      <BackLink href={`/purchases/vendors/${id}`}>← {v.name}</BackLink>
      <h1 className="text-2xl font-bold">Edit vendor</h1>
      <VendorForm
        id={id}
        values={{ name: v.name, company: v.company ?? "", phone: v.phone ?? "", email: v.email ?? "", gstin: v.gstin ?? "", state: v.gstin ? "" : (v.state ?? ""), address: v.address ?? "", terms: v.terms ?? "", notes: v.notes ?? "", active: v.active }}
      />
    </div>
  );
}
