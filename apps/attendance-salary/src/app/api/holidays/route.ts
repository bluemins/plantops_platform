import { AddHolidaysInput, addHolidays } from "@/server/holidays";
import { handle, json, readJson } from "@/server/http";
import { requireApiUser } from "@/server/session";

/** Owner only: adds holidays (one, or a pasted sheet) to one person's own list (rule 24), all saved or none. */
export const POST = handle(async (req) => {
  const user = await requireApiUser();
  return json(await addHolidays(user, await readJson(req, AddHolidaysInput)), { status: 201 });
});
