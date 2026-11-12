import { redirect } from "next/navigation";
import { Card } from "@plantops/ui";
import { money } from "@/lib/money";
import { can } from "@/server/access";
import { gstQueue } from "@/server/bill-make";
import { waitingCount } from "@/server/calls-tab";
import { kit } from "@/server/kit";
import { BILL_FILTERS, billsList, type BillFilter } from "@/server/ledger";
import { requirePageUser } from "@/server/session";
import { Header } from "../header";
import { BillBadge, SectionTabs } from "../parts";

type Search = Promise<Record<string, string | string[] | undefined>>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";
const LABEL: Record<BillFilter, string> = { open: "Due", overdue: "Overdue", paid: "Paid", cancelled: "Cancelled", all: "All" };
const field = "min-h-12 w-full min-w-0 rounded-xl border border-slate-300 bg-white px-3 text-base focus:border-(--brand) focus:outline-none";
const day = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

/** The plant's bills (mock-up 6): total still due, overdue count, filters, search. Owner, Order desk, support. */
export default async function BillsPage({ searchParams }: { searchParams: Search }) {
  const user = await requirePageUser("/bills");
  if (!can(user, "ledger_view")) redirect("/");
  const sp = await searchParams;
  const show = (BILL_FILTERS.find((x) => x === one(sp.show)) ?? "open") as BillFilter;
  const f = { show, q: one(sp.q).slice(0, 100), from: one(sp.from), to: one(sp.to) };
  const [plant, data, waiting, gst] = await Promise.all([kit.branding(user.tenantId), billsList(user, f), waitingCount(user), gstQueue(user)]);
  const gstWaiting = gst.not_sent.length + gst.sent.length;
  const link = (s: BillFilter) => `/bills?${new URLSearchParams({ show: s, ...(f.q ? { q: f.q } : {}) })}`;
  return (
    <div className="space-y-4">
      <Header user={user} plant={plant} />
      <SectionTabs current="bills" waiting={waiting} bills purchases={can(user, "purchases_view")} calls={can(user, "calls_view")} cash={can(user, "cash_view")} />
      <nav aria-label="Bills or payments" className="flex gap-4 text-sm font-semibold">
        <span className="border-b-2 border-(--brand) pb-1">Bills</span>
        <a href="/payments" className="pb-1 text-slate-600">Payments</a>
        <a href="/bills/gst" className="pb-1 text-slate-600">GST invoices to make{gstWaiting ? ` · ${gstWaiting}` : ""}</a>
        {can(user, "ledger_export") && <a href="/api/export/bills" className="ml-auto pb-1 text-(--brand)">CSV</a>}
      </nav>

      {data.summary && <Card className="grid grid-cols-2 gap-3">
        <div>
          <p className="text-xs text-slate-500">Still due</p>
          <p className="text-2xl font-bold text-amber-700">{money(data.summary.due)}</p>
          <p className="text-xs text-slate-500">{data.summary.open} bills</p>
        </div>
        <div>
          <p className="text-xs text-slate-500">Overdue bills</p>
          <p className="text-2xl font-bold">{data.summary.overdue}</p>
        </div>
      </Card>}

      <nav aria-label="Show" className="flex flex-wrap gap-2">
        {BILL_FILTERS.map((s) => (
          <a key={s} href={link(s)} aria-current={s === show ? "page" : undefined}
            className={`inline-flex min-h-10 items-center rounded-full border px-4 text-sm font-semibold ${s === show ? "border-(--brand) bg-(--brand-soft) text-(--brand)" : "border-slate-300 bg-white text-slate-700"}`}>
            {LABEL[s]}
          </a>
        ))}
      </nav>
      <form method="get" className="space-y-2">
        <input type="hidden" name="show" value={show} />
        <input name="q" defaultValue={f.q} className={field} placeholder="Search bill no., name or mobile" />
        <div className="grid grid-cols-2 gap-2">
          <label className="text-sm">From<input type="date" name="from" defaultValue={f.from} className={field} /></label>
          <label className="text-sm">To<input type="date" name="to" defaultValue={f.to} className={field} /></label>
        </div>
        <button className="min-h-11 w-full rounded-xl border border-slate-300 bg-white text-sm font-semibold">Search</button>
      </form>

      <ul className="space-y-2">
        {data.bills.length === 0 && <p className="text-sm text-slate-500">No bills here.</p>}
        {data.bills.map((b) => (
          <li key={b.id}>
            <a href={`/bills/${b.id}`} className="flex items-start justify-between gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-3 hover:bg-slate-50">
              <span className="min-w-0">
                <span className="block font-semibold break-words">{b.name}</span>
                <span className="block text-sm text-slate-500">
                  {b.number}{b.source === "jar_month" ? " · 20 L month" : b.opening_balance ? " · opening balance" : b.source === "zoho" ? " · Zoho" : ""}{b.order_ref ? ` · ${b.order_ref}` : ""} · {day(b.bill_date)}
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
