import { handle, json, readJson, uuidParam } from "@/server/http";
import { BillGstInput, setPurchaseBillGst } from "@/server/purchase-entry";
import { requireApiUser } from "@/server/session";

type Ctx = { params: Promise<{ id: string }> };

/** Owner, Accounts: tick / untick "GST bill" on a purchase bill (a label; audited). */
export const POST = handle(async (req, ctx: Ctx) => {
  const user = await requireApiUser();
  return json(await setPurchaseBillGst(user, uuidParam((await ctx.params).id), await readJson(req, BillGstInput)));
});
