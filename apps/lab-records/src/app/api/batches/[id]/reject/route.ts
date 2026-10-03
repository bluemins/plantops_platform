import { rejectBatch, RejectInput } from "@/server/approval";
import { handle, json, readJson, uuidParam } from "@/server/http";
import { requireApiUser } from "@/server/session";

type Ctx = { params: Promise<{ id: string }> };

/** Reject for good, with a reason (owner / lab lead). */
export const POST = handle(async (req, ctx: Ctx) => {
  const user = await requireApiUser();
  return json(await rejectBatch(user, uuidParam((await ctx.params).id), await readJson(req, RejectInput)));
});
