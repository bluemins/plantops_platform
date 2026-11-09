import { HolidayDayInput, removeHoliday } from "@/server/holidays";
import { handle, json, readJson } from "@/server/http";
import { requireApiUser } from "@/server/session";

/** Owner only: takes a day off one person's holiday list (rule 24). */
export const POST = handle(async (req) => {
  const user = await requireApiUser();
  return json(await removeHoliday(user, await readJson(req, HolidayDayInput)));
});
