import { redirect } from "next/navigation";
import { Card } from "@plantops/ui";
import { paise, signedMoney } from "@/lib/cash";
import { can } from "@/server/access";
import { monthHistory } from "@/server/jar-month";
import { kit } from "@/server/kit";
import { requirePageUser } from "@/server/session";
import { Header } from "../../../header";
import { BackLink } from "../../../parts";
import { MonthUpdate, UndoMonth } from "./month-update";

const rs = (s: string) => signedMoney(paise(s));
const monthName = (m: string) => new Date(`${m}-01T00:00:00Z`).toLocaleDateString("en-IN", { month: "long", year: "numeric", timeZone: "UTC" });

/** Owner only: the monthly 20 L "Remaining" import (cash book step C5) and the month updates so far. */
export default async function JarMonthPage() {
  const user = await requirePageUser("/cash/jar/month");
  if (!can(user, "jar_import")) redirect("/cash/jar");
  const [plant, history] = await Promise.all([kit.branding(user.tenantId), monthHistory(user)]);
  const now = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date()).slice(0, 7);
  const d = new Date(`${now}-01T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() - 1);
  const last = d.toISOString().slice(0, 7);
  return (
    <div className="space-y-5">
      <Header user={user} plant={plant} />
      <BackLink href="/cash/jar">← 20 L customers</BackLink>
      <h1 className="text-2xl font-bold">20 L month update</h1>
      <MonthUpdate defaultMonth={last} maxMonth={now} />
      {history.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-xs font-bold tracking-wide text-slate-500 uppercase">Months brought in</h2>
          <ul className="divide-y divide-slate-100 rounded-2xl border border-slate-200 bg-white">
            {history.map((h) => (
              <li key={h.id} className="space-y-1 px-4 py-3">
                <div className="flex items-start justify-between gap-3">
                  <a href={`/cash/jar/month/${h.id}`} className="min-w-0 font-semibold break-words text-(--brand)">{monthName(h.month)}</a>
                  <span className="shrink-0 font-semibold">{h.undone ? <span className="text-slate-500 line-through">{rs(h.total)}</span> : rs(h.total)}</span>
                </div>
                <p className="text-xs text-slate-500 break-words">
                  {h.counts.billed ?? 0} billed · {h.counts.matches ?? 0} match · {h.counts.flagged ?? 0} flagged · {h.counts.left ?? 0} left for you · {h.file_name} · {h.by}
                  {h.undone ? " · undone" : ""}
                </p>
                {h.live > 0 && <UndoMonth month={h.month} label={monthName(h.month)} />}
              </li>
            ))}
          </ul>
        </section>
      )}
      <Card>
        <p className="text-xs text-slate-500">
          The other 20 L app also records the payments collected in PlantOps, so its Remaining is the true balance. A customer who also buys boxes, or shares
          the Sales customer with another 20 L ref, is never billed automatically: type that month&apos;s amount for them, or leave them.
        </p>
      </Card>
    </div>
  );
}
