import { Card } from "@plantops/ui";
import { STATUSES } from "@/lib/status";
import { can } from "@/server/access";
import { listApplications, type StatusFilter } from "@/server/applications";
import { kit } from "@/server/kit";
import { requirePageUser } from "@/server/session";
import { Header } from "../header";
import { CallButton, StatusChip, whenText } from "../parts";
import { Tabs } from "../tabs";

type Search = Promise<Record<string, string | string[] | undefined>>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

/** Mock-up 5: the plant's applications, newest first, with status chips, search and position filter. */
export default async function ApplicationsPage({ searchParams }: { searchParams: Search }) {
  const user = await requirePageUser("/applications");
  const plant = await kit.branding(user.tenantId);
  if (!can(user, "read")) {
    return (
      <div className="space-y-5">
        <Header user={user} plant={plant} />
        <Card>
          <p className="text-slate-600">You don&apos;t have access to Job applications. Ask your plant owner for the HR desk role.</p>
        </Card>
      </div>
    );
  }
  const sp = await searchParams;
  const status = ([...STATUSES.map((s) => s.id), "all"] as string[]).includes(one(sp.status)) ? (one(sp.status) as StatusFilter) : "all";
  const q = one(sp.q).slice(0, 100);
  const position = one(sp.position).slice(0, 40);
  const list = await listApplications(user, { status, q, position });
  const link = (s: string) => `/applications?${new URLSearchParams({ ...(q ? { q } : {}), ...(position ? { position } : {}), status: s })}`;
  const chip = (on: boolean) =>
    `shrink-0 whitespace-nowrap rounded-full border px-3.5 py-2 text-sm font-semibold ${on ? "border-(--brand) bg-(--brand) text-(--brand-contrast)" : "border-slate-300 bg-white text-slate-900"}`;

  return (
    <div className="space-y-4">
      <Header user={user} plant={plant} />
      <Tabs user={user} active="applications" />
      <h1 className="sr-only">Applications</h1>
      <nav aria-label="Status" className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-0.5">
        {STATUSES.map((s) => (
          <a key={s.id} href={link(s.id)} aria-current={status === s.id ? "page" : undefined} className={chip(status === s.id)}>
            {s.label}
            {list.counts[s.id] ? ` · ${list.counts[s.id]}` : ""}
          </a>
        ))}
        <a href={link("all")} aria-current={status === "all" ? "page" : undefined} className={chip(status === "all")}>
          All{list.counts.all ? ` · ${list.counts.all}` : ""}
        </a>
      </nav>
      <form className="grid grid-cols-2 gap-2" action="/applications">
        <input type="hidden" name="status" value={status} />
        <input type="search" name="q" defaultValue={q} aria-label="Search name, phone or place" placeholder="Search name, phone, place" className="min-w-0 rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-[15px]" />
        <select name="position" defaultValue={position} aria-label="Position" className="min-w-0 rounded-xl border border-slate-300 bg-white px-2.5 py-2.5 text-[15px]">
          <option value="">All positions</option>
          <option value="any">Any job</option>
          {list.positions.map((p) => (
            <option key={p.id} value={p.id}>
              {p.title}
            </option>
          ))}
        </select>
        <button type="submit" className="sr-only">
          Search
        </button>
      </form>

      {list.rows.length === 0 ? (
        <Card>
          <p className="text-slate-600">{list.counts.all ? "No applications match." : "No applications yet. Share your public page (Openings → Copy link or Print QR poster)."}</p>
        </Card>
      ) : (
        <ul className="space-y-3">
          {list.rows.map((a) => (
            <li key={a.id} className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-white p-3.5">
              <a href={`/applications/${a.id}`} className="flex min-w-0 grow flex-col gap-1 text-slate-900">
                <span className="flex items-center gap-2">
                  <span className={`truncate text-base ${a.status === "new" ? "font-bold" : "font-semibold"}`}>{a.name}</span>
                  <StatusChip status={a.status} />
                </span>
                <span className="truncate text-sm text-slate-700">{a.position}</span>
                <span className="truncate text-[13px] text-slate-600">
                  {a.ref} · {a.place} · {whenText(a.createdAt)}
                </span>
              </a>
              <CallButton name={a.name} phone={a.phone} plain={user.isSupport} />
            </li>
          ))}
        </ul>
      )}
      {list.more && <p className="text-sm text-slate-600">Showing the newest 200. Search or filter to find older ones.</p>}
    </div>
  );
}
