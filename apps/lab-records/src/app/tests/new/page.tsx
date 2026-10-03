import { redirect } from "next/navigation";
import { listBatches } from "@/server/batches";
import { listParameters } from "@/server/parameters";
import { branding } from "@/server/platform";
import { requirePageUser } from "@/server/session";
import { Header } from "../../header";
import { DailyTestForm } from "./form";

type Props = { searchParams: Promise<{ batch?: string }> };

export default async function NewDailyTestPage({ searchParams }: Props) {
  const { batch } = await searchParams;
  const user = await requirePageUser(`/tests/new${batch ? `?batch=${encodeURIComponent(batch)}` : ""}`);
  if (!user.canEnter) redirect("/");
  const [plant, params, open] = await Promise.all([
    branding(user.tenantId),
    listParameters(user, "daily"),
    listBatches(user, { statuses: ["pending", "on_hold", "approved"], limit: 40 }),
  ]);
  return (
    <div className="space-y-5">
      <Header user={user} plant={plant} />
      <h1 className="text-2xl font-bold">Daily test</h1>
      <DailyTestForm
        parameters={params.filter((p) => p.active)}
        batches={open.map((b) => ({ id: b.id, label: `${b.batch_no} · ${b.production_date}` }))}
        batchId={open.some((b) => b.id === batch) ? batch! : ""}
      />
    </div>
  );
}
