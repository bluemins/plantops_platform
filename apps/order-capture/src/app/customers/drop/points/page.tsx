import { redirect } from "next/navigation";
import { can } from "@/server/access";
import { pointsSettingsView } from "@/server/drop/points";
import { kit } from "@/server/kit";
import { requirePageUser } from "@/server/session";
import { Header } from "../../../header";
import { BackLink } from "../../../parts";
import { PointsSettingsForm } from "./form";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const when = (iso: string) => new Date(iso).toLocaleString("en-IN", { day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit", timeZone: "Asia/Kolkata" });

/** Owner (support reads): the Drop points settings and their history. Points are separate from billing. */
export default async function PointsSettingsPage() {
  const user = await requirePageUser("/customers/drop/points");
  if (!can(user, "drop_points_view")) redirect("/customers");
  const [plant, view] = await Promise.all([kit.branding(user.tenantId), pointsSettingsView(user)]);
  return (
    <div className="space-y-4 pb-8">
      <Header user={user} plant={plant} />
      <BackLink href="/customers">← Customers</BackLink>
      <h1 className="text-2xl font-bold">Drop points settings</h1>
      <p className="text-sm text-slate-600">
        Shops earn points for paying for {view.main_brand ?? "the main brand"} on PlantOps bills: the value before GST, after discounts. Points are worked out from bills and
        payments; they never change a bill.
      </p>
      {can(user, "drop_points_settings") ? (
        <PointsSettingsForm view={view} />
      ) : (
        <div className="space-y-1 rounded-xl border border-slate-200 bg-white p-4 text-sm">
          <p>Start date: {view.current.start_date ?? "not set (points off)"}</p>
          <p>₹ per point: {view.current.rupees_per_point} · paid within {view.current.late_days} days of delivery · poll {view.current.poll_points} points</p>
          <p>Free-box months: {view.current.redeem_months.map((m) => MONTHS[m - 1]).join(", ") || "none"}</p>
          {view.current.rewards.map((r) => <p key={r.sku_id}>{r.label}: {r.points.toLocaleString("en-IN")} points</p>)}
        </div>
      )}
      <section className="space-y-2">
        <h2 className="text-sm font-semibold">History</h2>
        {view.history.length === 0 ? (
          <p className="text-sm text-slate-600">Not saved yet: points are off.</p>
        ) : (
          <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200 bg-white text-sm">
            {view.history.map((h, i) => (
              <li key={i} className="space-y-0.5 p-3">
                <p className="font-semibold">From {h.effective_from} · {h.by}, {when(h.at)}</p>
                <p className="text-slate-600">
                  Start {h.start_date ?? "—"} · ₹{h.rupees_per_point} a point · {h.late_days} days · poll {h.poll_points} · months {h.redeem_months.map((m) => MONTHS[m - 1]).join(", ") || "none"}
                </p>
                <p className="text-slate-600">{h.rewards.map((r) => `${r.label} ${r.points.toLocaleString("en-IN")}`).join(" · ") || "no free boxes"}</p>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
