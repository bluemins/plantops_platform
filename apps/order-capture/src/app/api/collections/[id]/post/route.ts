import { after } from "next/server";
import { PostInput, postLine } from "@/server/collections";
import { handle, json, readJson, uuidParam } from "@/server/http";
import { kit } from "@/server/kit";
import { paymentNotification } from "@/server/notify";
import { requireApiUser } from "@/server/session";

type Ctx = { params: Promise<{ id: string }> };

/** Owner, Accounts: post a waiting collection line as a payment on the customer's account. */
export const POST = handle(async (req, ctx: Ctx) => {
  const user = await requireApiUser();
  const p = await postLine(user, uuidParam((await ctx.params).id), await readJson(req, PostInput));
  after(() => kit.notify(user.tenantId, paymentNotification(user, p)));
  return json(p, { status: 201 });
});
