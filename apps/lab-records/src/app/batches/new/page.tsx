import { redirect } from "next/navigation";
import { todayIst } from "@/server/batches";
import { branding, productLabel, products } from "@/server/platform";
import { requirePageUser } from "@/server/session";
import { Header } from "../../header";
import { NewBatchForm } from "./form";

export default async function NewBatchPage() {
  const user = await requirePageUser("/batches/new");
  if (!user.canEnter) redirect("/");
  const [plant, skus] = await Promise.all([branding(user.tenantId), products(user.tenantId)]);
  const options = skus.filter((s) => s.status === "active").map((s) => ({ id: s.id, label: productLabel(s) }));
  return (
    <div className="space-y-5">
      <Header user={user} plant={plant} />
      <h1 className="text-2xl font-bold">New batch</h1>
      <NewBatchForm products={options} today={todayIst()} />
    </div>
  );
}
