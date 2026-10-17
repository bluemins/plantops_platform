import { notFound } from "next/navigation";
import { Card } from "@plantops/ui";
import { fmtDateTime } from "@plantops/module-kit/format";
import { can } from "@/server/access";
import { recentChanges } from "@/server/audit";
import { kit } from "@/server/kit";
import { requirePageUser } from "@/server/session";
import { Header } from "../header";
import { OwnerNav } from "../owner-nav";
import { waitingClaims } from "@/server/claims";

/** Owner (and support, read-only): settings, new QR, fixes and CSV downloads, newest first. */
export default async function ChangesPage() {
  const user = await requirePageUser("/changes");
  if (!can(user, "view_changes")) notFound();
  const [plant, changes] = await Promise.all([kit.branding(user.tenantId), recentChanges(user)]);
  return (
    <div className="space-y-4">
      <Header user={user} plant={plant} />
      <OwnerNav user={user} current="changes" claimsWaiting={await waitingClaims(user)} />
      <h1 className="text-xl font-bold">Recent changes</h1>
      {changes.length === 0 ? (
        <Card>Nothing changed yet.</Card>
      ) : (
        <Card>
          <ul className="divide-y divide-slate-100">
            {changes.map((c, i) => (
              <li key={i} className="space-y-0.5 py-2.5">
                <p>{c.text}</p>
                <p className="text-sm text-slate-500">
                  {c.by} · {fmtDateTime(c.at)}
                </p>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
