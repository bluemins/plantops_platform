import { changeOrder, ChangeInput } from "@/server/handling";
import { handle, json, readJson, uuidParam } from "@/server/http";
import { requireApiUser } from "@/server/session";

type Ctx = { params: Promise<{ id: string }> };

/** Change a pending order's lines: a new version (owner and Order desk). 409 if it changed since it was opened. */
export const POST = handle(async (req, ctx: Ctx) => {
  const user = await requireApiUser();
  return json(await changeOrder(user, uuidParam((await ctx.params).id), await readJson(req, ChangeInput)));
});
