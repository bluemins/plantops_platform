import { redirect } from "next/navigation";
import { can } from "@/server/access";
import { pollsPage } from "@/server/drop/polls";
import { kit } from "@/server/kit";
import { requirePageUser } from "@/server/session";
import { Header } from "../../../header";
import { BackLink } from "../../../parts";
import { NewPoll } from "./new-poll";

const when = (iso: string) => new Date(iso).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit", timeZone: "Asia/Kolkata" });
const STATE = { open: "Open", scheduled: "Not open yet", closed: "Closed" } as const;

/** Owner (support reads): the Drop polls, newest first, and New poll. */
export default async function PollsPage() {
  const user = await requirePageUser("/customers/drop/polls");
  if (!can(user, "drop_polls_view")) redirect("/customers");
  const [plant, data] = await Promise.all([kit.branding(user.tenantId), pollsPage(user)]);
  return (
    <div className="space-y-4 pb-8">
      <Header user={user} plant={plant} />
      <BackLink href="/customers">← Customers</BackLink>
      <h1 className="text-2xl font-bold">Drop polls</h1>
      <p className="text-sm text-slate-600">One or two tap questions a week for the shops in the Drop app. Shops earn poll points; only you see the answers.</p>
      {!data.set_up && <p className="text-sm text-slate-600">The Drop app isn&apos;t set up for this plant yet.</p>}
      {data.set_up && can(user, "drop_polls") && <NewPoll brands={data.brands} main={data.main_brand!} today={data.today} />}
      {data.polls.length === 0 ? (
        <p className="rounded-xl border border-slate-200 bg-white p-4 text-sm text-slate-600">No poll yet.</p>
      ) : (
        <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200 bg-white">
          {data.polls.map((p) => (
            <li key={p.id}>
              <a href={`/customers/drop/polls/${p.id}`} className="flex items-start justify-between gap-3 p-3 hover:bg-slate-50">
                <span className="min-w-0">
                  <span className="block font-semibold break-words">{p.question}</span>
                  <span className="block text-xs text-slate-600">
                    {when(p.opens_at)} – {when(p.closes_at)} · {p.brands.join(", ")}
                  </span>
                </span>
                <span className="shrink-0 text-right text-sm">
                  <span className={`block font-semibold ${p.state === "open" ? "text-green-800" : "text-slate-600"}`}>{STATE[p.state]}</span>
                  <span className="block text-slate-600">{p.answers} {p.answers === 1 ? "answer" : "answers"}</span>
                </span>
              </a>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
