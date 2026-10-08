import { redirect } from "next/navigation";
import { Card } from "@plantops/ui";
import { kit } from "@/server/kit";
import { requirePageUser } from "@/server/session";
import { listSupportViews } from "@/server/support";
import { fmtDateTime } from "@/lib/format";
import { Header } from "../header";

const pageName = (path: string) =>
  path.startsWith("/setup") ? "Sections & items" : path.startsWith("/day/") ? `the count of ${path.slice(5, 15)}` : path.startsWith("/items/") ? "an item's history" : path.startsWith("/history") ? "the history" : path.startsWith("/changes") ? "Recent changes" : "the Floor Stock home screen";

/** Owner: every time PlantOps support looked at this plant's stock (read-only), and what they opened. */
export default async function SupportAccessPage() {
  const user = await requirePageUser("/support-access");
  if (!user.isOwner) redirect("/");
  const [plant, views] = await Promise.all([kit.branding(user.tenantId), listSupportViews(user)]);
  return (
    <div className="space-y-5">
      <Header user={user} plant={plant} />
      <a href="/" className="text-sm font-semibold text-(--brand)">
        ← Floor Stock
      </a>
      <h1 className="text-2xl font-bold">Support access</h1>
      <p className="text-slate-600">Each time PlantOps support opened your Floor Stock (read-only, they cannot change anything).</p>
      {views.length === 0 ? (
        <Card>PlantOps support has never opened your Floor Stock.</Card>
      ) : (
        <Card>
          <ul className="divide-y divide-slate-100">
            {views.map((v, i) => (
              <li key={i} className="py-2">
                PlantOps support viewed {pageName(v.path)}, {fmtDateTime(v.at)}
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
