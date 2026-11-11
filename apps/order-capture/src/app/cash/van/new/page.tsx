import { redirect } from "next/navigation";
import { Card } from "@plantops/ui";
import { can } from "@/server/access";
import { daySheet, istToday } from "@/server/cash";
import { kit } from "@/server/kit";
import { requirePageUser } from "@/server/session";
import { vanForm } from "@/server/van";
import { Header } from "../../../header";
import { BackLink } from "../../../parts";
import { longDay } from "../../parts";
import { VanReportForm } from "../van-form";

type Search = Promise<Record<string, string | string[] | undefined>>;

/** + Van report (owner, Accounts) for a cash day after the last close. */
export default async function NewVanReportPage({ searchParams }: { searchParams: Search }) {
  const user = await requirePageUser("/cash/van/new");
  if (!can(user, "cash_enter")) redirect("/cash");
  const today = istToday();
  const d = (await searchParams).d;
  const date = typeof d === "string" && /^\d{4}-\d{2}-\d{2}$/.test(d) && d <= today ? d : today;
  const [plant, sheet, form] = await Promise.all([kit.branding(user.tenantId), daySheet(user, date, today), vanForm(user)]);
  return (
    <div className="space-y-4">
      <Header user={user} plant={plant} />
      <BackLink href={`/cash?d=${date}`}>← Day sheet</BackLink>
      <h1 className="text-2xl font-bold">Van report</h1>
      <p className="text-sm text-slate-600">Cash comes into the cash book on <b>{longDay(date)}</b>.</p>
      {!sheet.started ? (
        <Card><p className="text-sm text-slate-600">The cash book hasn&apos;t been started yet.</p></Card>
      ) : !sheet.can_enter ? (
        <Card><p className="text-sm text-slate-600">This day is closed or too far back. Use today&apos;s sheet (the trip day can be earlier).</p></Card>
      ) : (
        <VanReportForm date={date} form={form} />
      )}
    </div>
  );
}
