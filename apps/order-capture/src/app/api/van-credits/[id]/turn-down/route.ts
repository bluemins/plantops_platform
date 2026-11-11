import { TurnDownCreditInput, turnDownCredit } from "@/server/van";
import { handle, json, readJson, uuidParam } from "@/server/http";
import { requireApiUser } from "@/server/session";

type Ctx = { params: Promise<{ id: string }> };

/** Owner, Accounts: the "not paid" line was not credit after all (with a reason). */
export const POST = handle(async (req, ctx: Ctx) => {
  const user = await requireApiUser();
  return json(await turnDownCredit(user, uuidParam((await ctx.params).id), await readJson(req, TurnDownCreditInput)));
});
