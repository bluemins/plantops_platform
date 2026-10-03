import { redirect } from "next/navigation";
import { Card } from "@plantops/ui";
import { branding } from "@/server/platform";
import { requirePageUser } from "@/server/session";
import { listSupportViews } from "@/server/support";
import { fmtDateTime } from "@/lib/format";
import { Header } from "../header";

const PAGE_NAMES: [RegExp, string][] = [
  [/^\/$/, "Home"],
  [/^\/batches\//, "a batch"],
  [/^\/entries\//, "a record"],
  [/^\/forms/, "FSSAI forms"],
  [/^\/search/, "Search"],
  [/^\/print\//, "a print page"],
];
const pageName = (path: string) => PAGE_NAMES.find(([re]) => re.test(path))?.[1] ?? path;

/** Owner: every time PlantOps support looked at this plant's Lab Records (read-only), and what they opened. */
export default async function SupportAccessPage() {
  const user = await requirePageUser("/support-access");
  if (!user.isOwner) redirect("/");
  const [plant, views] = await Promise.all([branding(user.tenantId), listSupportViews(user)]);
  return (
    <div className="space-y-5">
      <Header user={user} plant={plant} />
      <a href="/" className="text-sm font-semibold text-(--brand)">
        ← Home
      </a>
      <h1 className="text-2xl font-bold">PlantOps support access</h1>
      <p className="text-slate-600">
        PlantOps support can open your Lab Records <b>read-only</b> when you ask for help. They can&apos;t change or delete anything, and every page
        they open is listed here.
      </p>
      {views.length === 0 ? (
        <Card>PlantOps support has never opened your Lab Records.</Card>
      ) : (
        <Card>
          <ul className="divide-y divide-slate-100">
            {views.map((v, i) => (
              <li key={i} className="py-2">
                PlantOps support viewed Lab Records ({pageName(v.path)}), <b>{fmtDateTime(v.at)}</b>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
