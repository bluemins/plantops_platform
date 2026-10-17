import { fmtMonth } from "@/lib/days";
import type { OwnerClaim } from "@/server/claims";
import { OwnerClaimCard } from "../../claims/owner-claim";

/**
 * "Claims · <month>" on Staff → person, under Advances (docs/SALARY_EXTRAS_PHASE_PLAN.md "Owner: Claims tab"): the
 * person's claims with Approve / Not approve / Cancel, and "+ Field duty" / "+ Expense" for the owner to enter one
 * on their behalf (approved at once). Support: read-only, no buttons.
 */
export function PersonClaims({ personId, month, claims, canDecide }: { personId: string; month: string; claims: OwnerClaim[]; canDecide: boolean }) {
  const add = "flex min-h-11 items-center justify-center rounded-xl border border-slate-300 bg-white px-4 font-semibold";
  return (
    <section aria-labelledby="claims-h" className="space-y-3 rounded-2xl border border-slate-200 bg-white p-4">
      <h2 id="claims-h" className="text-lg font-bold">
        Claims · {fmtMonth(month)}
      </h2>
      {claims.length === 0 ? (
        <p className="text-sm text-slate-600">No field duty or expenses in {fmtMonth(month)}.</p>
      ) : (
        <ul className="space-y-2.5">
          {claims.map((c) => (
            <OwnerClaimCard key={c.id} c={c} canDecide={canDecide} showName={false} />
          ))}
        </ul>
      )}
      {canDecide && (
        <div className="grid grid-cols-2 gap-2.5 sm:max-w-md">
          <a href={`/staff/${personId}/claims/new?kind=field_duty`} className={add}>
            + Field duty
          </a>
          <a href={`/staff/${personId}/claims/new?kind=expense`} className={add}>
            + Expense
          </a>
        </div>
      )}
    </section>
  );
}
