import { monthUndo, UndoInput } from "@/server/jar-month";
import { handle, json, readJson } from "@/server/http";
import { requireApiUser } from "@/server/session";

type Ctx = { params: Promise<{ month: string }> };

/** Owner: cancel a month's 20 L month bills (none may have a payment) so the month can be imported again. */
export const POST = handle(async (req, ctx: Ctx) => {
  const user = await requireApiUser();
  return json(await monthUndo(user, (await ctx.params).month, await readJson(req, UndoInput)));
});
