import { DayMarksInput, setDayMarks } from "@/server/day-marks";
import { handle, json, readJson } from "@/server/http";
import { requireApiUser } from "@/server/session";

/** Owner only: "Mark days" on a person's month: one mark (ON / OFF / Clear) for several days, all saved or none. */
export const POST = handle(async (req) => {
  const user = await requireApiUser();
  return json(await setDayMarks(user, await readJson(req, DayMarksInput)), { status: 201 });
});
