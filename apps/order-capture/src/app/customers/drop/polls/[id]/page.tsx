import { notFound, redirect } from "next/navigation";
import { SIZE_LABEL } from "@/lib/polls";
import { can } from "@/server/access";
import { pollDetail } from "@/server/drop/polls";
import { kit } from "@/server/kit";
import { orNotFound } from "@/server/pages";
import { requirePageUser } from "@/server/session";
import { Header } from "../../../../header";
import { BackLink } from "../../../../parts";
import { ClosePoll } from "./close";

type Params = Promise<{ id: string }>;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const when = (iso: string) => new Date(iso).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit", timeZone: "Asia/Kolkata" });
// a poll closes at midnight after its last day: show that last minute ("15 Nov, 11:59 pm"), not "16 Nov, 12:00 am"
const until = (iso: string) => when(new Date(Date.parse(iso) - 60_000).toISOString());
const pct = (n: number, total: number) => (total ? Math.round((n * 100) / total) : 0);

function Bars({ labels, counts, total }: { labels: string[]; counts: number[]; total: number }) {
  return (
    <ul className="space-y-2">
      {labels.map((l, i) => (
        <li key={l} className="text-sm">
          <div className="flex justify-between gap-3">
            <span className="break-words">{l}</span>
            <span className="shrink-0 font-semibold">
              {counts[i]} · {pct(counts[i]!, total)}%
            </span>
          </div>
          <div className="mt-1 h-2 rounded-full bg-slate-100">
            <div className="h-2 rounded-full bg-(--brand)" style={{ width: `${pct(counts[i]!, total)}%` }} />
          </div>
        </li>
      ))}
    </ul>
  );
}

/** Owner (support reads): a poll's answers, split by place and by buying size; CSV with each shop's real boxes. */
export default async function PollPage({ params }: { params: Params }) {
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const user = await requirePageUser(`/customers/drop/polls/${id}`);
  if (!can(user, "drop_polls_view")) redirect("/customers");
  const [plant, p] = await Promise.all([kit.branding(user.tenantId), orNotFound(pollDetail(user, id))]);
  const r = p.results;
  const short = (labels: string[]) => labels.map((l) => (l.length > 14 ? `${l.slice(0, 13)}…` : l));
  return (
    <div className="space-y-4 pb-8">
      <Header user={user} plant={plant} />
      <BackLink href="/customers/drop/polls">← Drop polls</BackLink>
      <h1 className="text-xl font-bold break-words">{p.question}</h1>
      <p className="text-sm text-slate-600">
        {p.state === "open" ? "Open" : p.state === "scheduled" ? "Not open yet" : "Closed"} · {when(p.opens_at)} – {until(p.closes_at)} · {p.brands.join(", ")} · by {p.created_by}
        {p.closed_early_by ? ` · closed early by ${p.closed_early_by}` : ""}
      </p>
      <section className="space-y-3 rounded-2xl border border-slate-200 bg-white p-4">
        <h2 className="font-semibold">{r.total} {r.total === 1 ? "answer" : "answers"}</h2>
        <Bars labels={r.labels} counts={r.counts} total={r.total} />
        {r.others.length > 0 && (
          <div className="space-y-1 border-t border-slate-100 pt-2 text-sm">
            <p className="font-semibold">&quot;Other&quot; answers</p>
            {r.others.map((o, i) => (
              <p key={i} className="break-words text-slate-700">“{o}”</p>
            ))}
          </div>
        )}
      </section>
      {r.total > 0 && (
        <>
          <section className="space-y-2">
            <h2 className="text-sm font-semibold">By buying size (boxes {p.window.from} to {p.window.to})</h2>
            <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-slate-500">
                    <th className="p-2">Shops</th>
                    <th className="p-2 text-right">Answers</th>
                    {short(r.labels).map((l) => <th key={l} className="p-2 text-right">{l}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {r.by_size.map((s) => (
                    <tr key={s.size} className="border-t border-slate-100">
                      <td className="p-2">{SIZE_LABEL[s.size]}</td>
                      <td className="p-2 text-right">{s.total}</td>
                      {s.counts.map((c, i) => <td key={i} className="p-2 text-right">{c}</td>)}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
          <section className="space-y-2">
            <h2 className="text-sm font-semibold">By place</h2>
            <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-slate-500">
                    <th className="p-2">Place</th>
                    <th className="p-2 text-right">Answers</th>
                    {short(r.labels).map((l) => <th key={l} className="p-2 text-right">{l}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {r.by_place.map((s) => (
                    <tr key={s.place} className="border-t border-slate-100">
                      <td className="p-2">{s.place}</td>
                      <td className="p-2 text-right">{s.total}</td>
                      {s.counts.map((c, i) => <td key={i} className="p-2 text-right">{c}</td>)}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}
      {can(user, "drop_polls") && (
        <div className="space-y-3">
          {r.total > 0 && (
            <a href={`/api/drop/polls/${p.id}/csv`} className="flex min-h-12 items-center justify-center rounded-xl border border-slate-300 bg-white font-semibold text-(--brand)">
              Download CSV (answers + real boxes)
            </a>
          )}
          {p.state !== "closed" && <ClosePoll id={p.id} />}
        </div>
      )}
    </div>
  );
}
