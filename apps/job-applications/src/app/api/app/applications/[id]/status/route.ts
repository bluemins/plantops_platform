import { changeStatus, StatusInput } from "@/server/applications";
import { handle, json, readJson } from "@/server/http";
import { requireApiUser } from "@/server/session";

type Ctx = { params: Promise<{ id: string }> };

/** New / Called / Shortlisted / Hired / Not suitable (owner, HR desk). 409 when someone changed it meanwhile. */
export const POST = handle(async (req, ctx: Ctx) => {
  const user = await requireApiUser();
  return json(await changeStatus(user, (await ctx.params).id, await readJson(req, StatusInput)));
});
