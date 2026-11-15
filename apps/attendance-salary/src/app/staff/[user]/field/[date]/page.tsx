import { notFound } from "next/navigation";
import { fmtDayLong, fmtMinutes } from "@/lib/days";
import { fmtKm } from "@/lib/field";
import { can } from "@/server/access";
import { fieldDay } from "@/server/field";
import { kit } from "@/server/kit";
import { orNotFound } from "@/server/pages";
import { requirePageUser } from "@/server/session";
import { daySummary, FieldTimeline } from "../../../../field-bits";
import { Header } from "../../../../header";
import { OwnerFix } from "./owner-fix";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const STATUS = { waiting: "waiting", approved: "approved", rejected: "not approved", cancelled: "cancelled", withdrawn: "withdrawn" } as Record<string, string>;

/**
 * One person's field day (docs/FIELD_DAY_PHASE_PLAN.md mock-up B3): start → visits → end with Google Maps links,
 * meeting notes and the two meter photos; the field-duty claim beside the km by meter. Owner: Correct km / Remove visit
 * on any day. Supervisor and support: read-only (support views logged).
 */
export default async function FieldDayPage({ params }: { params: Promise<{ user: string; date: string }> }) {
  const { user: personId, date } = await params;
  const user = await requirePageUser(`/staff/${personId}/field/${date}`);
  if (!can(user, "field_view") || !UUID.test(personId)) notFound();
  const [plant, v] = await Promise.all([kit.branding(user.tenantId), orNotFound(fieldDay(user, personId, date))]);
  const d = v.day;
  const sum = daySummary(d);
  const out = d.startedAt && d.endedAt ? Math.round((Date.parse(d.endedAt) - Date.parse(d.startedAt)) / 60_000) : null;
  const photos = [d.start && { id: d.start.photoFileId, label: "Start", km: d.start.kmTenths }, d.end && { id: d.end.photoFileId, label: "End", km: d.end.kmTenths }].filter(Boolean) as { id: string; label: string; km: number }[];
  return (
    <div className="space-y-4">
      <Header user={user} plant={plant} />
      <a href={`/staff/${personId}/field?m=${date.slice(0, 7)}`} className="flex min-h-11 items-center gap-1 font-semibold text-(--brand)">
        ‹ {v.person.name} · Field days
      </a>
      <div>
        <h1 className="text-xl font-bold">{v.person.name} · Field day</h1>
        <p className="text-sm text-slate-600">
          {fmtDayLong(date)}
          {d.notEnded && <span className="ml-2 rounded-full bg-red-100 px-2 py-0.5 text-xs font-semibold text-red-800">not ended</span>}
        </p>
      </div>
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="min-w-0 rounded-2xl border border-slate-200 bg-white px-3 pt-3.5">
          <FieldTimeline day={d} locations={v.locations} actions={v.canFix ? (t) => (t.replaced || t.removed ? null : <OwnerFix item={t} startKm={d.start?.kmTenths ?? null} />) : undefined} />
        </div>
        <div className="space-y-3">
          <div className="space-y-1 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-[15px]">
            <p className="flex justify-between gap-2">
              <strong>Today by meter</strong>
              <strong className="tabular-nums">{sum.km ?? "—"}</strong>
            </p>
            <p className="flex justify-between gap-2 text-slate-600">
              <span>Shops visited</span>
              <span>{sum.shops}</span>
            </p>
            {out !== null && (
              <p className="flex justify-between gap-2 text-slate-600">
                <span>Time out</span>
                <span>{fmtMinutes(out)}</span>
              </p>
            )}
          </div>
          {photos.length > 0 && (
            <div className="space-y-2 rounded-2xl border border-slate-200 bg-white px-4 py-3">
              <p className="text-sm font-bold">Meter photos</p>
              <div className="flex flex-wrap gap-2.5">
                {photos.map((p) => (
                  <a key={p.label} href={`/field-photos/${p.id}`} target="_blank" rel="noreferrer" className="space-y-1 text-center text-xs text-slate-600">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={`/field-photos/${p.id}`} alt={`${p.label} meter, ${fmtKm(p.km)} km`} className="h-20 w-28 rounded-lg border border-slate-200 object-cover" />
                    <span className="block">
                      {p.label} · {fmtKm(p.km)}
                    </span>
                  </a>
                ))}
              </div>
            </div>
          )}
          {v.claims.map((c, i) => (
            <p key={i} className="rounded-xl bg-blue-50 px-3 py-2.5 text-sm text-blue-950">
              Field-duty claim for this day: <strong>{c.km} km</strong> ({STATUS[c.status] ?? c.status}). Meter: <strong>{sum.km ?? "not ended"}</strong>.
            </p>
          ))}
        </div>
      </div>
    </div>
  );
}
