import { notFound } from "next/navigation";
import { Card } from "@plantops/ui";
import { can } from "@/server/access";
import { kit } from "@/server/kit";
import { staffList } from "@/server/people";
import { requirePageUser } from "@/server/session";
import { Header } from "../header";
import { OwnerNav } from "../owner-nav";

/** Owner (and support): everyone tracked, A-Z, then people who are no longer Plant staff (their history stays). */
export default async function StaffPage() {
  const user = await requirePageUser("/staff");
  if (!can(user, "see_everyone")) notFound();
  const [plant, list] = await Promise.all([kit.branding(user.tenantId), staffList(user)]);
  const link = (id: string, name: string) => (
    <li key={id}>
      <a href={`/staff/${id}`} className="flex min-h-12 items-center justify-between border-t border-slate-100 font-semibold first:border-t-0">
        {name}
        <span aria-hidden="true" className="text-slate-400">
          ›
        </span>
      </a>
    </li>
  );
  return (
    <div className="space-y-4">
      <Header user={user} plant={plant} />
      <OwnerNav user={user} current="staff" />
      <h1 className="text-xl font-bold">Staff</h1>
      {list.platformDown && <p className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">PlantOps can&apos;t be reached right now; showing people from their marks.</p>}
      <Card>
        {list.active.length === 0 ? (
          <p className="text-slate-600">Nobody has the Plant staff role yet. Give it to each employee on PlantOps → Manage users.</p>
        ) : (
          <ul>{list.active.map((p) => link(p.userId, p.name))}</ul>
        )}
      </Card>
      {list.former.length > 0 && (
        <>
          <h2 className="pt-2 text-base font-bold text-slate-600">No longer Plant staff</h2>
          <Card>
            <ul>{list.former.map((p) => link(p.userId, p.name))}</ul>
          </Card>
        </>
      )}
    </div>
  );
}
