import { notFound } from "next/navigation";
import { Card } from "@plantops/ui";
import { fmtMonth, istMonth } from "@/lib/days";
import { rupeesText } from "@/lib/salary";
import { can } from "@/server/access";
import { kit } from "@/server/kit";
import { orNotFound } from "@/server/pages";
import { salaryTab } from "@/server/salary-tab";
import { requirePageUser } from "@/server/session";
import { Header } from "../header";
import { OwnerNav } from "../owner-nav";
import { SalaryTable } from "./salary-table";
import { waitingClaims } from "@/server/claims";

type Search = Promise<Record<string, string | string[] | undefined>>;

const arrow = "grid h-11 w-11 place-items-center rounded-xl border border-slate-200 bg-white text-xl";

/** Owner (and PlantOps support, read-only): everyone's salary for a month (mock-ups 1 and 3), with the checking panel. */
export default async function SalaryPage({ searchParams }: { searchParams: Search }) {
  const user = await requirePageUser("/salary");
  if (!can(user, "salary_view")) notFound();
  const sp = await searchParams;
  const month = typeof sp.month === "string" ? sp.month : istMonth();
  const [plant, tab] = await Promise.all([kit.branding(user.tenantId), orNotFound(salaryTab(user, month))]);
  const t = tab.totals;
  // claims (docs/SALARY_EXTRAS_PHASE_PLAN.md mock-up 6): TA + DA + approved expenses of everyone this month
  const claimsPaise = t.taPaise + t.daPaise + t.expensesPaise;

  return (
    <div className="space-y-4">
      <Header user={user} plant={plant} />
      <OwnerNav user={user} current="salary" claimsWaiting={await waitingClaims(user)} />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="mr-1 text-xl font-bold">Salary</h1>
          <a href={`/salary?month=${tab.prev}`} aria-label="Previous month" className={arrow}>
            ‹
          </a>
          <span className="text-lg font-semibold">{fmtMonth(tab.month)}</span>
          {tab.next ? (
            <a href={`/salary?month=${tab.next}`} aria-label="Next month" className={arrow}>
              ›
            </a>
          ) : (
            <span className="h-11 w-11" aria-hidden="true" />
          )}
          <span className={`rounded-full px-3 py-1 text-sm font-semibold ${tab.complete ? "bg-emerald-50 text-emerald-800" : "bg-amber-50 text-amber-900"}`}>
            {tab.complete ? `Month complete · ${tab.monthLength} days` : `So far · ${tab.daysOver} of ${tab.monthLength} days`}
          </span>
        </div>
        {can(user, "salary_export") && tab.rows.length > 0 && (
          <a href={`/api/salary/export?month=${tab.month}`} className="flex min-h-11 items-center rounded-xl border border-slate-300 bg-white px-4 font-semibold">
            Download CSV
          </a>
        )}
      </div>

      {tab.claimsWaiting > 0 && (
        <a href={`/claims?month=${tab.month}&status=waiting`} className="flex min-h-12 items-center justify-between gap-3 rounded-xl bg-amber-100 px-4 font-bold text-amber-950">
          <span>
            {tab.claimsWaiting} {tab.claimsWaiting === 1 ? "claim" : "claims"} waiting for {fmtMonth(tab.month).split(" ")[0]}
          </span>
          <span>Review ›</span>
        </a>
      )}

      {tab.rows.length === 0 ? (
        <Card>No one has a salary for {fmtMonth(tab.month)}. Set one on a person&apos;s Staff page.</Card>
      ) : (
        <>
          <div className={`grid grid-cols-1 gap-3 sm:grid-cols-2 ${claimsPaise ? "lg:grid-cols-5" : "lg:grid-cols-4"}`}>
            {(
              [
                ["Salary earned", t.earnedPaise],
                ["Overtime pay", t.otPayPaise],
                ...(claimsPaise ? ([["TA + DA + expenses", claimsPaise]] as const) : []),
                ["Advances taken", t.advancesPaise],
              ] as const
            ).map(([label, v]) => (
              <div key={label} className="hidden rounded-2xl border border-slate-200 bg-white p-4 sm:block">
                <p className="text-sm text-slate-600">{label}</p>
                <p className="mt-1 text-2xl font-bold tabular-nums">{rupeesText(v)}</p>
              </div>
            ))}
            <div className="rounded-2xl bg-(--brand) p-4 text-(--brand-contrast)">
              <p className="text-sm">Remaining to pay</p>
              <p className="mt-1 text-3xl font-extrabold tabular-nums">{rupeesText(t.toPayPaise)}</p>
              <p className="mt-1 text-xs sm:hidden">
                Earned {rupeesText(t.earnedPaise)} · OT {rupeesText(t.otPayPaise)}
                {claimsPaise ? ` · Claims ${rupeesText(claimsPaise)}` : ""} · Advances {rupeesText(t.advancesPaise)}
              </p>
              {tab.paidPaise > 0 && (
                <p className="mt-1 text-xs">
                  Paid {rupeesText(tab.paidPaise)} · still to pay {rupeesText(tab.stillToPayPaise)}
                </p>
              )}
              {tab.negatives.map((n) => (
                <p key={n.name} className="text-xs">
                  {n.name} {rupeesText(n.remainingPaise)} carries to {fmtMonth(n.to).split(" ")[0]}
                </p>
              ))}
            </div>
          </div>
          <SalaryTable tab={tab} canPay={can(user, "salary_pay")} />
        </>
      )}

      <div className="space-y-1 text-sm text-slate-600">
        {tab.noSalary === null ? (
          <p>PlantOps can&apos;t be reached right now, so people without a salary can&apos;t be listed.</p>
        ) : (
          tab.noSalary.length > 0 && (
            <p>
              No salary set:{" "}
              {tab.noSalary.map((p, i) => (
                <span key={p.userId}>
                  {i > 0 && ", "}
                  <a href={`/staff/${p.userId}?m=${tab.month}`} className="font-semibold text-(--brand) underline">
                    {p.name}
                  </a>
                </span>
              ))}
              . Set one on their Staff page.
            </p>
          )
        )}
        {tab.rows.length > 0 && <p>— = not on overtime. Figures are worked out from the marks each time the page opens.</p>}
      </div>
    </div>
  );
}
