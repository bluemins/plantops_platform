import { enterClaim, EnterInput } from "@/server/claims";
import { handle, json, readJson } from "@/server/http";
import { requireApiUser } from "@/server/session";

/** Owner: a claim entered on someone's behalf (approved at once; no notification). */
export const POST = handle(async (req) => {
  const user = await requireApiUser();
  return json(await enterClaim(user, await readJson(req, EnterInput)), { status: 201 });
});
