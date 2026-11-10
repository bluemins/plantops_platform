import { UnlinkInput, unlinkBill } from "@/server/bill-link";
import { handle, json, readJson, uuidParam } from "@/server/http";
import { requireApiUser } from "@/server/session";

type Ctx = { params: Promise<{ id: string }> };

/** Owner: take a wrongly linked Zoho bill off this order, with a reason. */
export const POST = handle(async (req, ctx: Ctx) => {
  const user = await requireApiUser();
  const id = uuidParam((await ctx.params).id);
  return json(await unlinkBill(user, id, await readJson(req, UnlinkInput)));
});
