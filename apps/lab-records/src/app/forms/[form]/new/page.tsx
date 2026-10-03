import { notFound, redirect } from "next/navigation";
import { listBatches } from "@/server/batches";
import { listParameters } from "@/server/parameters";
import { branding } from "@/server/platform";
import { requirePageUser } from "@/server/session";
import { FORMS, type FormId } from "@/lib/forms";
import { Header } from "../../../header";
import { FormEntry } from "./form";

type Props = { params: Promise<{ form: string }>; searchParams: Promise<{ batch?: string }> };

export default async function NewFormRecordPage({ params, searchParams }: Props) {
  const { form } = await params;
  const { batch } = await searchParams;
  if (!["form1", "form2", "form3", "form4"].includes(form)) notFound();
  const def = FORMS[form as FormId];
  const user = await requirePageUser(`/forms/${form}/new`);
  if (!user.canEnter) redirect("/forms");
  const [plant, open, params1] = await Promise.all([
    branding(user.tenantId),
    def.batch === "none" ? Promise.resolve([]) : listBatches(user, { statuses: ["pending", "on_hold", "approved"], limit: 60 }),
    def.hasResults ? listParameters(user, "form1") : Promise.resolve([]),
  ]);
  return (
    <div className="space-y-5">
      <Header user={user} plant={plant} />
      <div>
        <p className="text-sm font-bold uppercase tracking-wide text-slate-500">{def.code}</p>
        <h1 className="text-2xl font-bold">{def.title}</h1>
      </div>
      <FormEntry
        form={def.id}
        parameters={params1}
        batches={open.map((b) => ({ id: b.id, label: `${b.batch_no} · ${b.production_date}`, production_date: b.production_date }))}
        batchId={open.some((b) => b.id === batch) ? batch! : ""}
      />
    </div>
  );
}
