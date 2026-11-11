import { cancelEntry, CancelInput } from "@/server/cash";
import { handle, json, readJson, uuidParam } from "@/server/http";
import { requireApiUser } from "@/server/session";

type Ctx = { params: Promise<{ id: string }> };

/** Owner: cancel a cash entry with a reason (it stays on the day, crossed out). */
export const POST = handle(async (req, ctx: Ctx) => {
  const user = await requireApiUser();
  return json(await cancelEntry(user, uuidParam((await ctx.params).id), await readJson(req, CancelInput)));
});
