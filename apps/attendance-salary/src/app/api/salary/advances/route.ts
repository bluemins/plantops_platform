import { after } from "next/server";
import { handle, json, readJson } from "@/server/http";
import { kit } from "@/server/kit";
import { AdvanceInput, saveAdvance } from "@/server/salary-edit";
import { requireApiUser } from "@/server/session";

/**
 * Owner or Office staff: an advance given to a person, or a correction of an earlier one (409 if someone saved one
 * meanwhile). Office staff's advance tells the owners (phone + bell), after the answer.
 */
export const POST = handle(async (req) => {
  const user = await requireApiUser();
  const { notice, ...answer } = await saveAdvance(user, await readJson(req, AdvanceInput));
  if (notice) after(() => kit.notify(user.tenantId, notice));
  return json(answer, { status: 201 });
});
