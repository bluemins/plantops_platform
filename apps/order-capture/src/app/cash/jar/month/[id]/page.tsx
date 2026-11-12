import { notFound, redirect } from "next/navigation";
import { paise, signedMoney } from "@/lib/cash";
import { can } from "@/server/access";
import { monthLines } from "@/server/jar-month";
import { kit } from "@/server/kit";
import { requirePageUser } from "@/server/session";
import { Header } from "../../../../header";
import { BackLink } from "../../../../parts";

const rs = (s: string) => signedMoney(paise(s));
const monthName = (m: string) => new Date(`${m}-01T00:00:00Z`).toLocaleDateString("en-IN", { month: "long", year: "numeric", timeZone: "UTC" });
const WHAT: Record<string, string> = { billed: "Billed", matches: "Matches", flagged: "Flagged", left: "Left for you" };
const WHY: Record<string, string> = { lower: "the report shows less than PlantOps", negative: "the report shows a negative (paid ahead)", mixed: "also buys boxes / shares the customer", typed: "your own amount" };
type Params = Promise<{ id: string }>;

/** Owner: one month update, customer by customer (flagged and left ones first). */
export default async function JarMonthLinesPage({ params }: { params: Params }) {
  const user = await requirePageUser("/cash/jar/month");
  if (!can(user, "jar_import")) redirect("/cash/jar");
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const [plant, m] = await Promise.all([kit.branding(user.tenantId), monthLines(user, id)]);
  return (
    <div className="space-y-4">
      <Header user={user} plant={plant} />
      <BackLink href="/cash/jar/month">← Month updates</BackLink>
      <h1 className="text-2xl font-bold">20 L · {monthName(m.month)}</h1>
      <p className="text-sm text-slate-600">{m.file} · by {m.by}</p>
      <ul className="divide-y divide-slate-100 rounded-2xl border border-slate-200 bg-white">
        {m.lines.map((l) => (
          <li key={l.ref} className="px-4 py-3">
            <div className="flex items-start justify-between gap-3">
              <a href={`/customers/${l.customer_id}`} className="min-w-0 font-semibold break-words text-(--brand)">{l.name}</a>
              <span className={`shrink-0 text-sm font-semibold ${l.action === "flagged" ? "text-red-700" : l.action === "left" ? "text-amber-800" : l.action === "billed" ? "text-slate-900" : "text-green-700"}`}>
                {WHAT[l.action]}{l.billed ? ` ${rs(l.billed)}` : ""}
              </span>
            </div>
            <p className="text-xs text-slate-500 break-words">
              ref {l.ref} · report {rs(l.sheet)} · PlantOps {rs(l.plantops)}{l.reason ? ` · ${WHY[l.reason]}` : ""}
              {l.number && <> · <a href={`/bills/${l.bill_id}`} className={`font-semibold text-(--brand) ${l.cancelled ? "line-through" : ""}`}>{l.number}</a>{l.cancelled ? " (cancelled)" : ""}</>}
            </p>
          </li>
        ))}
      </ul>
    </div>
  );
}
