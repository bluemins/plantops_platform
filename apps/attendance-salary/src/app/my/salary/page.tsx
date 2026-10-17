import { Card } from "@plantops/ui";
import { fmtDayLong, fmtMonth } from "@/lib/days";
import { rupeesText } from "@/lib/salary";
import { kit } from "@/server/kit";
import { orNotFound } from "@/server/pages";
import { myPayments } from "@/server/salary-slip";
import { requirePageUser } from "@/server/session";
import { Header } from "../../header";
import { MyTabs, myTabs } from "../../my-tabs";

/** A worker's paid months (only with the owner's "Can see own salary"; 404 otherwise), newest first. */
export default async function MySalaryPage() {
  const user = await requirePageUser("/my/salary");
  const [plant, paid] = await Promise.all([kit.branding(user.tenantId), orNotFound(myPayments(user))]);
  return (
    <div className="space-y-4">
      <Header user={user} plant={plant} />
      <MyTabs {...await myTabs(user)} current="salary" />
      {paid.length === 0 ? (
        <Card>No paid months yet. A month shows here once the owner marks it paid.</Card>
      ) : (
        <ul className="divide-y divide-slate-100 rounded-2xl border border-slate-200 bg-white">
          {paid.map((p) => (
            <li key={p.month}>
              <a href={`/my/salary/${p.month}`} className="flex min-h-14 items-center justify-between gap-3 px-4 py-2.5">
                <span>
                  <span className="block font-semibold">{fmtMonth(p.month)}</span>
                  <span className="block text-sm text-slate-600">paid {fmtDayLong(p.paidOn).replace(/^\w+, /, "")}</span>
                </span>
                <span className="font-bold whitespace-nowrap">{rupeesText(p.paidPaise)} ›</span>
              </a>
            </li>
          ))}
        </ul>
      )}
      <p className="text-xs text-slate-600">Shown only when the owner allows it, and only for paid months. Questions? Ask the owner.</p>
    </div>
  );
}
