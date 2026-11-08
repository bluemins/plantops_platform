import { MakeMainInput, makeMain } from "@/server/drop/manage";
import { handle, json, readJson, uuidParam } from "@/server/http";
import { requireApiUser } from "@/server/session";

type Ctx = { params: Promise<{ id: string }> };

/** Owner: an extra phone becomes the main phone (with a reason). */
export const POST = handle(async (req, ctx: Ctx) => {
  const user = await requireApiUser();
  return json(await makeMain(user, uuidParam((await ctx.params).id), await readJson(req, MakeMainInput)));
});
