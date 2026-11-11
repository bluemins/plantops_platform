import { redirect } from "next/navigation";
import { Card } from "@plantops/ui";
import { money } from "@/lib/money";
import { can } from "@/server/access";
import { waitingCount } from "@/server/calls-tab";
import { kit } from "@/server/kit";
import { paymentsList } from "@/server/ledger";
import { requirePageUser } from "@/server/session";
import { Header } from "../header";
import { SectionTabs } from "../parts";

type Search = Promise<Record<string, string | string[] | undefined>>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";
const MODES: [string, string][] = [["", "All"], ["cash", "Cash"], ["upi", "UPI"], ["bank", "Bank"], ["cheque", "Cheque"], ["other", "Other"]];
const field = "min-h-12 w-full min-w-0 rounded-xl border border-slate-300 bg-white px-3 text-base focus:border-(--brand) focus:outline-none";
const day = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

/** Payments received, the whole plant (owner, Order desk, support). */
export default async function PaymentsPage({ searchParams }: { searchParams: Search }) {
  const user = await requirePageUser("/payments");
  if (!can(user, "ledger_view")) redirect("/");
  const sp = await searchParams;
  const f = { q: one(sp.q).slice(0, 100), from: one(sp.from), to: one(sp.to), mode: one(sp.mode) };
  const [plant, data, waiting] = await Promise.all([kit.branding(user.tenantId), paymentsList(user, f), waitingCount(user)]);
  const href = (p: { customer_id: string | null; contact_id: string | null }) => (p.customer_id ? `/customers/${p.customer_id}?tab=payments` : p.contact_id ? `/customers/z/${p.contact_id}?tab=payments` : "#");
  return (
    <div className="space-y-4">
      <Header user={user} plant={plant} />
      <SectionTabs current="bills" waiting={waiting} bills purchases={can(user, "purchases_view")} calls={can(user, "calls_view")} cash={can(user, "cash_view")} />
      <nav aria-label="Bills or payments" className="flex gap-4 text-sm font-semibold">
        <a href="/bills" className="pb-1 text-slate-600">Bills</a>
        <a href="/bills/gst" className="pb-1 text-slate-600">GST invoices</a>
        <span className="border-b-2 border-(--brand) pb-1">Payments</span>
        {can(user, "ledger_export") && <a href="/api/export/payments" className="ml-auto pb-1 text-(--brand)">CSV</a>}
      </nav>
      {data.total && <Card>
        <p className="text-xs text-slate-500">Received{f.from || f.to ? " in these dates" : ""}{f.mode ? ` (${f.mode})` : ""}</p>
        <p className="text-2xl font-bold">{money(data.total.sum)}</p>
        <p className="text-xs text-slate-500">{data.total.n} payments</p>
      </Card>}
      <form method="get" className="space-y-2">
        <input name="q" defaultValue={f.q} className={field} placeholder="Search payment no., name or reference" />
        <div className="grid grid-cols-3 gap-2">
          <label className="text-sm">From<input type="date" name="from" defaultValue={f.from} className={field} /></label>
          <label className="text-sm">To<input type="date" name="to" defaultValue={f.to} className={field} /></label>
          <label className="text-sm">Mode
            <select name="mode" defaultValue={f.mode} className={field}>{MODES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
          </label>
        </div>
        <button className="min-h-11 w-full rounded-xl border border-slate-300 bg-white text-sm font-semibold">Search</button>
      </form>
      <ul className="space-y-2">
        {data.payments.length === 0 && <p className="text-sm text-slate-500">No payments here.</p>}
        {data.payments.map((p) => (
          <li key={p.id}>
            <a href={href(p)} className={`flex items-start justify-between gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-3 hover:bg-slate-50 ${p.cancelled ? "opacity-60" : ""}`}>
              <span className="min-w-0">
                <span className="block font-semibold break-words">{p.name}</span>
                <span className="block text-sm text-slate-500">
                  {p.number}{p.source === "zoho" ? " · Zoho" : ""} · {day(p.payment_date)} · {p.mode}{p.reference ? ` · ${p.reference}` : ""}{p.cancelled ? " · cancelled" : ""}
                </span>
                {!p.cancelled && p.unused !== "0.00" && <span className="block text-sm text-slate-600">{money(p.unused)} advance</span>}
              </span>
              <span className="shrink-0 font-semibold">{money(p.amount)}</span>
            </a>
          </li>
        ))}
      </ul>
      {data.more && <p className="text-sm text-slate-500">Showing the latest 200. Search or pick dates to find others.</p>}
    </div>
  );
}
