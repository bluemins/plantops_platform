import { redirect } from "next/navigation";
import { Card } from "@plantops/ui";
import { paise, signedMoney } from "@/lib/cash";
import { can } from "@/server/access";
import { cashLists, istToday } from "@/server/cash";
import { waitingCount } from "@/server/calls-tab";
import { waitingToPost } from "@/server/collections";
import { kit } from "@/server/kit";
import { requirePageUser } from "@/server/session";
import { openWithStaff } from "@/server/staff-cash";
import { Header } from "../../header";
import { SectionTabs } from "../../parts";
import { attendanceText, SendAgain } from "../cash-forms";
import { CashNav, shortDay } from "../parts";
import { CancelSpend, SpendForm } from "./staff-forms";

const M = (s: string) => signedMoney(paise(s));
const KIND = { given: "Given", back: "Brought back", spent: "Spent" } as const;

/**
 * With staff (owner, Accounts; support reads): cash given for plant spending that is still with a person (given −
 * brought back − spent), with "+ Spent" to record what they paid out of it; and advances against salary still open,
 * with whether each is in Attendance.
 */
export default async function CashStaffPage() {
  const user = await requirePageUser("/cash/staff");
  if (!can(user, "cash_view")) redirect("/");
  const [plant, rows, lists, waiting, toPost] = await Promise.all([kit.branding(user.tenantId), openWithStaff(user), cashLists(user), waitingCount(user), waitingToPost(user)]);
  const owner = can(user, "cash_owner");
  const enter = can(user, "cash_enter");
  const cats = lists.categories.filter((c) => c.active).map((c) => ({ id: c.id, name: c.name }));
  const plant_ = rows.filter((r) => r.lines.length);
  const advances = rows.filter((r) => r.advances.length);
  const totalOpen = plant_.reduce((s, r) => s + paise(r.open), 0n);
  return (
    <div className="space-y-4">
      <Header user={user} plant={plant} />
      <SectionTabs current="cash" waiting={waiting} bills={can(user, "ledger_view")} purchases={can(user, "purchases_view")} cash calls={can(user, "calls_view")} />
      <CashNav current="staff" owner={owner} toPost={toPost} />

      <Card className="space-y-1">
        <p className="text-sm font-medium text-slate-600">Cash with staff for plant spending</p>
        <p className="text-3xl font-bold tracking-tight">{signedMoney(totalOpen)}</p>
        <p className="text-xs text-slate-500">Given − brought back − spent. &quot;Spent&quot; doesn&apos;t change the cash box: the cash left the box when it was given.</p>
      </Card>

      <section className="space-y-2">
        <h2 className="text-xs font-bold tracking-wide text-slate-500 uppercase">Plant spending</h2>
        {plant_.length === 0 && <p className="text-sm text-slate-500">Nobody has cash given for plant spending yet. Enter it on the day sheet: + Staff cash → For plant spending.</p>}
        {plant_.map((r) => (
          <details key={r.key} className="rounded-2xl border border-slate-200 bg-white" open={paise(r.open) > 0n}>
            <summary className="flex cursor-pointer items-center justify-between gap-3 px-4 py-3">
              <span className="min-w-0 font-semibold break-words">{r.person}</span>
              <span className={`shrink-0 font-bold ${paise(r.open) > 0n ? "text-amber-800" : "text-slate-500"}`}>{M(r.open)} open</span>
            </summary>
            <div className="space-y-3 border-t border-slate-100 px-4 py-3">
              <p className="text-xs text-slate-600">Given {M(r.given)} · brought back {M(r.back)} · spent {M(r.spent)}</p>
              <ul className="divide-y divide-slate-100 text-sm">
                {r.lines.map((l) => (
                  <li key={`${l.kind}:${l.id}`} className={`py-2 ${l.cancelled ? "opacity-60" : ""}`}>
                    <div className="flex items-start justify-between gap-3">
                      <span className={`min-w-0 break-words ${l.cancelled ? "line-through" : ""}`}>
                        <b>{KIND[l.kind]}</b> {shortDay(l.date)}{l.ref ? ` · ${l.ref}` : ""}{l.what ? ` · ${l.what}` : ""} <span className="text-xs text-slate-500">by {l.by}</span>
                      </span>
                      <span className={`shrink-0 font-semibold ${l.kind === "given" ? "text-red-700" : "text-green-700"}`}>{l.kind === "given" ? "" : "−"}{M(l.amount)}</span>
                    </div>
                    {l.cancelled && <p className="text-xs text-red-700">Cancelled by {l.cancelled.by}: {l.cancelled.reason}</p>}
                    {owner && l.kind === "spent" && !l.cancelled && <CancelSpend id={l.id} />}
                  </li>
                ))}
              </ul>
              {enter && paise(r.open) > 0n && <SpendForm personKey={r.key} person={r.person} open={r.open} today={istToday()} categories={cats} />}
            </div>
          </details>
        ))}
      </section>

      <section className="space-y-2">
        <h2 className="text-xs font-bold tracking-wide text-slate-500 uppercase">Advances against salary (still open)</h2>
        {advances.length === 0 && <p className="text-sm text-slate-500">No open advances from the cash book.</p>}
        <ul className="divide-y divide-slate-100 rounded-2xl border border-slate-200 bg-white">
          {advances.flatMap((r) =>
            r.advances.map((a) => (
              <li key={a.id} className="px-4 py-3">
                <div className="flex items-start justify-between gap-3">
                  <span className="min-w-0 break-words"><b>{r.person}</b> · {a.ref} · {shortDay(a.date)}</span>
                  <span className="shrink-0 font-semibold">{M(a.left)}{a.left !== a.amount ? <span className="text-xs font-normal text-slate-500"> of {M(a.amount)}</span> : null}</span>
                </div>
                <p className={`text-xs font-semibold ${!a.attendance ? "text-slate-500" : a.attendance.status === "sent" ? "text-green-700" : a.attendance.status === "refused" ? "text-red-700" : "text-amber-800"}`}>
                  {a.attendance ? attendanceText(a.attendance as never) : "Not sent to Attendance (entered before the link)"}
                  {enter && a.attendance && a.attendance.status !== "sent" && <span className="ml-2"><SendAgain id={a.id} /></span>}
                </p>
              </li>
            )),
          )}
        </ul>
        <p className="text-xs text-slate-500">Recovered from salary in Attendance. Cash brought back: day sheet → + Staff cash → Took back → For an advance.</p>
      </section>
    </div>
  );
}
