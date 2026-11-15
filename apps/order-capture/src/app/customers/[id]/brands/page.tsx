import { notFound, redirect } from "next/navigation";
import { can } from "@/server/access";
import { brandsCard } from "@/server/customer-brands";
import { kit } from "@/server/kit";
import { orNotFound } from "@/server/pages";
import { requirePageUser } from "@/server/session";
import { Header } from "../../../header";
import { BackLink } from "../../../parts";
import { BrandsCard } from "../../../brands-card";

type Params = Promise<{ id: string }>;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** One customer's "Brands they buy" on its own: for Order desk, who doesn't open the customer's account page. No amounts. */
export default async function CustomerBrandsPage({ params }: { params: Params }) {
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const user = await requirePageUser(`/customers/${id}/brands`);
  if (!can(user, "brands_view")) redirect("/customers");
  const [plant, view] = await Promise.all([kit.branding(user.tenantId), orNotFound(brandsCard(user, id))]);
  const back = can(user, "account_view") ? { href: `/customers/${id}`, text: "← Customer" } : { href: "/customers", text: "← Customers" };
  return (
    <div className="space-y-4 pb-8">
      <Header user={user} plant={plant} />
      <BackLink href={back.href}>{back.text}</BackLink>
      <h1 className="text-2xl font-bold">{view.name}: brands they buy</h1>
      <section className="rounded-xl border border-slate-200 bg-white p-4">
        <BrandsCard view={view} />
      </section>
    </div>
  );
}
