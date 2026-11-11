import { BillCreditInput, billCredit } from "@/server/van";
import { handle, json, readJson, uuidParam } from "@/server/http";
import { requireApiUser } from "@/server/session";

type Ctx = { params: Promise<{ id: string }> };

/** Owner, Accounts: make the bill for a van report's "not paid" line. */
export const POST = handle(async (req, ctx: Ctx) => {
  const user = await requireApiUser();
  return json(await billCredit(user, uuidParam((await ctx.params).id), await readJson(req, BillCreditInput)), { status: 201 });
});
