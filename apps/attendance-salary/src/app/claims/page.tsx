import { Card } from "@plantops/ui";
import { fmtMonth } from "@/lib/days";
import { can } from "@/server/access";
import { claimsTab, waitingClaims, type ClaimFilter } from "@/server/claims";
import { kit } from "@/server/kit";
import { orNotFound } from "@/server/pages";
import { requirePageUser } from "@/server/session";
import { Header } from "../header";
import { OwnerNav } from "../owner-nav";
import { OwnerClaimCard } from "./owner-claim";

type Search = Promise<Record<string, string | string[] | undefined>>;
const one = (v: string | string[] | undefined) => (typeof v === "string" ? v : null);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The owner's Claims tab (docs/SALARY_EXTRAS_PHASE_PLAN.md mock-up 5): one month's claims of everyone, Waiting first by
 * default, filtered by status and person; Approve / Not approve / Cancel. PlantOps support: read-only, logged. A
 * worker: 404 (access table), so nothing hints this page exists.
 */
export default async function ClaimsPage({ searchParams }: { searchParams: Search }) {
  const sp = await searchParams;
  const user = await requirePageUser("/claims");
  const person = one(sp.person);
  const [plant, tab, waiting] = await Promise.all([
    kit.branding(user.tenantId),
    orNotFound(claimsTab(user, { month: one(sp.month), status: one(sp.status), personId: person && UUID.test(person) ? person : null })),
    waitingClaims(user),
  ]);
  const link = (over: Partial<{ month: string; status: ClaimFilter; person: string | null }>) => {
    const q = new URLSearchParams({ month: over.month ?? tab.month, status: over.status ?? tab.status });
    const p = over.person === undefined ? tab.personId : over.person;
    if (p) q.set("person", p);
    return `/claims?${q}`;
  };
  const pill = (on: boolean) => `flex min-h-10 items-center rounded-full px-4 text-sm font-semibold whitespace-nowrap ${on ? "bg-(--brand) text-(--brand-contrast)" : "border border-slate-200 bg-white text-slate-800"}`;
  const arrow = "flex min-h-11 min-w-11 items-center justify-center rounded-full border border-slate-200 bg-white text-lg font-semibold";
  const filters: [ClaimFilter, string][] = [
    ["waiting", `Waiting (${tab.counts.waiting})`],
    ["approved", "Approved"],
    ["rejected", "Not approved"],
    ["all", "All"],
  ];
  const canDecide = can(user, "claim_decide");
  return (
    <div className="space-y-4">
      <Header user={user} plant={plant} />
      <OwnerNav user={user} current="claims" claimsWaiting={waiting} />
      <div className="flex items-center justify-between gap-2">
        <a href={link({ month: tab.prev })} aria-label="Previous month" className={arrow}>
          ‹
        </a>
        <h1 className="text-xl font-bold">{fmtMonth(tab.month)}</h1>
        {tab.next ? (
          <a href={link({ month: tab.next })} aria-label="Next month" className={arrow}>
            ›
          </a>
        ) : (
          <span className={`${arrow} text-slate-300`} aria-hidden="true">
            ›
          </span>
        )}
      </div>
      <nav aria-label="Which claims" className="flex flex-wrap gap-1.5">
        {filters.map(([f, text]) => (
          <a key={f} href={link({ status: f })} aria-current={tab.status === f ? "page" : undefined} className={pill(tab.status === f)}>
            {text}
          </a>
        ))}
      </nav>
      {tab.people.length > 1 && (
        <nav aria-label="Person" className="flex flex-wrap gap-1.5">
          <a href={link({ person: null })} className={pill(!tab.personId)}>
            Everyone
          </a>
          {tab.people.map((p) => (
            <a key={p.userId} href={link({ person: p.userId })} className={pill(tab.personId === p.userId)}>
              {p.name}
            </a>
          ))}
        </nav>
      )}
      {tab.claims.length === 0 ? (
        <Card>{tab.status === "waiting" ? `Nothing waiting for ${fmtMonth(tab.month)}.` : `No claims here for ${fmtMonth(tab.month)}.`}</Card>
      ) : (
        <ul className="space-y-2.5">
          {tab.claims.map((c) => (
            <OwnerClaimCard key={c.id} c={c} canDecide={canDecide} />
          ))}
        </ul>
      )}
      <p className="text-xs text-slate-600">Approved claims are added to that month&apos;s salary. An approved claim can be cancelled later with a reason.</p>
    </div>
  );
}
