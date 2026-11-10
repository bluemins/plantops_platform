import { LinkInput, linkBill } from "@/server/bill-link";
import { handle, json, readJson, uuidParam } from "@/server/http";
import { requireApiUser } from "@/server/session";

type Ctx = { params: Promise<{ id: string }> };

/** Owner: link an imported Zoho bill (by id or number) to this delivered order. */
export const POST = handle(async (req, ctx: Ctx) => {
  const user = await requireApiUser();
  const id = uuidParam((await ctx.params).id);
  return json(await linkBill(user, id, await readJson(req, LinkInput)));
});
