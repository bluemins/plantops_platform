import { after } from "next/server";
import { deliverOrder, DeliverInput } from "@/server/handling";
import { handle, json, readJson, uuidParam } from "@/server/http";
import { kit } from "@/server/kit";
import { deliveredNotification } from "@/server/notify";
import { requireApiUser } from "@/server/session";
import { sendPending } from "@/server/thanks";

type Ctx = { params: Promise<{ id: string }> };

/**
 * Mark a pending order delivered, with an optional note and Zoho invoice no. (owner and Order desk). A ticked
 * WhatsApp thank-you is sent after the answer, so the delivery never waits for Twilio.
 */
export const POST = handle(async (req, ctx: Ctx) => {
  const user = await requireApiUser();
  const { status, event, thanks_queued } = await deliverOrder(user, uuidParam((await ctx.params).id), await readJson(req, DeliverInput));
  const note = deliveredNotification(user, event);
  if (note) after(() => kit.notify(user.tenantId, note));
  if (thanks_queued) after(() => sendPending(user.tenantId).catch((err) => console.error("[order-capture] WhatsApp thank-you failed:", (err as Error).message)));
  return json({ status });
});
