import { after } from "next/server";
import { deliverOrder, DeliverInput } from "@/server/handling";
import { handle, json, readJson, uuidParam } from "@/server/http";
import { kit } from "@/server/kit";
import { deliveredNotification } from "@/server/notify";
import { requireApiUser } from "@/server/session";

type Ctx = { params: Promise<{ id: string }> };

/** Mark a pending order delivered, with an optional note and Zoho invoice no. (owner and Order desk). */
export const POST = handle(async (req, ctx: Ctx) => {
  const user = await requireApiUser();
  const { status, event } = await deliverOrder(user, uuidParam((await ctx.params).id), await readJson(req, DeliverInput));
  const note = deliveredNotification(user, event);
  if (note) after(() => kit.notify(user.tenantId, note));
  return json({ status });
});
