import { redirect } from "next/navigation";
import { Card } from "@plantops/ui";
import { money } from "@/lib/money";
import { can } from "@/server/access";
import { waitingCount } from "@/server/calls-tab";
import { kit } from "@/server/kit";
import { purchaseBillsList, type PurchaseBillFilter } from "@/server/purchases";
import { requirePageUser } from "@/server/session";
import { Header } from "../header";
import { BillBadge, SectionTabs } from "../parts";
import { day, field, one, PurchaseNav } from "./parts";

type Search = Promise<Record<string, string | string[] | undefined>>;
const FILTERS: [PurchaseBillFilter, string][] = [["all", "All"], ["open", "To pay"], ["overdue", "Overdue"], ["paid", "Paid"], ["cancelled", "Cancelled"]];

/** Purchase bills, the whole plant: what was bought, what is still to pay (owner, Accounts, support). */
export default async function PurchaseBillsPage({ searchParams }: { searchParams: Search }) {
  const user = await requirePageUser("/purchases");
  if (!can(user, "purchases_view")) redirect("/");
  const sp = await searchParams;
  const show = (FILTERS.find(([k]) => k === one(sp.show))?.[0] ?? "all") as PurchaseBillFilter;
  const f = { show, q: one(sp.q).slice(0, 100), from: one(sp.from), to: one(sp.to) };
  const [plant, data, waiting] = await Promise.all([kit.branding(user.tenantId), purchaseBillsList(user, f), waitingCount(user)]);
  const link = (s: PurchaseBillFilter) => `/purchases?${new URLSearchParams({ show: s, ...(f.q ? { q: f.q } : {}), ...(f.from ? { from: f.from } : {}), ...(f.to ? { to: f.to } : {}) })}`;
  return (
    <div className="space-y-4">
      <Header user={user} plant={plant} />
      <SectionTabs current="purchases" waiting={waiting} bills={can(user, "ledger_view")} purchases calls={can(user, "calls_view")} cash={can(user, "cash_view")} />
      <PurchaseNav current="bills" user={user} />

      <Card className="grid grid-cols-2 gap-3">
        <div>
          <p className="text-xs text-slate-500">Bought{f.from || f.to ? " in these dates" : ""}</p>
          <p className="text-2xl font-bold">{money(data.summary.billed)}</p>
          <p className="text-xs text-slate-500">{data.summary.n} bills</p>
        </div>
        <div>
          <p className="text-xs text-slate-500">Still to pay</p>
          <p className={`text-2xl font-bold ${data.summary.due !== "0.00" ? "text-amber-700" : ""}`}>{money(data.summary.due)}</p>
          {data.summary.overdue !== "0.00" && <p className="text-xs text-red-700">{money(data.summary.overdue)} overdue</p>}
        </div>
      </Card>

      <nav aria-label="Show" className="flex flex-wrap gap-2">
        {FILTERS.map(([s, label]) => (
          <a key={s} href={link(s)} aria-current={s === show ? "page" : undefined}
            className={`inline-flex min-h-10 items-center rounded-full border px-4 text-sm font-semibold ${s === show ? "border-(--brand) bg-(--brand-soft) text-(--brand)" : "border-slate-300 bg-white text-slate-700"}`}>
            {label}
          </a>
        ))}
      </nav>
      <form method="get" className="space-y-2">
        <input type="hidden" name="show" value={show} />
        <input name="q" defaultValue={f.q} className={field} placeholder="Search bill no., vendor, item or PO" />
        <div className="grid grid-cols-2 gap-2">
          <label className="text-sm">From<input type="date" name="from" defaultValue={f.from} className={field} /></label>
          <label className="text-sm">To<input type="date" name="to" defaultValue={f.to} className={field} /></label>
        </div>
        <button className="min-h-11 w-full rounded-xl border border-slate-300 bg-white text-sm font-semibold">Search</button>
      </form>

      <ul className="space-y-2">
        {data.bills.length === 0 && (
          <p className="text-sm text-slate-500">
            No purchase bills here.{can(user, "purchase_import") && !f.q && show === "all" ? <> <a href="/purchases/import" className="font-semibold text-(--brand)">Import them from Zoho →</a></> : null}
          </p>
        )}
        {data.bills.map((b) => (
          <li key={b.id}>
            <a href={`/purchases/bills/${b.id}`} className={`flex items-start justify-between gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-3 hover:bg-slate-50 ${b.cancelled ? "opacity-60" : ""}`}>
              <span className="min-w-0">
                <span className="block font-semibold break-words">{b.vendor_name}</span>
                <span className="block text-sm text-slate-500">
                  {b.number}{b.source === "zoho" ? " · Zoho" : ""}{b.po_number ? ` · ${b.po_number}` : ""} · {day(b.bill_date)} · {b.lines} {b.lines === 1 ? "item" : "items"}
                </span>
              </span>
              <span className="shrink-0 text-right">
                <span className="block font-semibold">{money(b.total)}</span>
                <BillBadge status={b.status} due={money(b.due)} />
              </span>
            </a>
          </li>
        ))}
      </ul>
      {data.more && <p className="text-sm text-slate-500">Showing the first 200. Search or pick dates to find others.</p>}
    </div>
  );
}
