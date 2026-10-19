import { notFound } from "next/navigation";
import { can } from "@/server/access";
import { personClaims } from "@/server/claims";
import { monthFor } from "@/server/calendar";
import { kit } from "@/server/kit";
import { advancePanel, fromMonthChoices, salaryPanel } from "@/server/salary-edit";
import { monthStatuses } from "@/server/salary";
import { orNotFound } from "@/server/pages";
import { requirePageUser } from "@/server/session";
import { CalendarKey, MonthCalendar } from "../../calendar";
import { Header } from "../../header";
import { Advances } from "./advances";
import { PersonClaims } from "./claims";
import { SalaryBox, SalaryReadOnly, VisibilityTick } from "./salary-box";
import { SalaryStrip } from "./salary-strip";

type Search = Promise<Record<string, string | string[] | undefined>>;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Owner, Office staff (no salary parts), a Supervisor (Office staff only, attendance only) and support: one person's month; a tap opens that day with Fix. Below the calendar, the salary sections for
 * the same month (mock-up 2): summary strip, Salary box + history, Can see own salary, advances. Support: read-only.
 */
export default async function PersonMonthPage({ params, searchParams }: { params: Promise<{ user: string }>; searchParams: Search }) {
  const { user: personId } = await params;
  const user = await requirePageUser(`/staff/${personId}`);
  if (!(can(user, "see_everyone") || can(user, "see_office_staff")) || !UUID.test(personId)) notFound();
  const sp = await searchParams;
  const [plant, view] = await Promise.all([kit.branding(user.tenantId), orNotFound(monthFor(user, personId, typeof sp.m === "string" ? sp.m : null))]);
  const salary = can(user, "salary_view") ? await salaryPanel(user, personId, view.month) : null;
  const claims = can(user, "claim_view") ? await personClaims(user, personId, view.month) : null;
  // Office staff: advances and "still to recover" only, never a salary (docs/ATTENDANCE_ROLES_PHASE_PLAN.md mock-up 2)
  const advances = !salary && can(user, "advance_view") ? await advancePanel(user, personId, view.month) : null;
  const statuses = await monthStatuses(user, personId, view.month, new Map(view.days.map((d) => [d.date, d])));
  const name = view.name ?? "This person";
  return (
    <div className="space-y-4">
      <Header user={user} plant={plant} />
      <a href="/staff" className="flex min-h-11 items-center gap-1 font-semibold text-(--brand)">
        ‹ {can(user, "see_everyone") ? "Staff" : "Office staff"}
      </a>
      <h1 className="text-xl font-bold">{view.name}</h1>
      <MonthCalendar view={view} dayHref={(d) => `/staff/${personId}/${d}`} monthHref={(m) => `/staff/${personId}?m=${m}`} statuses={statuses} />
      <CalendarKey statuses={statuses} />
      {salary && (
        <>
          <SalaryStrip month={salary.month} figures={salary.figures} />
          {can(user, "salary_edit") ? (
            <>
              <SalaryBox personId={personId} applies={salary.applies} history={salary.history} thisMonth={salary.thisMonth} months={fromMonthChoices(salary.thisMonth)} expect={salary.expect.setting} />
              <VisibilityTick personId={personId} name={name} canSee={salary.canSee} expect={salary.expect.visibility} />
            </>
          ) : (
            <SalaryReadOnly applies={salary.applies} history={salary.history} canSee={salary.canSee} name={name} />
          )}
          <Advances personId={personId} month={salary.month} today={salary.today} firstDate={salary.firstAdvanceDate} entries={salary.advances} expect={salary.expect.advance} editable={can(user, "salary_edit")} />
          {claims && salary.history.length > 0 && <PersonClaims personId={personId} month={salary.month} claims={claims} canDecide={can(user, "claim_decide")} />}
        </>
      )}
      {advances && (
        <Advances
          personId={personId}
          month={advances.month}
          today={advances.today}
          firstDate={advances.firstAdvanceDate}
          entries={advances.advances}
          expect={advances.expect}
          editable={can(user, "advance_add") && personId !== user.userId}
          correctable={advances.correctable}
          stillToRecoverPaise={advances.stillToRecoverPaise}
          office
        />
      )}
    </div>
  );
}
