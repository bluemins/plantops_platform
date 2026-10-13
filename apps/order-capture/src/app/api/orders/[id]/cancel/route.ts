import { after } from "next/server";
import { cancelOrder, ReasonInput } from "@/server/handling";
import { handle, json, readJson, uuidParam } from "@/server/http";
import { kit } from "@/server/kit";
import { cancelledNotification } from "@/server/notify";
import { requireApiUser } from "@/server/session";

type Ctx = { params: Promise<{ id: string }> };

/** Cancel a pending order, with a reason (owner and Order desk). Final. */
export const POST = handle(async (req, ctx: Ctx) => {
  const user = await requireApiUser();
  const { status, event } = await cancelOrder(user, uuidParam((await ctx.params).id), await readJson(req, ReasonInput));
  after(() => kit.notify(user.tenantId, cancelledNotification(user, event)));
  return json({ status });
});
