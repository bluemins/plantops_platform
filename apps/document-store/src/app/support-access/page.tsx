import { redirect } from "next/navigation";
import { Card } from "@plantops/ui";
import { kit } from "@/server/kit";
import { requirePageUser } from "@/server/session";
import { listSupportViews } from "@/server/support";
import { localizedDateTime, translate } from "@/lib/i18n";
import { Header } from "../header";
import { getLocale } from "@/server/locale";

/** Owner: every time PlantOps support looked at this plant's documents (read-only), and what they opened. */
export default async function SupportAccessPage() {
  const user = await requirePageUser("/support-access");
  if (!user.isOwner) redirect("/");
  const [plant, views, locale] = await Promise.all([kit.branding(user.tenantId), listSupportViews(user), getLocale()]);
  const t = (key: Parameters<typeof translate>[1]) => translate(locale, key);
  const pageName = (path: string) => (path.startsWith("/files/") ? t("supportFile") : path.startsWith("/documents/") ? t("supportDocument") : t("supportList"));
  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <Header user={user} plant={plant} locale={locale} />
      <a href="/" className="text-sm font-semibold text-(--brand)">
        {t("allDocuments")}
      </a>
      <h1 className="text-2xl font-bold">{t("supportTitle")}</h1>
      <p className="text-slate-600">
        {t("supportDescription")}
      </p>
      {views.length === 0 ? (
        <Card>{t("supportNever")}</Card>
      ) : (
        <Card>
          <ul className="divide-y divide-slate-100">
            {views.map((v, i) => (
              <li key={i} className="py-2">
                {translate(locale, "supportViewed", { page: pageName(v.path), time: localizedDateTime(locale, v.at) })}
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
