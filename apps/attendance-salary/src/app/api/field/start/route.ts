import { startDay, StartEndInput } from "@/server/field";
import { handle, json, readJson } from "@/server/http";
import { requireApiUser } from "@/server/session";

/** My field day: Start my day (today only, once). The photo is uploaded first (/api/field/photo). */
export const POST = handle(async (req) => {
  const user = await requireApiUser();
  return json(await startDay(user, await readJson(req, StartEndInput)), { status: 201 });
});
