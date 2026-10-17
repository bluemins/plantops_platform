import { asksDa, kmText, type ClaimStatus } from "@/lib/salary";
import type { ClaimRow } from "@/server/claims";

/** "18 Oct" */
export const shortDay = (ymd: string) => new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(`${ymd}T00:00:00Z`));
/** "₹450", "₹1,200.50": an amount someone typed, exact. */
export const typedRupees = (paise: number) => `₹${(paise / 100).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;

const PILL: Record<ClaimStatus, [string, string]> = {
  waiting: ["Waiting", "bg-amber-100 text-amber-950"],
  approved: ["Approved", "bg-emerald-100 text-emerald-900"],
  rejected: ["Not approved", "bg-red-100 text-red-900"],
  withdrawn: ["Withdrawn", "bg-slate-200 text-slate-700"],
  cancelled: ["Cancelled", "bg-red-100 text-red-900"],
};

export function StatusPill({ status }: { status: ClaimStatus }) {
  const [text, tone] = PILL[status];
  return <span className={`rounded-full px-2.5 py-0.5 text-xs font-bold whitespace-nowrap ${tone}`}>{text}</span>;
}

/** "Field duty · 18 Oct" / "Expense · 16 Oct" */
export const claimHeading = (c: ClaimRow) => `${c.kind === "field_duty" ? "Field duty" : "Expense"} · ${shortDay(c.onDate)}`;
/** "42 km · DA asked" / "42 km · no DA" / "₹450": what the person typed (never TA / DA rupees). */
export const claimValue = (c: ClaimRow) => (c.kind === "field_duty" ? `${kmText(c.kmTenths ?? 0)} km · ${asksDa(c) ? "DA asked" : "no DA"}` : typedRupees(c.amountPaise ?? 0));

/** The reason line under a "not approved" or "cancelled" claim. */
export function DecisionLine({ c }: { c: ClaimRow }) {
  if (c.status === "rejected" || c.status === "cancelled") {
    return (
      <p className="text-sm text-red-800">
        {c.status === "rejected" ? "Not approved" : "Cancelled"} by {c.decidedByName}: “{c.reason}”
      </p>
    );
  }
  return null;
}

/** Small photo thumbnails, each opening the full photo. */
export function Thumbs({ ids }: { ids: string[] }) {
  if (ids.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-2">
      {ids.map((id, i) => (
        <a key={id} href={`/claim-photos/${id}`} target="_blank" rel="noopener" className="block h-16 w-16 overflow-hidden rounded-lg border border-slate-200 bg-slate-100">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={`/claim-photos/${id}`} alt={`Bill photo ${i + 1}`} className="h-full w-full object-cover" />
        </a>
      ))}
    </div>
  );
}
