import { DayMarkInput, setDayMark } from "@/server/day-marks";
import { handle, json, readJson } from "@/server/http";
import { requireApiUser } from "@/server/session";

/** Owner only: mark one person's whole day ON (present), OFF (day off without pay) or Clear; no times, no reason (docs/DAY_MARKS_PLAN.md). */
export const POST = handle(async (req) => {
  const user = await requireApiUser();
  return json(await setDayMark(user, await readJson(req, DayMarkInput)), { status: 201 });
});
