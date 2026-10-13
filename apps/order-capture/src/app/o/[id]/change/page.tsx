import { notFound, redirect } from "next/navigation";
import { can } from "@/server/access";
import { getOrder } from "@/server/handling";
import { kit } from "@/server/kit";
import { formProducts } from "@/server/orders";
import { orNotFound } from "@/server/pages";
import { requirePageUser } from "@/server/session";
import { Header } from "../../../header";
import { BackLink } from "../../../parts";
import type { EditProduct } from "../../../lines-editor";
import { ChangeEditor } from "./editor";

type Params = Promise<{ id: string }>;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Change a pending order's lines (owner and Order desk): saved as a new version, the old one kept. */
export default async function ChangeOrderPage({ params }: { params: Params }) {
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const user = await requirePageUser(`/o/${id}/change`);
  if (!can(user, "enter")) redirect(`/o/${id}`);
  const [plant, o, active] = await Promise.all([kit.branding(user.tenantId), orNotFound(getOrder(user, id)), formProducts(user)]);
  if (o.status !== "pending") redirect(`/o/${id}`);
  // products already in the order stay changeable even if switched off in PlantOps since (with their saved name / unit)
  const kept: EditProduct[] = o.lines
    .filter((l) => !active.some((p) => p.sku_id === l.sku_id))
    .map((l) => ({ sku_id: l.sku_id, product: l.product, pack: "", unit: l.unit, default_rate: null, addable: false }));
  const products = [...active.map((p) => ({ ...p, unit: o.lines.find((l) => l.sku_id === p.sku_id)?.unit ?? p.unit })), ...kept];

  return (
    <div className="space-y-4 pb-48">
      <Header user={user} plant={plant} />
      <BackLink href={`/o/${id}`}>← Order {o.ref}</BackLink>
      <h1 className="text-2xl font-bold">Change {o.ref}</h1>
      <p className="text-slate-600">
        {o.customer.name}, {o.customer.place}. The order is saved as a new version; the old one stays in its history.
      </p>
      <ChangeEditor order={{ id: o.id, ref: o.ref, status: o.status, version: o.version, total: o.total, lines: o.lines }} products={products} />
    </div>
  );
}
