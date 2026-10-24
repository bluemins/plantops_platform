import { kit } from "@/server/kit";
import { orNotFound } from "@/server/pages";
import { mySlip } from "@/server/salary-slip";
import { requirePageUser } from "@/server/session";
import { Header } from "../../../header";
import { MyTabs, myTabs } from "../../../my-tabs";
import { slipCard } from "../../../slip-card";

/**
 * A worker's salary slip for one paid month (mock-up 7): ONLY the figures frozen when the owner marked it paid. Only
 * with "Can see own salary", only their own, only paid (not undone) months; 404 in every other case.
 */
export default async function MySlipPage({ params }: { params: Promise<{ month: string }> }) {
  const { month } = await params;
  const user = await requirePageUser(`/my/salary/${month}`);
  const [plant, slip] = await Promise.all([kit.branding(user.tenantId), orNotFound(mySlip(user, month))]);
  return (
    <div className="space-y-4">
      <Header user={user} plant={plant} />
      <MyTabs {...await myTabs(user)} current="salary" />
      {slipCard({ month, figures: slip.figures, payment: slip })}
      <a href="/my/salary" className="block text-sm font-semibold text-(--brand)">
        ‹ All paid months
      </a>
    </div>
  );
}
