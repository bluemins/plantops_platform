import { istDay } from "@/lib/days";
import { fmtTime } from "@/lib/punch";
import { asksDa, kmText, paiseText } from "@/lib/salary";
import type { OwnerClaim } from "@/server/claims";
import { claimHeading, claimValue, DecisionLine, shortDay, StatusPill, Thumbs } from "../claim-bits";
import { Decide } from "./decide";

const DONE = { approved: "approved", rejected: "not approved", withdrawn: "withdrawn", cancelled: "cancelled" } as const;

/**
 * One claim as the owner sees it (mock-up 5): person, date, kind, km with "TA ₹126 (42 km × ₹3) · DA ₹150" at that
 * person's rates (or "no TA rate"), or the amount with the bill photos; the note; who entered it and when. With
 * `canDecide`: Approve / Not approve (waiting) or Cancel (approved).
 */
export function OwnerClaimCard({ c, canDecide, showName = true }: { c: OwnerClaim; canDecide: boolean; showName?: boolean }) {
  const duty = c.kind === "field_duty";
  const rates: string[] = [];
  if (duty) {
    rates.push(c.taPaise !== null ? `TA ${paiseText(c.taPaise)} (${kmText(c.kmTenths ?? 0)} km × ${paiseText(c.kmRatePaise ?? 0)})` : "no TA rate");
    rates.push(!asksDa(c) ? "no DA asked" : c.daPaise !== null ? `DA ${paiseText(c.daPaise)}` : "no DA rate");
  }
  const sent = `${c.createdBy === c.userId ? "Sent" : `Entered by ${c.createdByName}`} ${shortDay(istDay(c.createdAt))}, ${fmtTime(c.createdAt)}`;
  return (
    <li className={`space-y-2 rounded-2xl border bg-white px-4 py-3 ${c.status === "waiting" ? "border-amber-300" : "border-slate-200"}`}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        {showName ? <strong className="text-base">{c.userName}</strong> : <span />}
        <span className="flex items-center gap-2">
          <span className="text-xs font-bold tracking-wide text-slate-600 uppercase">{claimHeading(c)}</span>
          <StatusPill status={c.status} />
        </span>
      </div>
      <p className="break-words">
        <strong className="tabular-nums">{claimValue(c)}</strong> · {c.note}
      </p>
      {duty && <p className="rounded-lg bg-emerald-50 px-2.5 py-1.5 text-sm text-emerald-900">{rates.join(" · ")}</p>}
      <Thumbs ids={c.photoIds} />
      <p className="text-xs text-slate-600">
        {sent}
        {c.status !== "waiting" && c.decidedByName && ` · ${DONE[c.status]} by ${c.decidedByName}`}
      </p>
      <DecisionLine c={c} />
      {canDecide && (c.status === "waiting" || c.status === "approved") && <Decide claimId={c.id} status={c.status} name={c.userName} />}
    </li>
  );
}
