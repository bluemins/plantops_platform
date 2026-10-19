import { notFound } from "next/navigation";
import { can } from "@/server/access";
import { dayFor } from "@/server/calendar";
import { personDayMarks } from "@/server/day-marks";
import { dayStamp } from "@/server/fixes";
import { kit } from "@/server/kit";
import { orNotFound } from "@/server/pages";
import { requirePageUser } from "@/server/session";
import { DayView } from "../../../day-view";
import { Header } from "../../../header";
import { DayMarkPanel } from "./day-mark-panel";
import { FixPanel, type FixMark } from "./fix-panel";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Owner, Office staff and a Supervisor (Office staff only, owner 2026-10-19): one person's day (mock-up "Owner · Person's day + Fix"). Support sees the day without Fix;
 * Office staff and Supervisors get no Fix on their own day (the server refuses it too).
 */
export default async function PersonDayPage({ params }: { params: Promise<{ user: string; date: string }> }) {
  const { user: personId, date } = await params;
  const user = await requirePageUser(`/staff/${personId}/${date}`);
  if (!(can(user, "see_everyone") || can(user, "see_office_staff")) || !UUID.test(personId)) notFound();
  const [plant, view, stamp, dayMarksMap] = await Promise.all([kit.branding(user.tenantId), orNotFound(dayFor(user, personId, date)), dayStamp(user, personId, date), personDayMarks(user, personId, date, date)]);
  const dayMark = dayMarksMap.get(date) ?? null;
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
      {/* the owner's whole-day ON / OFF (docs/DAY_MARKS_PLAN.md); others see the mark only */}
      <DayMarkPanel personId={personId} name={view.name ?? "This person"} day={date} mark={dayMark} canMark={can(user, "day_mark")} />
      {can(user, "fix") && (user.isOwner || personId !== user.userId) && <FixPanel personId={personId} name={view.name ?? "This person"} day={date} today={view.today} stamp={stamp} marks={marks} />}
    </div>
  );
}
