import { redirect } from "next/navigation";
import { Card } from "@plantops/ui";
import { paise, signedMoney } from "@/lib/cash";
import { can } from "@/server/access";
import { waitingCount } from "@/server/calls-tab";
import { collectionsList } from "@/server/collections";
import { creditList } from "@/server/van";
import { kit } from "@/server/kit";
import { requirePageUser } from "@/server/session";
import { Header } from "../../header";
import { SectionTabs } from "../../parts";
import { PostActions } from "../collect-forms";
import { CreditActions } from "../van/van-parts";
import { CashNav, shortDay } from "../parts";

type Search = Promise<Record<string, string | string[] | undefined>>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";
const rs = (s: string) => signedMoney(paise(s));

/**
 * Cash → To post: collection lines waiting to go onto customers' accounts (owner, Accounts post; support reads). A
 * collection never changes bills by itself (owner, 2026-11-11): posting makes the payment, oldest bills first.
 */
export default async function ToPostPage({ searchParams }: { searchParams: Search }) {
  const user = await requirePageUser("/cash/post");
  if (!can(user, "cash_view")) redirect("/");
  const show = one((await searchParams).show) === "all" ? "all" : "waiting";
  const [plant, list, credits, waiting] = await Promise.all([kit.branding(user.tenantId), collectionsList(user, show), creditList(user, show), waitingCount(user)]);
  const post = can(user, "collection_post");
  return (
    <div className="space-y-4">
      <Header user={user} plant={plant} />
      <SectionTabs current="cash" waiting={waiting} bills={can(user, "ledger_view")} purchases={can(user, "purchases_view")} cash calls={can(user, "calls_view")} />
      <CashNav current="post" owner={can(user, "cash_owner")} toPost={list.waiting.count + credits.waiting.count} />

      <Card className="space-y-1">
        <p className="text-sm font-medium text-slate-600">Collected, not posted yet</p>
        <p className="text-4xl font-bold tracking-tight">{rs(list.waiting.amount)}</p>
        <p className="text-sm text-slate-600">{list.waiting.count} line{list.waiting.count === 1 ? "" : "s"}. Customers&apos; bills change only when a line is posted.</p>
      </Card>

      {credits.waiting.count > 0 && (
        <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">
          Also {credits.waiting.count} &ldquo;not paid&rdquo; line{credits.waiting.count === 1 ? "" : "s"} from van reports ({rs(credits.waiting.amount)}) to bill, below.
        </p>
      )}

      <nav className="flex gap-4 text-sm font-semibold">
        {show === "waiting" ? <span className="border-b-2 border-(--brand) pb-1">Waiting</span> : <a href="/cash/post" className="pb-1 text-slate-600">Waiting</a>}
        {show === "all" ? <span className="border-b-2 border-(--brand) pb-1">All</span> : <a href="/cash/post?show=all" className="pb-1 text-slate-600">All</a>}
      </nav>

      {list.lines.length === 0 ? (
        <Card><p className="text-sm text-slate-600">{show === "waiting" ? "Nothing waiting. Collections saved on the day sheet show here until they are posted." : "No collections yet."}</p></Card>
      ) : (
        <ul className="space-y-2">
          {list.lines.map((l) => (
            <li key={l.id} className="space-y-2 rounded-2xl border border-slate-200 bg-white p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <a href={`/customers/${l.customer.id}`} className="font-semibold break-words text-(--brand)">{l.customer.name}</a>
                  <p className="text-xs text-slate-500 break-words">
                    {[shortDay(l.work_date), l.mode === "cash" ? `cash · ${l.entry}` : "online", `by ${l.by}`, l.note].filter(Boolean).join(" · ")}
                  </p>
                </div>
                <span className="shrink-0 font-bold">{rs(l.amount)}</span>
              </div>
              {l.status === "posted" && <p className="text-sm text-green-800">Posted: {l.payment!.number}{l.payment!.customer !== l.customer.name ? ` on ${l.payment!.customer}` : ""}</p>}
              {l.status === "turned_down" && <p className="text-sm text-slate-600">Turned down by {l.turned_down!.by}: {l.turned_down!.reason}</p>}
              {l.status === "void" && <p className="text-sm text-slate-600">Cash book entry {l.entry} was cancelled.</p>}
              {l.status === "waiting" && post && <PostActions id={l.id} customer={l.customer.name} amount={l.amount} />}
            </li>
          ))}
        </ul>
      )}

      {credits.lines.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-xs font-bold tracking-wide text-slate-500 uppercase">Not paid on van trips: to bill · {rs(credits.waiting.amount)}</h2>
          <ul className="space-y-2">
            {credits.lines.map((c) => (
              <li key={c.id} className="space-y-2 rounded-2xl border border-slate-200 bg-white p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <a href={`/customers/${c.customer.id}`} className="font-semibold break-words text-(--brand)">{c.customer.name}</a>
                    <p className="text-xs text-slate-500 break-words">
                      {[shortDay(c.work_date), `${c.vehicle} · ${c.person}`, <a key="r" href={`/cash/van/${c.report_id}`} className="text-(--brand)">{c.entry}</a>, c.note].filter(Boolean).map((x, i) => <span key={i}>{i ? " · " : ""}{x}</span>)}
                    </p>
                  </div>
                  <span className="shrink-0 font-bold">{rs(c.amount)}</span>
                </div>
                {c.status === "billed" && <p className="text-sm text-green-800">Billed: {c.bill!.number}{c.bill!.customer !== c.customer.name ? ` on ${c.bill!.customer}` : ""}</p>}
                {c.status === "turned_down" && <p className="text-sm text-slate-600">Turned down by {c.turned_down!.by}: {c.turned_down!.reason}</p>}
                {c.status === "void" && <p className="text-sm text-slate-600">Cash book entry {c.entry} was cancelled.</p>}
                {c.status === "waiting" && post && <CreditActions id={c.id} customer={c.customer.name} amount={c.amount} />}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
