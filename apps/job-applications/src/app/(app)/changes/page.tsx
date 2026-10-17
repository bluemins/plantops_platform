import { redirect } from "next/navigation";
import { Card } from "@plantops/ui";
import { fmtDateTime } from "@plantops/module-kit/format";
import { can } from "@/server/access";
import { recentChanges } from "@/server/audit";
import { kit } from "@/server/kit";
import { requirePageUser } from "@/server/session";
import { Header } from "../header";
import { Tabs } from "../tabs";

/** Owner (and PlantOps support, read-only): every change to positions and the page message, newest first. */
export default async function ChangesPage() {
  const user = await requirePageUser("/changes");
  if (!can(user, "view_changes")) redirect("/applications");
  const [plant, changes] = await Promise.all([kit.branding(user.tenantId), recentChanges(user)]);
  return (
    <div className="space-y-5">
      <Header user={user} plant={plant} />
      <Tabs user={user} active="changes" />
      <h1 className="text-2xl font-bold">Recent changes</h1>
      <p className="text-slate-600">Who added or changed positions, switched them on or off, or changed the page message.</p>
      <Card>
        {changes.length === 0 ? (
          <p className="text-slate-500">No changes yet.</p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {changes.map((c, i) => (
              <li key={i} className="py-2">
                <p className="break-words">{c.text}</p>
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
