import { redirect } from "next/navigation";
import { Card } from "@plantops/ui";
import { fmtDateTime } from "@plantops/module-kit/format";
import { can } from "@/server/access";
import { kit } from "@/server/kit";
import { requirePageUser } from "@/server/session";
import { listSupportViews } from "@/server/support";
import { Header } from "../header";

/** Owner: every time PlantOps support looked at this plant's job applications (read-only), and what they opened. */
export default async function SupportAccessPage() {
  const user = await requirePageUser("/support-access");
  if (!can(user, "support_log")) redirect("/applications");
  const [plant, views] = await Promise.all([kit.branding(user.tenantId), listSupportViews(user)]);
  return (
    <div className="space-y-5">
      <Header user={user} plant={plant} />
      <a href="/applications" className="inline-flex min-h-11 items-center text-sm font-semibold text-(--brand)">
        ‹ Applications
      </a>
      <h1 className="text-2xl font-bold">Support access</h1>
      <p className="text-slate-600">Each time PlantOps support opened your Job applications (read-only, they cannot change anything).</p>
      {views.length === 0 ? (
        <Card>PlantOps support has never opened your Job applications.</Card>
      ) : (
        <Card>
          <ul className="divide-y divide-slate-100">
            {views.map((v, i) => (
              <li key={i} className="py-2">
                PlantOps support viewed {v.what}, {fmtDateTime(v.at)}
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
