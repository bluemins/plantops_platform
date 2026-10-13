import { undoDelivered, ReasonInput } from "@/server/handling";
import { handle, json, readJson, uuidParam } from "@/server/http";
import { requireApiUser } from "@/server/session";

type Ctx = { params: Promise<{ id: string }> };

/** Undo Delivered: back to Pending, with a reason (owner only). */
export const POST = handle(async (req, ctx: Ctx) => {
  const user = await requireApiUser();
  return json(await undoDelivered(user, uuidParam((await ctx.params).id), await readJson(req, ReasonInput)));
});
