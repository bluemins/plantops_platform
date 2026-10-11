import { redirect } from "next/navigation";
import { productLabel } from "@plantops/module-kit";
import { can } from "@/server/access";
import { listItems, starterFor } from "@/server/items";
import { kit } from "@/server/kit";
import { requirePageUser } from "@/server/session";
import { Header } from "../header";
import { BackLink } from "../parts";
import { ItemsEditor } from "./editor";

/** "Item list": what complaints can be about. Owner edits; PlantOps support sees it read-only; staff are sent home. */
export default async function ItemsPage() {
  const user = await requirePageUser("/items");
  if (!can(user, "view_items")) redirect("/");
  const canEdit = can(user, "manage_items");
  const [plant, items, skus] = await Promise.all([kit.branding(user.tenantId), listItems(user), kit.products(user.tenantId)]);
  const products = skus.filter((s) => s.status === "active").map((s) => ({ id: s.id, label: productLabel(s) }));
  // first start: what the starter list would create, so the owner can untick entries before saying yes
  const starter = canEdit && items.length === 0 ? await starterFor(user) : null;

  return (
    <div className="space-y-5">
      <Header user={user} plant={plant} />
      <BackLink />
      <h1 className="text-2xl font-bold">Item list</h1>
      <ItemsEditor items={items} products={products} starter={starter} canEdit={canEdit} />
    </div>
  );
}
