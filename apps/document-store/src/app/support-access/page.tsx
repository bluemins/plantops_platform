import { redirect } from "next/navigation";
import { Card } from "@plantops/ui";
import { kit } from "@/server/kit";
import { requirePageUser } from "@/server/session";
import { listSupportViews } from "@/server/support";
import { fmtDateTime } from "@/lib/format";
import { Header } from "../header";

const pageName = (path: string) => (path.startsWith("/files/") ? "a file" : path.startsWith("/documents/") ? "a document" : "the documents list");

/** Owner: every time PlantOps support looked at this plant's documents (read-only), and what they opened. */
export default async function SupportAccessPage() {
  const user = await requirePageUser("/support-access");
  if (!user.isOwner) redirect("/");
  const [plant, views] = await Promise.all([kit.branding(user.tenantId), listSupportViews(user)]);
  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <Header user={user} plant={plant} />
      <a href="/" className="text-sm font-semibold text-(--brand)">
        ← All documents
      </a>
      <h1 className="text-2xl font-bold">PlantOps support access</h1>
      <p className="text-slate-600">
        PlantOps support can open your Document Store <b>read-only</b> when you ask for help. They can&apos;t change or delete anything, and every page
        or file they open is listed here.
      </p>
      {views.length === 0 ? (
        <Card>PlantOps support has never opened your Document Store.</Card>
      ) : (
        <Card>
          <ul className="divide-y divide-slate-100">
            {views.map((v, i) => (
              <li key={i} className="py-2">
                PlantOps support viewed Document Store ({pageName(v.path)}), <b>{fmtDateTime(v.at)}</b>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
