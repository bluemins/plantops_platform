import { fmtMonth } from "@/lib/days";
import { kit } from "@/server/kit";
import { orNotFound } from "@/server/pages";
import { slipPreview } from "@/server/salary-slip";
import { requirePageUser } from "@/server/session";
import { Header } from "../../../../header";
import { slipCard } from "../../../../slip-card";

/**
 * Owner's "See as worker" (owner 2026-10-24): the person's slip for the month exactly as their My salary page draws it,
 * with a note on whether they can see it. Before the month is paid it shows what "Mark paid" would save now. Owner
 * and PlantOps support only (404 for everyone else, as for any salary page).
 */
export default async function SlipPreviewPage({ params }: { params: Promise<{ user: string; month: string }> }) {
  const { user: personId, month } = await params;
  const user = await requirePageUser(`/staff/${personId}/slip/${month}`);
  const [plant, p] = await Promise.all([kit.branding(user.tenantId), orNotFound(slipPreview(user, personId, month))]);
  const paid = !("preview" in p.payment);
  return (
    <div className="space-y-4">
      <Header user={user} plant={plant} />
      <a href={`/staff/${personId}?m=${month}`} className="flex min-h-11 items-center gap-1 font-semibold text-(--brand)">
        ‹ {p.name}
      </a>
      <section className="space-y-1.5 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
        <p className="font-bold">
          Preview: {p.name}&apos;s slip for {fmtMonth(month)} as they see it
        </p>
        {p.canSee ? (
          <p>&quot;Can see own salary&quot; is ticked: {paid ? "they can see this slip now." : "they will see this once you mark the month paid."}</p>
        ) : (
          <p>&quot;Can see own salary&quot; is not ticked: {p.name} can&apos;t see any salary. Tick it on their page to show slips of paid months.</p>
        )}
        {!paid && <p>Not paid yet: these are today&apos;s figures, the same ones &quot;Mark paid&quot; would save now.</p>}
        {!p.complete && <p>The month isn&apos;t over: days still to come aren&apos;t counted yet.</p>}
        <p>Advance and expense notes are shown to the worker as typed.</p>
      </section>
      {slipCard({ month, figures: p.figures, payment: p.payment })}
    </div>
  );
}
