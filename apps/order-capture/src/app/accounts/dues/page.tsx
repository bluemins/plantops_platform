import { redirect } from "next/navigation";
import { phoneDisplay } from "@plantops/module-kit/phone";
import { duesChoices, filterDues } from "@/lib/accounts-desk";
import { money } from "@/lib/money";
import { dmy } from "@/lib/receivables";
import { can } from "@/server/access";
import { deskCustomerDues } from "@/server/accounts-desk";
import { kit } from "@/server/kit";
import { requirePageUser } from "@/server/session";
import { Header } from "../../header";
import { BackLink } from "../../parts";
import { DeskTabs } from "../parts";

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";
const SHOW = 50;
const field = "mt-1 min-h-11 w-full rounded-lg border border-slate-300 bg-white px-2 text-sm text-slate-900";
const btn = "flex min-h-11 items-center justify-center rounded-lg border border-slate-300 text-center text-xs font-bold leading-tight";

/** What each customer owes, most overdue first, with the follow-up buttons. No plant-wide ₹ total, no CSV (owner, 2026-11-23). */
export default async function CustomerDuesPage({ searchParams }: Props) {
  const user = await requirePageUser("/accounts/dues");
  if (!can(user, "accounts_desk")) redirect("/");
  const sp = await searchParams;
  const f = { q: one(sp.q).slice(0, 100), place: one(sp.place).slice(0, 200), salesperson: one(sp.salesperson).slice(0, 100), overdue: one(sp.overdue) === "1" };
  const all = one(sp.all) === "1";
  const [plant, everyone] = await Promise.all([kit.branding(user.tenantId), deskCustomerDues(user)]);
  const rows = filterDues(everyone, f);
  const shown = all ? rows : rows.slice(0, SHOW);
  const choices = duesChoices(everyone);
  const link = (x: { overdue?: boolean; all?: boolean }) => {
    const u = new URLSearchParams();
    if (f.q) u.set("q", f.q);
    if (f.place) u.set("place", f.place);
    if (f.salesperson) u.set("salesperson", f.salesperson);
    if (x.overdue ?? f.overdue) u.set("overdue", "1");
    if (x.all) u.set("all", "1");
    const s = u.toString();
    return s ? `/accounts/dues?${s}` : "/accounts/dues";
  };
  const overdueCount = rows.filter((r) => r.overdue > 0n).length;
  return (
    <div className="space-y-3 pb-8">
      <Header user={user} plant={plant} />
      <BackLink>← Sales</BackLink>
      <h1 className="text-2xl font-bold">Accounts desk</h1>
      <DeskTabs current="dues" />
      <p className="text-sm font-semibold">
        {rows.length} {rows.length === 1 ? "customer owes" : "customers owe"} · <span className="text-red-800">{overdueCount} overdue</span>
      </p>
      <form method="get" className="space-y-2 rounded-xl border border-slate-200 bg-white p-3">
        {f.overdue && <input type="hidden" name="overdue" value="1" />}
        <label className="block text-xs text-slate-600">
          Search customer
          <input type="search" name="q" defaultValue={f.q} placeholder="Name, place or phone" className={field} />
        </label>
        <div className="grid grid-cols-2 gap-2">
          <label className="text-xs text-slate-600">Place
            <select name="place" defaultValue={f.place} className={field}>
              <option value="">All</option>
              {choices.places.map((x) => <option key={x} value={x}>{x}</option>)}
            </select>
          </label>
          <label className="text-xs text-slate-600">Salesperson
            <select name="salesperson" defaultValue={f.salesperson} className={field}>
              <option value="">All</option>
              {choices.salespeople.map((x) => <option key={x} value={x}>{x}</option>)}
            </select>
          </label>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <a href={link({ overdue: !f.overdue })} aria-current={f.overdue ? "true" : undefined} className={`flex min-h-11 items-center justify-center rounded-lg border text-sm font-bold ${f.overdue ? "border-red-800 bg-red-800 text-white" : "border-slate-300 bg-white"}`}>Only overdue</a>
          <button className="min-h-11 rounded-lg bg-(--brand) text-sm font-bold text-(--brand-contrast)">Show</button>
        </div>
      </form>
      {shown.length === 0 && <p className="rounded-xl border border-slate-200 bg-white p-4 text-sm text-slate-600">Nobody here owes anything.</p>}
      {shown.map((c) => {
        const tel = c.phone ? phoneDisplay(c.phone, user.isSupport).href : null;
        const wa = c.phone?.length === 10 && !user.isSupport ? `https://wa.me/91${c.phone}` : null;
        return (
          <article key={c.key} className="space-y-2 rounded-xl border border-slate-200 bg-white p-3">
            <div className="flex justify-between gap-3">
              <a href={c.href} className="min-w-0">
                <strong className="block break-words">{c.name}</strong>
                <span className="block text-xs text-slate-600">{c.place}</span>
              </a>
              <span className="text-right">
                <strong className="block text-lg">{money(c.due)}</strong>
                {c.overdue > 0n && <span className="block text-xs font-bold text-red-800">{money(c.overdue)} overdue</span>}
              </span>
            </div>
            <div className="flex justify-between gap-2 text-xs text-slate-600">
              <span>Oldest bill: {c.oldest_days} {c.oldest_days === 1 ? "day" : "days"}</span>
              <span>Last paid: {c.last_paid ? dmy(c.last_paid) : "never"}</span>
            </div>
            {c.advance > 0n && <span className="inline-block rounded bg-green-100 px-2 py-0.5 text-xs font-bold text-green-900">Advance {money(c.advance)} held</span>}
            <div className="grid grid-cols-4 gap-1">
              {tel ? <a href={tel} className={btn}>Call</a> : <span className={`${btn} text-slate-400`}>Call</span>}
              {wa ? <a href={wa} target="_blank" rel="noreferrer" className={btn}>WhatsApp</a> : <span className={`${btn} text-slate-400`}>WhatsApp</span>}
              {can(user, "payment_receive") ? (
                <a href={`${c.href}?tab=bills`} className="flex min-h-11 items-center justify-center rounded-lg bg-(--brand) text-center text-xs font-bold leading-tight text-(--brand-contrast)">Receive payment</a>
              ) : <span className={`${btn} text-slate-400`}>Receive payment</span>}
              <a href={`${c.href}?tab=statement`} className={btn}>Statement</a>
            </div>
          </article>
        );
      })}
      {!all && rows.length > SHOW && (
        <a href={link({ all: true })} className="flex min-h-11 items-center justify-center rounded-lg border border-slate-300 bg-white text-sm font-bold text-(--brand)">Show {rows.length - SHOW} more</a>
      )}
    </div>
  );
}
