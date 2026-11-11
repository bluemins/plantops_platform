import { redirect } from "next/navigation";
import { Card } from "@plantops/ui";
import { differenceText, paise, PURPOSE_LABEL, signedMoney } from "@/lib/cash";
import { can } from "@/server/access";
import { cashBook, istToday } from "@/server/cash";
import { waitingCount } from "@/server/calls-tab";
import { kit } from "@/server/kit";
import { requirePageUser } from "@/server/session";
import { Header } from "../../header";
import { SectionTabs } from "../../parts";
import { CashNav, shortDay } from "../parts";

type Search = Promise<Record<string, string | string[] | undefined>>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";
const M = (s: string) => signedMoney(paise(s));
const monthName = (m: string) => new Date(`${m}-01T00:00:00Z`).toLocaleDateString("en-IN", { month: "long", year: "numeric", timeZone: "UTC" });
const shift = (m: string, n: number) => {
  const d = new Date(`${m}-01T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + n);
  return d.toISOString().slice(0, 7);
};

/** The cash book, a month at a time (owner, Accounts; support reads): each day's opening, in, out, expected, counted. */
export default async function CashBookPage({ searchParams }: { searchParams: Search }) {
  const user = await requirePageUser("/cash/book");
  if (!can(user, "cash_view")) redirect("/");
  const now = istToday().slice(0, 7);
  const m = one((await searchParams).m);
  const month = /^\d{4}-\d{2}$/.test(m) && m <= now ? m : now;
  const [plant, book, waiting] = await Promise.all([kit.branding(user.tenantId), cashBook(user, month), waitingCount(user)]);
  const last = book.days.at(-1);
  return (
    <div className="space-y-4">
      <Header user={user} plant={plant} />
      <SectionTabs current="cash" waiting={waiting} bills={can(user, "ledger_view")} purchases={can(user, "purchases_view")} cash calls={can(user, "calls_view")} />
      <CashNav current="book" owner={can(user, "cash_owner")} />

      <nav aria-label="Month" className="flex items-center justify-between gap-2">
        <a href={`/cash/book?m=${shift(month, -1)}`} aria-label="Previous month" className="flex min-h-11 min-w-11 items-center justify-center rounded-xl border border-slate-300 bg-white text-lg text-(--brand)">‹</a>
        <p className="text-lg font-bold">{monthName(month)}</p>
        {month < now ? (
          <a href={`/cash/book?m=${shift(month, 1)}`} aria-label="Next month" className="flex min-h-11 min-w-11 items-center justify-center rounded-xl border border-slate-300 bg-white text-lg text-(--brand)">›</a>
        ) : (
          <span className="min-w-11" />
        )}
      </nav>

      {!book.started ? (
        <Card><p className="text-sm text-slate-600">The cash book hasn&apos;t been started yet. <a href="/cash" className="font-semibold text-(--brand)">Start it →</a></p></Card>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Card>
              <p className="text-xs text-slate-500">Cash at the end of the month so far</p>
              <p className="text-2xl font-bold">{last ? M(last.counted ?? last.expected) : "—"}</p>
              {last && <p className="text-xs text-slate-500">{last.counted !== null ? `Counted ${shortDay(last.date)}` : `Expected ${shortDay(last.date)} (not closed)`}</p>}
            </Card>
            <Card>
              <p className="text-xs text-slate-500">Money in / out</p>
              <p className="text-lg font-bold text-green-700">+{M(book.totals!.in)}</p>
              <p className="text-lg font-bold text-red-700">−{M(book.totals!.out)}</p>
              <p className="text-xs text-slate-500">{book.totals!.entries} entries</p>
            </Card>
            <Card>
              <p className="text-xs text-slate-500">Expenses</p>
              <p className="text-2xl font-bold">{M(book.totals!.expenses)}</p>
              <p className="text-xs text-slate-500">{book.categories[0] ? `Most: ${book.categories[0].name}` : "None"}</p>
            </Card>
            <Card className={book.totals!.late ? "bg-amber-50" : ""}>
              <p className="text-xs text-slate-500">Entered late</p>
              <p className="text-2xl font-bold">{book.totals!.late} of {book.totals!.entries}</p>
              <p className="text-xs text-slate-500">work day before the cash day</p>
            </Card>
          </div>

          <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white">
            <table className="w-full min-w-[640px] text-sm">
              <thead className="bg-slate-50 text-xs text-slate-500 uppercase">
                <tr>
                  <th className="px-3 py-2 text-left">Day</th>
                  <th className="px-3 py-2 text-right">Opening</th>
                  <th className="px-3 py-2 text-right">In</th>
                  <th className="px-3 py-2 text-right">Out</th>
                  <th className="px-3 py-2 text-right">Expected</th>
                  <th className="px-3 py-2 text-right">Counted</th>
                  <th className="px-3 py-2 text-right">Difference</th>
                  <th className="px-3 py-2 text-left">Closed by</th>
                </tr>
              </thead>
              <tbody>
                {book.days.length === 0 && <tr><td colSpan={8} className="px-3 py-3 text-slate-500">Nothing this month.</td></tr>}
                {book.days.map((d) => (
                  <tr key={d.date} className="border-t border-slate-100">
                    <td className="px-3 py-2 font-semibold"><a href={`/cash?d=${d.date}`} className="text-(--brand)">{shortDay(d.date)}</a></td>
                    <td className="px-3 py-2 text-right">{M(d.opening)}</td>
                    <td className="px-3 py-2 text-right text-green-700">+{M(d.in)}</td>
                    <td className="px-3 py-2 text-right text-red-700">−{M(d.out)}</td>
                    <td className="px-3 py-2 text-right">{M(d.expected)}</td>
                    <td className="px-3 py-2 text-right font-semibold">{d.counted === null ? <span className="text-amber-700">not closed</span> : M(d.counted)}</td>
                    <td className={`px-3 py-2 text-right ${d.difference === null ? "" : paise(d.difference) === 0n ? "text-green-700" : "text-red-700"}`}>{d.difference === null ? "" : differenceText(paise(d.difference))}</td>
                    <td className="px-3 py-2">{d.counted !== null ? d.closed_by : ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="grid gap-3 lg:grid-cols-2">
            <Card className="space-y-2">
              <p className="font-semibold">Expenses by type</p>
              {book.categories.length === 0 && <p className="text-sm text-slate-500">None this month.</p>}
              {book.categories.map((c) => (
                <p key={c.name} className="flex justify-between text-sm"><span>{c.name}</span><span className="font-semibold">{M(c.amount)}</span></p>
              ))}
            </Card>
            <Card className="space-y-2">
              <p className="font-semibold">Staff cash</p>
              {book.staff.length === 0 && <p className="text-sm text-slate-500">None this month.</p>}
              {book.staff.map((s) => (
                <p key={s.ref} className="flex justify-between gap-2 text-sm">
                  <span className="min-w-0 break-words">{shortDay(s.date)} · {s.person} · {s.direction === "in" ? "took back" : s.purpose ? PURPOSE_LABEL[s.purpose] : ""}</span>
                  <span className={`shrink-0 font-semibold ${s.direction === "in" ? "text-green-700" : "text-red-700"}`}>{s.direction === "in" ? "+" : "−"}{M(s.amount)}</span>
                </p>
              ))}
            </Card>
          </div>
        </>
      )}
    </div>
  );
}
