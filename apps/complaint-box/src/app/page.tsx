import { Card } from "@plantops/ui";
import { fmtDateTime } from "@plantops/module-kit/format";
import { LinkButton } from "@/lib/ui";
import { can } from "@/server/access";
import { listComplaints, type StatusFilter } from "@/server/inbox";
import { listItems, pickableItems } from "@/server/items";
import { kit } from "@/server/kit";
import { requirePageUser } from "@/server/session";
import { Header } from "./header";
import { AgeText, PhoneLink, StatusBadge } from "./parts";

type Search = Promise<Record<string, string | string[] | undefined>>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";
const STATUSES: [StatusFilter, string][] = [
  ["active", "Not resolved"],
  ["open", "Open"],
  ["in_progress", "In progress"],
  ["resolved", "Resolved"],
  ["all", "All"],
];

/** Complaint Box home: the plant's complaints, newest first, with filters and search. */
export default async function HomePage({ searchParams }: { searchParams: Search }) {
  const user = await requirePageUser("/");
  const sp = await searchParams;
  const status = (STATUSES.find(([s]) => s === one(sp.status))?.[0] ?? "active") as StatusFilter;
  const filters = { status, item: one(sp.item), from: one(sp.from), to: one(sp.to), q: one(sp.q) };
  const [plant, rows, items] = await Promise.all([
    kit.branding(user.tenantId),
    can(user, "read") ? listComplaints(user, filters) : Promise.resolve([]),
    can(user, "view_items") ? listItems(user) : can(user, "log") ? pickableItems(user) : Promise.resolve([]),
  ]);
  const filtered = Boolean(filters.item || filters.from || filters.to || filters.q);
  const link = (s: StatusFilter) => `/?${new URLSearchParams({ ...Object.fromEntries(Object.entries(filters).filter(([, v]) => v)), status: s })}`;

  return (
    <div className="space-y-5">
      <Header user={user} plant={plant} />
      <h1 className="text-2xl font-bold">Complaints</h1>
      {can(user, "log") && (
        <a href="/new" className="flex min-h-14 w-full items-center justify-center rounded-xl bg-(--brand) px-5 text-lg font-semibold text-(--brand-contrast) hover:bg-(--brand-hover)">
          + Log a complaint
        </a>
      )}

      {!can(user, "read") ? (
        <Card>You don&apos;t have access to Complaint Box. Ask the plant owner.</Card>
      ) : (
        <>
          <nav className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1" aria-label="Status">
            {STATUSES.map(([s, label]) => (
              <a key={s} href={link(s)} className={`shrink-0 rounded-full border px-4 py-2 text-sm font-semibold ${s === status ? "border-(--brand) bg-(--brand) text-(--brand-contrast)" : "border-slate-300 bg-white text-slate-700"}`}>
                {label}
              </a>
            ))}
          </nav>

          <form method="get" className="space-y-3 rounded-2xl border border-slate-200 bg-white p-4">
            <input type="hidden" name="status" value={status} />
            <label className="block">
              <span className="mb-1 block text-sm font-medium text-slate-700">Search</span>
              <input name="q" defaultValue={filters.q} placeholder="C-0042, name, mobile or place" className="min-h-12 w-full rounded-xl border border-slate-300 px-3 text-base" />
            </label>
            <details open={filtered}>
              <summary className="cursor-pointer text-sm font-semibold text-(--brand)">More filters</summary>
              <div className="mt-3 grid gap-3 sm:grid-cols-3">
                <label className="block">
                  <span className="mb-1 block text-sm font-medium text-slate-700">Item</span>
                  <select name="item" defaultValue={filters.item} className="min-h-12 w-full rounded-xl border border-slate-300 bg-white px-3 text-base">
                    <option value="">All items</option>
                    {items.map((i) => (
                      <option key={i.id} value={i.id}>
                        {i.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block">
                  <span className="mb-1 block text-sm font-medium text-slate-700">From</span>
                  <input type="date" name="from" defaultValue={filters.from} className="min-h-12 w-full rounded-xl border border-slate-300 px-3 text-base" />
                </label>
                <label className="block">
                  <span className="mb-1 block text-sm font-medium text-slate-700">To</span>
                  <input type="date" name="to" defaultValue={filters.to} className="min-h-12 w-full rounded-xl border border-slate-300 px-3 text-base" />
                </label>
              </div>
            </details>
            <div className="flex flex-wrap gap-2">
              <button type="submit" className="min-h-12 rounded-xl bg-(--brand) px-5 font-semibold text-(--brand-contrast)">
                Search
              </button>
              {filtered && (
                <a href={`/?status=${status}`} className="inline-flex min-h-12 items-center rounded-xl border border-slate-300 bg-white px-5 font-semibold">
                  Clear
                </a>
              )}
            </div>
          </form>

          {rows.length === 0 ? (
            <Card>
              <p className="text-slate-600">{filtered || status !== "active" ? "No complaints match." : "No open complaints. 🎉"}</p>
            </Card>
          ) : (
            <ul className="space-y-3">
              {rows.map((c) => (
                <li key={c.id}>
                  <div className={`relative rounded-2xl border bg-white p-4 shadow-sm ${c.amber ? "border-amber-400" : "border-slate-200"}`}>
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <a href={`/c/${c.id}`} className="text-lg font-bold after:absolute after:inset-0">
                        {c.ref}
                      </a>
                      <StatusBadge status={c.status} />
                    </div>
                    <p className="mt-1 font-semibold">{c.item_name}</p>
                    <p>
                      {c.customer_name}, {c.place}
                    </p>
                    {/* the phone link sits above the card's own link, so tapping it calls */}
                    <p className="relative z-10 mt-1 w-fit">
                      <PhoneLink phone={c.phone} plain={user.isSupport} />
                    </p>
                    <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                      <span className="text-sm text-slate-500">
                        {c.reported_by_name} · {fmtDateTime(c.created_at)}
                      </span>
                      <AgeText status={c.status} days={c.days_open} amber={c.amber} changedAt={c.status_changed_at} />
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
          {rows.length === 200 && <p className="text-sm text-slate-500">Showing the newest 200. Use search or the filters to find older ones.</p>}
        </>
      )}

      {(can(user, "view_items") || can(user, "view_changes") || can(user, "export")) && (
        <div className="flex flex-wrap gap-2 border-t border-slate-200 pt-4">
          {can(user, "view_items") && <LinkButton href="/items" variant="secondary">Item list</LinkButton>}
          {can(user, "view_changes") && <LinkButton href="/changes" variant="secondary">Recent changes</LinkButton>}
          {can(user, "export") && <LinkButton href="/api/export" variant="secondary">Export CSV</LinkButton>}
          {can(user, "support_log") && <LinkButton href="/support-access" variant="secondary">Support access</LinkButton>}
        </div>
      )}
    </div>
  );
}
