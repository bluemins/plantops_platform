import { redirect } from "next/navigation";
import { Card } from "@plantops/ui";
import { can } from "@/server/access";
import { kit } from "@/server/kit";
import { formProducts } from "@/server/orders";
import { requirePageUser } from "@/server/session";
import { Header } from "../header";
import { BackLink } from "../parts";
import { OrderForm } from "./form";

/** New order (owner and Order desk): customer by phone, products with quantity and rate, Save. */
export default async function NewOrderPage() {
  const user = await requirePageUser("/new");
  if (!can(user, "enter")) redirect("/");
  const [plant, products] = await Promise.all([kit.branding(user.tenantId), formProducts(user)]);
  return (
    <div className="space-y-4 pb-48">
      <Header user={user} plant={plant} />
      <BackLink />
      <h1 className="text-2xl font-bold">New order</h1>
      {products.length === 0 ? (
        <Card>
          <p className="font-semibold">Products can&apos;t be loaded right now, try again.</p>
          <p className="mt-1 text-slate-600">If this keeps happening, check the products in PlantOps → Business details → Products.</p>
          <a href="/new" className="mt-3 inline-flex min-h-12 items-center rounded-xl bg-(--brand) px-5 font-semibold text-(--brand-contrast)">
            Try again
          </a>
        </Card>
      ) : (
        <OrderForm products={products} ownerNotified={!user.isOwner} />
      )}
    </div>
  );
}
