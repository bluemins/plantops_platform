import { redirect } from "next/navigation";
import { Card } from "@plantops/ui";
import { differenceText, KIND_LABEL, paise, PURPOSE_LABEL, signedMoney } from "@/lib/cash";
import { can } from "@/server/access";
import { addDays, cashLists, daySheet, istToday, type EntryView } from "@/server/cash";
import { waitingCount } from "@/server/calls-tab";
import { kit } from "@/server/kit";
import { requirePageUser } from "@/server/session";
import { Header } from "../header";
import { SectionTabs } from "../parts";
import { CancelEntry, CloseDay, EntryButtons, StartCashBook } from "./cash-forms";
import { CashNav, longDay, shortDay } from "./parts";

type Search = Promise<Record<string, string | string[] | undefined>>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

function EntryRow({ e, owner, closed }: { e: EntryView; owner: boolean; closed: boolean }) {
  const title =
    e.kind === "expense" ? `Expense · ${e.category ?? ""}` : e.kind === "staff_out" ? `${e.purpose ? PURPOSE_LABEL[e.purpose] : "Staff cash"} · ${e.person}` : e.kind === "staff_in" ? `Took back · ${e.person}` : KIND_LABEL[e.kind];
  const detail = [e.ref, e.vehicle, e.paid_to, e.note, `by ${e.by}`].filter(Boolean).join(" · ");
  return (
    <li className={`px-4 py-3 ${e.cancelled ? "opacity-60" : ""}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className={`font-semibold break-words ${e.cancelled ? "line-through" : ""}`}>
            {title}
            {e.work_date !== e.cash_date && <span className="ml-2 rounded-md bg-amber-100 px-1.5 py-0.5 text-xs font-semibold text-amber-900">for {shortDay(e.work_date)}</span>}
          </p>
          <p className="text-xs text-slate-500 break-words">{detail}</p>
          {e.cancelled && <p className="text-xs text-red-700">Cancelled by {e.cancelled.by}: {e.cancelled.reason}</p>}
        </div>
        <span className={`shrink-0 font-bold ${e.direction === "in" ? "text-green-700" : "text-red-700"} ${e.cancelled ? "line-through" : ""}`}>
          {e.direction === "in" ? "+" : "−"}
          {signedMoney(paise(e.amount))}
        </span>
      </div>
      {owner && !e.cancelled && <div className="mt-1"><CancelEntry id={e.id} refText={e.ref} closed={closed} /></div>}
    </li>
  );
}

/** The cash book's day sheet (owner, Accounts; support reads): expected cash, today's entries, close the day. */
export default async function CashDayPage({ searchParams }: { searchParams: Search }) {
  const user = await requirePageUser("/cash");
  if (!can(user, "cash_view")) redirect("/");
  const today = istToday();
  const d = one((await searchParams).d);
  const date = /^\d{4}-\d{2}-\d{2}$/.test(d) && d <= today ? d : today;
  const [plant, sheet, lists, waiting] = await Promise.all([kit.branding(user.tenantId), daySheet(user, date, today), cashLists(user), waitingCount(user)]);
  const owner = can(user, "cash_owner");
  const enter = can(user, "cash_enter");

  const tabs = <SectionTabs current="cash" waiting={waiting} bills={can(user, "ledger_view")} purchases={can(user, "purchases_view")} cash calls={can(user, "calls_view")} />;
  if (!sheet.started)
    return (
      <div className="space-y-4">
        <Header user={user} plant={plant} />
        {tabs}
        {owner ? <StartCashBook today={today} /> : <Card><p className="text-sm text-slate-600">The cash book hasn't been started yet. The owner starts it with today&apos;s cash count.</p></Card>}
      </div>
    );

  const ins = sheet.entries.filter((e) => e.direction === "in");
  const outs = sheet.entries.filter((e) => e.direction === "out");
  const closed = sheet.close !== null;
  return (
    <div className="space-y-4">
      <Header user={user} plant={plant} />
      {tabs}
      <CashNav current="day" owner={owner} />

      <nav aria-label="Day" className="flex items-center justify-between gap-2">
        <a href={`/cash?d=${addDays(date, -1)}`} aria-label="Previous day" className="flex min-h-11 min-w-11 items-center justify-center rounded-xl border border-slate-300 bg-white text-lg text-(--brand)">‹</a>
        <div className="text-center">
          <p className="text-lg font-bold">{longDay(date)}</p>
          <p className="text-xs text-slate-500">{date === today ? "Today" : <a href="/cash" className="font-semibold text-(--brand)">Go to today</a>}</p>
        </div>
        {date < today ? (
          <a href={`/cash?d=${addDays(date, 1)}`} aria-label="Next day" className="flex min-h-11 min-w-11 items-center justify-center rounded-xl border border-slate-300 bg-white text-lg text-(--brand)">›</a>
        ) : (
          <span className="min-w-11" />
        )}
      </nav>

      {sheet.before_start ? (
        <Card><p className="text-sm text-slate-600">The cash book started on {longDay(sheet.first)}. Nothing before that.</p></Card>
      ) : (
        <>
          <Card className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <p className="text-sm font-medium text-slate-600">{closed ? "Cash in hand (counted)" : "Expected cash in hand"}</p>
              {closed ? (
                <span className="rounded-full bg-green-100 px-3 py-1 text-xs font-semibold text-green-800">{sheet.close!.opening ? "Opening balance" : `Closed by ${sheet.close!.by}`}</span>
              ) : (
                <span className="rounded-full bg-amber-100 px-3 py-1 text-xs font-semibold text-amber-900">Not closed yet</span>
              )}
            </div>
            <p className="text-4xl font-bold tracking-tight">{signedMoney(paise(closed ? sheet.close!.counted : (sheet.expected ?? "0")))}</p>
            {sheet.opening !== null && !sheet.close?.opening && (
              <div className="grid grid-cols-3 gap-2 text-sm">
                <div className="rounded-xl bg-slate-100 p-2"><p className="text-slate-600">Opening</p><p className="font-semibold">{signedMoney(paise(sheet.opening))}</p></div>
                <div className="rounded-xl bg-green-50 p-2"><p className="text-green-800">In</p><p className="font-semibold text-green-700">+{signedMoney(paise(sheet.in))}</p></div>
                <div className="rounded-xl bg-red-50 p-2"><p className="text-red-800">Out</p><p className="font-semibold text-red-700">−{signedMoney(paise(sheet.out))}</p></div>
              </div>
            )}
            {sheet.opening_from && !sheet.close?.opening && (
              <p className="text-xs text-slate-500">
                Opening = closed {shortDay(sheet.opening_from)}.
                {sheet.earlier_days.length > 0 && <> Includes {sheet.earlier_days.map(shortDay).join(", ")} (not closed on their own).</>}
              </p>
            )}
            {closed && !sheet.close!.opening && (
              <p className={`text-sm font-semibold ${paise(sheet.close!.difference) === 0n ? "text-green-700" : "text-red-700"}`}>
                Expected {signedMoney(paise(sheet.close!.expected))} · {differenceText(paise(sheet.close!.difference))}
                {sheet.close!.reason ? ` · ${sheet.close!.reason}` : ""}
              </p>
            )}
            {sheet.live_difference !== null && sheet.close && sheet.live_difference !== sheet.close.difference && (
              <p className="text-xs text-amber-800">An entry was cancelled after the close: the count is now {differenceText(paise(sheet.live_difference)).toLowerCase()}.</p>
            )}
          </Card>

          {enter && sheet.can_enter && <EntryButtons date={date} lists={lists} />}
          {enter && !sheet.can_enter && !closed && date < today && <p className="text-sm text-slate-500">Entries go on days after the last close, at most 7 days back.</p>}
          {sheet.can_close && can(user, "cash_close") && sheet.expected !== null && <CloseDay date={date} expected={sheet.expected} fixing={false} />}
          {closed && sheet.can_fix_close && owner && <CloseDay date={date} expected={sheet.close!.counted} fixing />}

          <section className="space-y-2">
            <h2 className="text-xs font-bold tracking-wide text-slate-500 uppercase">Money in · {signedMoney(ins.filter((e) => !e.cancelled).reduce((s, e) => s + paise(e.amount), 0n))}</h2>
            <ul className="divide-y divide-slate-100 rounded-2xl border border-slate-200 bg-white">
              {ins.length === 0 && <li className="px-4 py-3 text-sm text-slate-500">Nothing yet.</li>}
              {ins.map((e) => <EntryRow key={e.id} e={e} owner={owner} closed={closed} />)}
            </ul>
          </section>
          <section className="space-y-2">
            <h2 className="text-xs font-bold tracking-wide text-slate-500 uppercase">Money out · {signedMoney(outs.filter((e) => !e.cancelled).reduce((s, e) => s + paise(e.amount), 0n))}</h2>
            <ul className="divide-y divide-slate-100 rounded-2xl border border-slate-200 bg-white">
              {outs.length === 0 && <li className="px-4 py-3 text-sm text-slate-500">Nothing yet.</li>}
              {outs.map((e) => <EntryRow key={e.id} e={e} owner={owner} closed={closed} />)}
            </ul>
          </section>

          {sheet.close_history.length > 1 && (
            <section className="space-y-1 text-sm">
              <h2 className="text-xs font-bold tracking-wide text-slate-500 uppercase">Close history</h2>
              {sheet.close_history.map((h) => (
                <p key={h.version} className="text-slate-600">v{h.version}: {signedMoney(paise(h.counted))} by {h.by}{h.reason ? ` · ${h.reason}` : ""}</p>
              ))}
            </section>
          )}
          <p className="text-center text-xs text-slate-500">A wrong entry: the owner cancels it with a reason. Nothing is ever deleted.</p>
        </>
      )}
    </div>
  );
}
