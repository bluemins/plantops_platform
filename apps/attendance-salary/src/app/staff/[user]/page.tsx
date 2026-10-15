import { notFound } from "next/navigation";
import { can } from "@/server/access";
import { monthFor } from "@/server/calendar";
import { kit } from "@/server/kit";
import { orNotFound } from "@/server/pages";
import { requirePageUser } from "@/server/session";
import { CalendarKey, MonthCalendar } from "../../calendar";
import { Header } from "../../header";

type Search = Promise<Record<string, string | string[] | undefined>>;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Owner (and support): one person's month; a tap opens that day with Fix. */
export default async function PersonMonthPage({ params, searchParams }: { params: Promise<{ user: string }>; searchParams: Search }) {
  const { user: personId } = await params;
  const user = await requirePageUser(`/staff/${personId}`);
  if (!can(user, "see_everyone") || !UUID.test(personId)) notFound();
  const sp = await searchParams;
  const [plant, view] = await Promise.all([kit.branding(user.tenantId), orNotFound(monthFor(user, personId, typeof sp.m === "string" ? sp.m : null))]);
  return (
    <div className="space-y-4">
      <Header user={user} plant={plant} />
      <a href="/staff" className="flex min-h-11 items-center gap-1 font-semibold text-(--brand)">
        ‹ Staff
      </a>
      <h1 className="text-xl font-bold">{view.name}</h1>
      <MonthCalendar view={view} dayHref={(d) => `/staff/${personId}/${d}`} monthHref={(m) => `/staff/${personId}?m=${m}`} />
      <CalendarKey />
    </div>
  );
}
