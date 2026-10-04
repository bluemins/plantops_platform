import { redirect } from "next/navigation";
import { responsibleChoices } from "@/server/documents";
import { kit } from "@/server/kit";
import { requirePageUser } from "@/server/session";
import { Header } from "../../header";
import { DocumentForm } from "./form";
import { getLocale } from "@/server/locale";
import { translate } from "@/lib/i18n";

export default async function NewDocumentPage() {
  const user = await requirePageUser("/documents/new");
  if (!user.canManage) redirect("/");
  const [plant, people, locale] = await Promise.all([kit.branding(user.tenantId), responsibleChoices(user), getLocale()]);
  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <Header user={user} plant={plant} locale={locale} />
      <h1 className="text-2xl font-bold">{translate(locale, "addTitle")}</h1>
      <DocumentForm people={people} me={user.userId} />
    </div>
  );
}
