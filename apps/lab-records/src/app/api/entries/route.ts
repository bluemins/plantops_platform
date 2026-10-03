import { createDailyEntry, DailyEntryInput } from "@/server/entries";
import { handle, json, readJson } from "@/server/http";
import { requireApiUser } from "@/server/session";

/** Saves a daily test: version 1, locked at once (lab technician / lab lead). */
export const POST = handle(async (req) => {
  const user = await requireApiUser();
  return json(await createDailyEntry(user, await readJson(req, DailyEntryInput)), { status: 201 });
});
