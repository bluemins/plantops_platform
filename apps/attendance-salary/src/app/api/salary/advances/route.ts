import { handle, json, readJson } from "@/server/http";
import { AdvanceInput, saveAdvance } from "@/server/salary-edit";
import { requireApiUser } from "@/server/session";

/** Owner: an advance given to a person, or a correction of an earlier one (409 if someone saved one meanwhile). */
export const POST = handle(async (req) => {
  const user = await requireApiUser();
  return json(await saveAdvance(user, await readJson(req, AdvanceInput)), { status: 201 });
});
