import { notFound, redirect } from "next/navigation";
import { can } from "@/server/access";
import { dropCard } from "@/server/drop/manage";
import { kit } from "@/server/kit";
import { orNotFound } from "@/server/pages";
import { requirePageUser } from "@/server/session";
import { Header } from "../../../header";
import { BackLink } from "../../../parts";
import { DropCard } from "../../../drop-card";

type Params = Promise<{ id: string }>;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** One customer's Drop card on its own (Order desk: extra phones; owner and support too). No amounts here. */
export default async function DropPhonesPage({ params }: { params: Params }) {
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const user = await requirePageUser(`/customers/${id}/drop`);
  if (!can(user, "drop_view")) redirect("/customers");
  const [plant, view] = await Promise.all([kit.branding(user.tenantId), orNotFound(dropCard(user, id))]);
  return (
    <div className="space-y-4 pb-8">
      <Header user={user} plant={plant} />
      <BackLink href={can(user, "account_view") ? `/customers/${id}` : "/customers"}>{can(user, "account_view") ? "← Customer" : "← Customers"}</BackLink>
      <h1 className="text-2xl font-bold">{view.name}: Drop app</h1>
      <section className="rounded-xl border border-slate-200 bg-white p-4">
        <DropCard customerId={id} view={view} />
      </section>
    </div>
  );
}
