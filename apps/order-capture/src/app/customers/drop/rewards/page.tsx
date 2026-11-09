import { redirect } from "next/navigation";
import { STATE_LABEL } from "@/lib/points";
import { can } from "@/server/access";
import { rewardsList } from "@/server/drop/points";
import { kit } from "@/server/kit";
import { requirePageUser } from "@/server/session";
import { Header } from "../../../header";
import { BackLink } from "../../../parts";
import { CancelReward } from "./cancel";

const when = (iso: string) => new Date(iso).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit", timeZone: "Asia/Kolkata" });

/** Owner + Order desk (support reads): free boxes shops asked for with Drop points. */
export default async function RewardsPage() {
  const user = await requirePageUser("/customers/drop/rewards");
  if (!can(user, "drop_rewards_view")) redirect("/");
  const [plant, data] = await Promise.all([kit.branding(user.tenantId), rewardsList(user)]);
  const mayCancel = can(user, "drop_rewards");
  return (
    <div className="space-y-4 pb-8">
      <Header user={user} plant={plant} />
      <BackLink href="/customers">← Customers</BackLink>
      <h1 className="text-2xl font-bold">Free boxes asked</h1>
      <p className="text-sm text-slate-600">
        Shops ask for these in the Drop app with their points. Add one to the shop&apos;s next order (New order shows it, or the order page). It is never charged and never on the
        bill. The points are spent when that order is delivered.
      </p>
      {data.open.length === 0 ? (
        <p className="rounded-xl border border-slate-200 bg-white p-4 text-sm text-slate-600">No free box waiting.</p>
      ) : (
        <ul className="space-y-3">
          {data.open.map((r) => (
            <li key={r.id} className="space-y-2 rounded-xl border border-violet-300 bg-white p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <a href={`/customers/${r.customer_id}/drop`} className="font-semibold text-(--brand) hover:underline">{r.shop}</a>
                  <p className="text-sm text-slate-600">{r.place} · asked {when(r.asked_at)}</p>
                </div>
                <span className="shrink-0 rounded-full bg-violet-100 px-2.5 py-0.5 text-sm text-violet-900">{STATE_LABEL[r.state]}</span>
              </div>
              <p>🎁 {r.label} × 1 · {r.points.toLocaleString("en-IN")} points</p>
              {r.order ? (
                <p className="text-sm">
                  On order <a href={`/o/${r.order.id}`} className="font-semibold text-(--brand) hover:underline">{r.order.ref}</a>
                  {r.added_by ? ` (added by ${r.added_by})` : ""}
                </p>
              ) : (
                <p className="text-sm text-amber-800">Not on an order yet.</p>
              )}
              {mayCancel && <CancelReward id={r.id} />}
            </li>
          ))}
        </ul>
      )}
      {data.done.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-sm font-semibold">Done</h2>
          <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200 bg-white text-sm">
            {data.done.map((r) => (
              <li key={r.id} className="flex items-start justify-between gap-3 p-3">
                <div className="min-w-0">
                  <p className="font-semibold">{r.shop}</p>
                  <p className="text-slate-600">
                    {r.label} · {r.points.toLocaleString("en-IN")} points · {when(r.asked_at)}
                    {r.order ? ` · ${r.order.ref}` : ""}
                    {r.cancel_reason ? ` · ${r.cancel_reason} (${r.cancelled_by})` : ""}
                  </p>
                </div>
                <span className="shrink-0 text-slate-600">{STATE_LABEL[r.state]}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
