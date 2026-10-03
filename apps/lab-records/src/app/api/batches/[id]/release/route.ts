import { releaseHold, ReleaseInput } from "@/server/approval";
import { handle, json, readJson, uuidParam } from "@/server/http";
import { requireApiUser } from "@/server/session";

type Ctx = { params: Promise<{ id: string }> };

/** On hold -> pending: needs a corrective note and nothing failing (owner / lab lead). */
export const POST = handle(async (req, ctx: Ctx) => {
  const user = await requireApiUser();
  return json(await releaseHold(user, uuidParam((await ctx.params).id), await readJson(req, ReleaseInput)));
});
