import { notFound } from "next/navigation";
import { Card } from "@plantops/ui";
import { fmtMonth } from "@/lib/days";
import { fmtKm } from "@/lib/field";
import { fmtTime } from "@/lib/punch";
import { can } from "@/server/access";
import { fieldMonth } from "@/server/field";
import { kit } from "@/server/kit";
import { orNotFound } from "@/server/pages";
import { requirePageUser } from "@/server/session";
import { Header } from "../../../header";

type Search = Promise<Record<string, string | string[] | undefined>>;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const dayText = (d: string) => new Intl.DateTimeFormat("en-IN", { weekday: "short", day: "numeric", timeZone: "UTC" }).format(new Date(`${d}T00:00:00Z`));

/**
 * A person's field days in a month (docs/FIELD_DAY_PHASE_PLAN.md mock-up B2): one row per day with start–end, km by
 * meter and shops; "not ended" when the End was never saved. Owner (+ visits CSV), Supervisor and support read-only.
 */
export default async function FieldMonthPage({ params, searchParams }: { params: Promise<{ user: string }>; searchParams: Search }) {
  const { user: personId } = await params;
  const user = await requirePageUser(`/staff/${personId}/field`);
  if (!can(user, "field_view") || !UUID.test(personId)) notFound();
  const sp = await searchParams;
  const [plant, v] = await Promise.all([kit.branding(user.tenantId), orNotFound(fieldMonth(user, personId, typeof sp.m === "string" ? sp.m : null))]);
  const arrow = "flex min-h-11 min-w-11 items-center justify-center rounded-full border border-slate-200 bg-white text-lg font-semibold";
  return (
    <div className="space-y-4">
      <Header user={user} plant={plant} />
      <a href={can(user, "see_everyone") ? `/staff/${personId}?m=${v.month}` : "/"} className="flex min-h-11 items-center gap-1 font-semibold text-(--brand)">
        ‹ {can(user, "see_everyone") ? v.person.name : "Today"}
      </a>
      <h1 className="text-xl font-bold">{v.person.name} · Field days</h1>
      <div className="flex items-center justify-between gap-2">
        <a href={`/staff/${personId}/field?m=${v.prev}`} aria-label="Previous month" className={arrow}>
          ‹
        </a>
        <h2 className="text-lg font-bold">{fmtMonth(v.month)}</h2>
        {v.next ? (
          <a href={`/staff/${personId}/field?m=${v.next}`} aria-label="Next month" className={arrow}>
            ›
          </a>
        ) : (
          <span className={`${arrow} text-slate-300`} aria-hidden="true">
            ›
          </span>
        )}
      </div>
      {v.days.length === 0 ? (
        <Card>No field days in {fmtMonth(v.month)}.</Card>
      ) : (
        <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
          <table className="w-full text-sm tabular-nums">
            <thead>
              <tr className="border-b border-slate-200 text-left text-xs tracking-wide text-slate-600 uppercase">
                <th className="px-3 py-2 font-semibold">Date</th>
                <th className="px-2 py-2 font-semibold">Time</th>
                <th className="px-2 py-2 text-right font-semibold">Km</th>
                <th className="px-3 py-2 text-right font-semibold">Shops</th>
              </tr>
            </thead>
            <tbody>
              {v.days.map((d) => (
                <tr key={d.date} className="border-b border-slate-100 last:border-b-0">
                  <td className="px-3 py-2.5">
                    <a href={`/staff/${personId}/field/${d.date}`} className="font-semibold text-(--brand)">
                      {dayText(d.date)}
                    </a>
                    {d.rough && <span className="ml-1 rounded-full bg-amber-100 px-1.5 text-xs text-amber-900">rough</span>}
                  </td>
                  <td className="px-2 py-2.5">
                    {d.startedAt ? fmtTime(d.startedAt) : "—"}–{d.notEnded ? <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-semibold text-red-800">not ended</span> : d.endedAt ? fmtTime(d.endedAt) : "—"}
                  </td>
                  <td className="px-2 py-2.5 text-right">{d.kmTenths === null ? "—" : fmtKm(d.kmTenths)}</td>
                  <td className="px-3 py-2.5 text-right">{d.visits}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="flex justify-between rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-[15px]">
        <span className="text-slate-600">{fmtMonth(v.month)}</span>
        <strong className="tabular-nums">
          {fmtKm(v.totals.kmTenths)} km · {v.totals.visits} {v.totals.visits === 1 ? "shop" : "shops"}
        </strong>
      </p>
      {v.canExport && v.days.length > 0 && (
        <a href={`/api/field/export?user=${personId}&month=${v.month}`} className="inline-flex min-h-11 items-center rounded-xl border border-slate-300 bg-white px-4 font-semibold">
          Download visits CSV
        </a>
      )}
    </div>
  );
}
