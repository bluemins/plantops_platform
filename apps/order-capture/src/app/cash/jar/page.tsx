import { redirect } from "next/navigation";
import { Card } from "@plantops/ui";
import { paise, signedMoney } from "@/lib/cash";
import { can } from "@/server/access";
import { waitingCount } from "@/server/calls-tab";
import { jarList, waitingToPost } from "@/server/collections";
import { kit } from "@/server/kit";
import { requirePageUser } from "@/server/session";
import { Header } from "../../header";
import { SectionTabs } from "../../parts";
import { CashNav, shortDay } from "../parts";

type Search = Promise<Record<string, string | string[] | undefined>>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";
const rs = (s: string) => signedMoney(paise(s));

/** Cash → 20 L: the 20 L customers with what they owe now and what waits to be posted (owner, Accounts; support reads). */
export default async function JarPage({ searchParams }: { searchParams: Search }) {
  const user = await requirePageUser("/cash/jar");
  if (!can(user, "cash_view")) redirect("/");
  const q = one((await searchParams).q);
  const [plant, list, waiting, toPost] = await Promise.all([kit.branding(user.tenantId), jarList(user, q), waitingCount(user), waitingToPost(user)]);
  const owner = can(user, "cash_owner");
  return (
    <div className="space-y-4">
      <Header user={user} plant={plant} />
      <SectionTabs current="cash" waiting={waiting} bills={can(user, "ledger_view")} purchases={can(user, "purchases_view")} cash calls={can(user, "calls_view")} />
      <CashNav current="jar" owner={owner} toPost={toPost} />

      <Card className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <p className="text-sm font-medium text-slate-600">20 L customers owe</p>
          {can(user, "jar_import") && <a href="/cash/jar/import" className="text-sm font-semibold text-(--brand)">Import list</a>}
        </div>
        <p className="text-4xl font-bold tracking-tight">{rs(list.totals.due)}</p>
        <p className="text-sm text-slate-600">
          {list.totals.count} customers
          {paise(list.totals.waiting) > 0n && <> · {rs(list.totals.waiting)} collected, <a href="/cash/post" className="font-semibold text-(--brand)">not posted yet</a></>}
        </p>
        <p className="text-xs text-slate-500">Only collections lower what they owe. New 20 L deliveries are still billed in the other app (monthly 20 L bills come later).</p>
      </Card>

      <form className="flex gap-2">
        <input name="q" defaultValue={q} className="min-h-12 w-full min-w-0 rounded-xl border border-slate-300 bg-white px-3 text-base" placeholder="Name, ref or mobile" />
        <button className="min-h-12 rounded-xl border border-slate-300 bg-white px-4 font-semibold text-(--brand)">Find</button>
      </form>

      {list.customers.length === 0 ? (
        <Card>
          <p className="text-sm text-slate-600">{q ? "No 20 L customer matches." : can(user, "jar_import") ? "No 20 L customers yet. Import the 20 L pending report to start." : "No 20 L customers yet. The owner imports them."}</p>
        </Card>
      ) : (
        <ul className="divide-y divide-slate-100 rounded-2xl border border-slate-200 bg-white">
          {list.customers.map((c) => (
            <li key={c.customer_id} className="flex items-start justify-between gap-3 px-4 py-3">
              <div className="min-w-0">
                <a href={`/customers/${c.customer_id}`} className="font-semibold break-words text-(--brand)">{c.name}</a>
                <p className="text-xs text-slate-500 break-words">
                  {[`ref ${c.ref}`, c.group_name, c.pref, c.last_paid ? `paid ${shortDay(c.last_paid)}` : null].filter(Boolean).join(" · ")}
                </p>
                {paise(c.waiting) > 0n && <p className="text-xs font-semibold text-amber-800">{rs(c.waiting)} collected, not posted</p>}
              </div>
              <span className={`shrink-0 font-bold ${paise(c.due) > 0n ? "text-red-700" : "text-green-700"}`}>{paise(c.due) > 0n ? rs(c.due) : "Paid up"}</span>
            </li>
          ))}
        </ul>
      )}
      {list.imports.length > 0 && (
        <p className="text-xs text-slate-500">
          Imported: {list.imports.map((i) => `${i.file} (${shortDay(i.at.slice(0, 10))}, ${i.by}, ${rs(i.total)})`).join("; ")}
        </p>
      )}
    </div>
  );
}
