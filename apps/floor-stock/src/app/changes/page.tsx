import { redirect } from "next/navigation";
import { Card } from "@plantops/ui";
import { fmtDateTime } from "@plantops/module-kit/format";
import { kit } from "@/server/kit";
import { requirePageUser } from "@/server/session";
import { recentChanges } from "@/server/views";
import { Header } from "../header";
import { BackLink } from "../parts";

/** Owner (and PlantOps support, read-only): every change to sections, items and limits, and count corrections. */
export default async function ChangesPage() {
  const user = await requirePageUser("/changes");
  if (!user.isOwner && !user.isSupport) redirect("/");
  const [plant, changes] = await Promise.all([kit.branding(user.tenantId), recentChanges(user)]);
  return (
    <div className="space-y-5">
      <Header user={user} plant={plant} />
      <BackLink />
      <h1 className="text-2xl font-bold">Recent changes</h1>
      <p className="text-slate-600">Who changed sections, items or limits, switched something off, or corrected a count.</p>
      <Card>
        {changes.length === 0 ? (
          <p className="text-slate-500">No changes yet.</p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {changes.map((c, i) => (
              <li key={i} className="py-2">
                <p>{c.text}</p>
                <p className="text-sm text-slate-500">
                  {c.by}, {fmtDateTime(c.at)}
                </p>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
