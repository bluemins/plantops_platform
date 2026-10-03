import { redirect } from "next/navigation";
import { responsibleChoices } from "@/server/documents";
import { kit } from "@/server/kit";
import { requirePageUser } from "@/server/session";
import { Header } from "../../header";
import { DocumentForm } from "./form";

export default async function NewDocumentPage() {
  const user = await requirePageUser("/documents/new");
  if (!user.canManage) redirect("/");
  const [plant, people] = await Promise.all([kit.branding(user.tenantId), responsibleChoices(user)]);
  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <Header user={user} plant={plant} />
      <h1 className="text-2xl font-bold">Add a document</h1>
      <DocumentForm people={people} me={user.userId} />
    </div>
  );
}
