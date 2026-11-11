import { TurnDownInput, turnDownLine } from "@/server/collections";
import { handle, json, readJson, uuidParam } from "@/server/http";
import { requireApiUser } from "@/server/session";

type Ctx = { params: Promise<{ id: string }> };

/** Owner, Accounts: the line is not a customer payment (with a reason). */
export const POST = handle(async (req, ctx: Ctx) => {
  const user = await requireApiUser();
  return json(await turnDownLine(user, uuidParam((await ctx.params).id), await readJson(req, TurnDownInput)));
});
