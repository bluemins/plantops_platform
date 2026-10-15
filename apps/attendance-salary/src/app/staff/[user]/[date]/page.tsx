import { notFound } from "next/navigation";
import { can } from "@/server/access";
import { dayFor } from "@/server/calendar";
import { dayStamp } from "@/server/fixes";
import { kit } from "@/server/kit";
import { orNotFound } from "@/server/pages";
import { requirePageUser } from "@/server/session";
import { DayView } from "../../../day-view";
import { Header } from "../../../header";
import { FixPanel, type FixMark } from "./fix-panel";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Owner: one person's day (mock-up "Owner · Person's day + Fix"). Support sees the day without Fix. */
export default async function PersonDayPage({ params }: { params: Promise<{ user: string; date: string }> }) {
  const { user: personId, date } = await params;
  const user = await requirePageUser(`/staff/${personId}/${date}`);
  if (!can(user, "see_everyone") || !UUID.test(personId)) notFound();
  const [plant, view, stamp] = await Promise.all([kit.branding(user.tenantId), orNotFound(dayFor(user, personId, date)), dayStamp(user, personId, date)]);
  // the marks the owner may cancel: every valid mark shown on this day
  const marks: FixMark[] = view.day.entries.flatMap((e) => {
    if (e.type === "cancelled") return [];
    if (e.type === "no_entry") return [{ id: e.mark.id, kind: e.mark.kind, at: e.mark.at.toISOString() }];
    const b = e.block;
    return [b.start, ...(b.end ? [b.end] : [])].map((m) => ({ id: m.id, kind: m.kind, at: m.at.toISOString() }));
  });
  return (
    <div className="space-y-4">
      <Header user={user} plant={plant} />
      <a href={`/staff/${personId}?m=${date.slice(0, 7)}`} className="flex min-h-11 items-center gap-1 font-semibold text-(--brand)">
        ‹ {view.name ?? "Person"} · month
      </a>
      <DayView day={view.day} />
      {can(user, "fix") && <FixPanel personId={personId} name={view.name ?? "This person"} day={date} today={view.today} stamp={stamp} marks={marks} />}
    </div>
  );
}
