import { redirect } from "next/navigation";
import { Card } from "@plantops/ui";
import { money } from "@/lib/money";
import { can } from "@/server/access";
import { kit } from "@/server/kit";
import { waitingCount } from "@/server/calls-tab";
import { DATE_LABEL, listOrders, pendingSummary, TABS, tabCounts, type PendingSummary, type Tab } from "@/server/list";
import { requirePageUser } from "@/server/session";
import { Header } from "./header";
import { OrderCards } from "./order-cards";
import { BrandTag, LinkRow, SectionTabs } from "./parts";

type Search = Promise<Record<string, string | string[] | undefined>>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";
const field = "min-h-12 w-full min-w-0 rounded-xl border border-slate-300 bg-white px-3 text-base focus:border-(--brand) focus:outline-none focus:ring-2 focus:ring-(--brand-ring)";

/** Order Capture home (mock-up "Pending orders"): New order, the Pending / Delivered / Cancelled lists, search. */
export default async function HomePage({ searchParams }: { searchParams: Search }) {
  const user = await requirePageUser("/");
  if (user.who === "delivery") redirect("/calls"); // Delivery staff work in Calls only
  if (user.who === "store") redirect("/purchases/received"); // Store keepers: purchases received only
  if (user.who === "marketing") redirect("/customers"); // Marketing staff work on customers, never orders
  const sp = await searchParams;
  const tab = (TABS.find(([t]) => t === one(sp.tab))?.[0] ?? "pending") as Tab;
  const filters = { tab, q: one(sp.q).slice(0, 100), from: one(sp.from), to: one(sp.to), brand: one(sp.brand).slice(0, 30) };
  const plant = await kit.branding(user.tenantId);

  if (!can(user, "read")) {
    return (
      <div className="space-y-5">
        <Header user={user} plant={plant} />
        <Card>You don&apos;t have access to Sales. Ask the plant owner.</Card>
      </div>
    );
  }

  const [list, counts, summary, waiting] = await Promise.all([
    listOrders(user, filters),
    tabCounts(user),
    tab === "pending" && can(user, "pending_summary") ? pendingSummary(user) : null,
    waitingCount(user),
  ]);
  const filtered = Boolean(filters.q || filters.from || filters.to || filters.brand);
  const keep = (skip: string) => Object.fromEntries(Object.entries(filters).filter(([k, v]) => v && k !== skip));
  const link = (t: Tab) => `/?${new URLSearchParams({ ...keep("tab"), tab: t })}`;
  const brandLink = (b: string) => `/?${new URLSearchParams({ ...keep("brand"), ...(b ? { brand: b } : {}) })}`;

  return (
    <div className="space-y-4">
      <Header user={user} plant={plant} />
      <SectionTabs current="orders" waiting={waiting} bills={can(user, "ledger_view")} purchases={can(user, "purchases_view")} calls={can(user, "calls_view")} cash={can(user, "cash_view")} />
      {can(user, "enter") && (
        <a href="/new" className="flex min-h-14 w-full items-center justify-center rounded-xl bg-(--brand) px-5 text-lg font-semibold text-(--brand-contrast) hover:bg-(--brand-hover)">
          + New order
        </a>
      )}

      <nav aria-label="Order status" className="grid grid-cols-3 gap-1 rounded-xl border border-slate-200 bg-white p-1">
        {TABS.map(([t, label]) => (
          <a
            key={t}
            href={link(t)}
            aria-current={t === tab ? "page" : undefined}
            className={`flex min-h-11 items-center justify-center rounded-lg text-sm font-semibold ${t === tab ? "bg-(--brand-soft) text-(--brand)" : "text-slate-600"}`}
          >
            {label}
            {t === "pending" ? ` · ${counts.pending}` : ""}
          </a>
        ))}
      </nav>

      {summary && summary.orders > 0 && <PendingTotals summary={summary} />}

      {list.brands.length > 1 && (
        <nav aria-label="Brand" className="flex flex-wrap gap-2">
          {["", ...list.brands].map((b) => {
            const on = b === filters.brand;
            return (
              <a
                key={b || "all"}
                href={brandLink(b)}
                aria-current={on ? "page" : undefined}
                className={`inline-flex min-h-10 items-center rounded-full border px-4 text-sm font-semibold ${on ? "border-(--brand) bg-(--brand-soft) text-(--brand)" : "border-slate-300 bg-white text-slate-700"}`}
              >
                {b || "All brands"}
              </a>
            );
          })}
        </nav>
      )}

      <form method="get" className="space-y-2">
        <input type="hidden" name="tab" value={tab} />
        {filters.brand && <input type="hidden" name="brand" value={filters.brand} />}
        <input name="q" defaultValue={filters.q} aria-label="Search orders" placeholder="Order no., name, phone or place" className={field} />
        <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] items-end gap-2">
          <label className="block text-xs text-slate-500">
            {DATE_LABEL[tab]}
            <input type="date" name="from" defaultValue={filters.from} className={field} />
          </label>
          <label className="block text-xs text-slate-500">
            To
            <input type="date" name="to" defaultValue={filters.to} className={field} />
          </label>
          <button type="submit" className="min-h-12 rounded-xl border border-slate-300 bg-white px-4 font-semibold">
            Search
          </button>
        </div>
        {filtered && (
          <a href={`/?tab=${tab}`} className="inline-flex min-h-11 items-center text-sm font-semibold text-(--brand)">
            Clear the search
          </a>
        )}
      </form>

      <p className="text-sm text-slate-500">{tab === "pending" ? "Oldest first" : "Newest first"}</p>
      {list.orders.length === 0 ? (
        <Card>
          <p className="text-slate-500">{filtered ? `No order matches this ${filters.brand && !filters.q && !filters.from && !filters.to ? "brand" : "search"}.` : tab === "pending" ? "No pending orders." : `No ${tab} orders yet.`}</p>
        </Card>
      ) : (
        <OrderCards orders={list.orders} tickable={tab === "pending" && can(user, "copy_list")} plainPhones={user.isSupport} />
      )}
      {list.more && <p className="text-sm text-slate-500">More orders than shown: search or pick dates to narrow the list.</p>}

      <nav className="space-y-3 pt-2" aria-label="More">
        {can(user, "view_rates") && (
          <LinkRow href="/rates" note="Unit and default rate per product">
            Rates
          </LinkRow>
        )}
        {can(user, "view_customers") && (
          <LinkRow href="/customers" note={can(user, "customer_upload") ? "Add, edit or upload a list" : "Add or edit customers"}>
            Customers
          </LinkRow>
        )}
        {can(user, "drop_polls") && (
          <LinkRow href="/customers/drop/polls" note="Add a poll for the shops in the Drop app, see the answers">
            Drop polls
          </LinkRow>
        )}
        {can(user, "view_changes") && (
          <LinkRow href="/changes" note="Who changed rates and customers, exports">
            Recent changes
          </LinkRow>
        )}
        {can(user, "reminder_pilot") && (
          <LinkRow href="/reminders" note="WhatsApp reminders 15 days after a delivery">
            Reminder pilot
          </LinkRow>
        )}
        {can(user, "support_log") && (
          <LinkRow href="/support-access" note="When PlantOps support looked at your orders">
            Support access
          </LinkRow>
        )}
        {can(user, "export") && (
          <a href="/api/export" className="flex min-h-12 items-center text-sm font-semibold text-(--brand)">
            Download all orders (CSV)
          </a>
        )}
      </nav>
    </div>
  );
}

/** Owner only: all pending orders added up (the whole plant, not the search). */
function PendingTotals({ summary }: { summary: PendingSummary }) {
  const rate = (p: PendingSummary["products"][number]) =>
    p.min_rate === null || p.max_rate === null ? "—" : p.min_rate === p.max_rate ? money(p.min_rate) : `${money(p.min_rate)}–${money(p.max_rate)}`;
  return (
    <details open className="rounded-2xl border border-slate-200 bg-white p-4">
      <summary className="flex min-h-10 cursor-pointer list-none items-baseline justify-between gap-3">
        <span>
          <span className="block text-sm text-slate-500">All pending orders · {summary.orders.toLocaleString("en-IN")}</span>
          <span className="text-2xl font-bold">{money(summary.total)}</span>
        </span>
        <span className="shrink-0 text-sm font-semibold text-(--brand)">{summary.brands.length ? "By brand & product ▾" : "By product ▾"}</span>
      </summary>
      {summary.brands.length > 0 && (
        <table className="mt-3 w-full text-sm">
          <thead>
            <tr className="text-left text-slate-500">
              <th className="pb-1 font-normal">Brand</th>
              <th className="pb-1 text-right font-normal">Qty</th>
              <th className="pb-1 text-right font-normal">Amount</th>
            </tr>
          </thead>
          <tbody>
            {summary.brands.map((b) => (
              <tr key={b.brand || "none"} className="border-t border-slate-100 align-top">
                <td className="py-1.5 pr-2">
                  {b.brand ? <BrandTag brand={b.brand} /> : <span className="text-slate-500">No brand</span>}
                  <span className="block text-xs text-slate-500">
                    {b.orders.toLocaleString("en-IN")} {b.orders === 1 ? "order" : "orders"}
                  </span>
                </td>
                <td className="py-1.5 pl-2 text-right">{b.units}</td>
                <td className="py-1.5 pl-2 text-right font-semibold whitespace-nowrap">{money(b.amount)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <table className={`w-full text-sm ${summary.brands.length ? "mt-5" : "mt-3"}`}>
        <thead>
          <tr className="text-left text-slate-500">
            <th className="pb-1 font-normal">Product</th>
            <th className="pb-1 text-right font-normal">Qty</th>
            <th className="pb-1 text-right font-normal">Rate</th>
            <th className="pb-1 text-right font-normal">Amount</th>
          </tr>
        </thead>
        <tbody>
          {summary.products.map((p) => (
            <tr key={`${p.sku_id}:${p.unit}`} className="border-t border-slate-100 align-top">
              <td className="py-1.5 pr-2 break-words">
                {p.product}
                <span className="block text-xs text-slate-500">
                  {p.orders.toLocaleString("en-IN")} {p.orders === 1 ? "order" : "orders"}
                </span>
              </td>
              <td className="py-1.5 pl-2 text-right whitespace-nowrap">
                {p.quantity.toLocaleString("en-IN")} {p.unit}
                {p.free_quantity > 0 && <span className="block text-xs font-semibold text-green-800">+ {p.free_quantity.toLocaleString("en-IN")} free</span>}
              </td>
              <td className="py-1.5 pl-2 text-right whitespace-nowrap">{rate(p)}</td>
              <td className="py-1.5 pl-2 text-right font-semibold whitespace-nowrap">{money(p.amount)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="border-t-2 border-slate-200 font-bold">
            <td className="pt-2" colSpan={3}>
              Total
            </td>
            <td className="pt-2 text-right whitespace-nowrap">{money(summary.total)}</td>
          </tr>
        </tfoot>
      </table>
    </details>
  );
}
