import { fmtDayLong } from "@/lib/days";
import { myFieldDay } from "@/server/field";
import { kit } from "@/server/kit";
import { orNotFound } from "@/server/pages";
import { requirePageUser } from "@/server/session";
import { Header } from "../../header";
import { MyTabs, myTabs } from "../../my-tabs";
import { FieldDayScreen } from "./field-day";

/**
 * My field day (docs/FIELD_DAY_PHASE_PLAN.md mock-ups A1–A7): start, shops visited and end of today's round, on the
 * person's own phone. Only with the owner's Field staff tick (404 otherwise). After midnight it shows last night's
 * round until it is ended. The location is taken only when they tap Start, Shop visited or End.
 */
export default async function MyFieldPage() {
  const user = await requirePageUser("/my/field");
  const [plant, v] = await Promise.all([kit.branding(user.tenantId), orNotFound(myFieldDay(user))]);
  return (
    <div className="space-y-4">
      <Header user={user} plant={plant} />
      <MyTabs {...await myTabs(user)} current="field" />
      <FieldDayScreen v={v} dayLabel={fmtDayLong(v.day.date)} lastNight={v.day.date !== v.today} />
    </div>
  );
}
