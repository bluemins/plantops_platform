import { Card } from "@plantops/ui";
import { fmtMonth } from "@/lib/days";
import { kmText } from "@/lib/salary";
import { ADD_PHOTOS_WITHIN_MS, myClaims } from "@/server/claims";
import { kit } from "@/server/kit";
import { orNotFound } from "@/server/pages";
import { requirePageUser } from "@/server/session";
import { MAX_PHOTOS } from "@/server/storage";
import { claimHeading, claimValue, DecisionLine, StatusPill, Thumbs, typedRupees } from "../../claim-bits";
import { Header } from "../../header";
import { MyTabs, myTabs } from "../../my-tabs";
import { AddPhoto, Withdraw } from "./claim-actions";

type Search = Promise<Record<string, string | string[] | undefined>>;

/**
 * My claims (docs/SALARY_EXTRAS_PHASE_PLAN.md mock-up 2): your own field duty and expenses for a month, with their
 * status. Km and the amounts you typed; never TA / DA rupees (those are on the salary slip, with permission). Only for
 * someone with a salary setting (404 otherwise); only your own.
 */
export default async function MyClaimsPage({ searchParams }: { searchParams: Search }) {
  const sp = await searchParams;
  const user = await requirePageUser("/my/claims");
  const [plant, v] = await Promise.all([kit.branding(user.tenantId), orNotFound(myClaims(user, typeof sp.m === "string" ? sp.m : null))]);
  const now = Date.now();
  const arrow = "flex min-h-11 min-w-11 items-center justify-center rounded-full border border-slate-200 bg-white text-lg font-semibold";
  const big = "flex min-h-13 items-center justify-center rounded-xl bg-(--brand) px-3 font-bold text-(--brand-contrast) hover:bg-(--brand-hover)";
  const a = v.approved;
  return (
    <div className="space-y-4">
      <Header user={user} plant={plant} />
      <MyTabs {...await myTabs(user)} current="claims" />
      <div className="flex items-center justify-between gap-2">
        {v.prev ? (
          <a href={`/my/claims?m=${v.prev}`} aria-label="Previous month" className={arrow}>
            ‹
          </a>
        ) : (
          <span className={`${arrow} text-slate-300`} aria-hidden="true">‹</span>
        )}
        <h1 className="text-xl font-bold">{fmtMonth(v.month)}</h1>
        {v.next ? (
          <a href={`/my/claims?m=${v.next}`} aria-label="Next month" className={arrow}>
            ›
          </a>
        ) : (
          <span className={`${arrow} text-slate-300`} aria-hidden="true">›</span>
        )}
      </div>
      {v.onSalary && (
        <div className={`grid gap-2.5 ${v.fieldDuty ? "grid-cols-2" : "grid-cols-1"}`}>
          {v.fieldDuty && (
            <a href="/my/claims/new?kind=field_duty" className={big}>
              + Field duty
            </a>
          )}
          <a href="/my/claims/new?kind=expense" className={big}>
            + Expense
          </a>
        </div>
      )}
      <p className="rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-700">
        Approved this month:{" "}
        <strong>
          field duty {a.fieldDutyDays} {a.fieldDutyDays === 1 ? "day" : "days"} · {kmText(a.kmTenths)} km
        </strong>{" "}
        · <strong>expenses {typedRupees(a.expensesPaise)}</strong>
        {v.waiting > 0 && <> · {v.waiting} waiting</>}
      </p>
      {v.claims.length === 0 ? (
        <Card>No claims in {fmtMonth(v.month)}.</Card>
      ) : (
        <ul className="space-y-2.5">
          {v.claims.map((c) => {
            const photos = v.photos[c.id] ?? [];
            const mayAddPhoto = c.kind === "expense" && c.status === "waiting" && c.createdBy === user.userId && now - c.createdAt.getTime() < ADD_PHOTOS_WITHIN_MS && photos.length < MAX_PHOTOS;
            return (
              <li key={c.id} className="space-y-1.5 rounded-2xl border border-slate-200 bg-white px-4 py-3">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-xs font-bold tracking-wide text-slate-600 uppercase">{claimHeading(c)}</span>
                  <StatusPill status={c.status} />
                </div>
                <p className="text-lg font-bold tabular-nums">{claimValue(c)}</p>
                <p className="text-sm break-words text-slate-700">
                  {c.note}
                  {photos.length > 0 && ` · ${photos.length} ${photos.length === 1 ? "photo" : "photos"}`}
                </p>
                {c.createdBy !== c.userId && <p className="text-xs text-slate-600">Entered by {c.createdByName}</p>}
                <DecisionLine c={c} />
                <Thumbs ids={photos} />
                {(c.status === "waiting" || mayAddPhoto) && (
                  <div className="flex flex-wrap gap-2 pt-1">
                    {mayAddPhoto && <AddPhoto claimId={c.id} left={MAX_PHOTOS - photos.length} />}
                    {c.status === "waiting" && <Withdraw claimId={c.id} />}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
      <p className="text-xs text-slate-600">Field duty doesn&apos;t mark you present. Approved claims are paid with that month&apos;s salary.</p>
    </div>
  );
}
