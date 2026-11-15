import { endDay, StartEndInput } from "@/server/field";
import { handle, json, readJson } from "@/server/http";
import { requireApiUser } from "@/server/session";

/** My field day: End my day (closes the open day). The photo is uploaded first (/api/field/photo). */
export const POST = handle(async (req) => {
  const user = await requireApiUser();
  return json(await endDay(user, await readJson(req, StartEndInput)), { status: 201 });
});
