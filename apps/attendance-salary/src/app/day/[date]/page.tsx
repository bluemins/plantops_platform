import { dayFor } from "@/server/calendar";
import { kit } from "@/server/kit";
import { orNotFound } from "@/server/pages";
import { requirePageUser } from "@/server/session";
import { DayView } from "../../day-view";
import { Header } from "../../header";

/** Your own day (mock-up "Worker · One day"). Only ever your own: no person in the address. */
export default async function DayPage({ params }: { params: Promise<{ date: string }> }) {
  const { date } = await params;
  const user = await requirePageUser(`/day/${date}`);
  const [plant, view] = await Promise.all([kit.branding(user.tenantId), orNotFound(dayFor(user, user.userId, date))]);
  const back = user.isOwner ? `/my?m=${date.slice(0, 7)}` : `/?m=${date.slice(0, 7)}`;
  return (
    <div className="space-y-4">
      <Header user={user} plant={plant} />
      <a href={back} className="flex min-h-11 items-center gap-1 font-semibold text-(--brand)">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="m15 18-6-6 6-6" />
        </svg>
        Back to the month
      </a>
      <DayView day={view.day} />
      <p className="px-1 text-sm text-slate-500">Something wrong? Tell the owner. Only the owner can add or cancel a time.</p>
    </div>
  );
}
