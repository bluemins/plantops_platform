import { after } from "next/server";
import { botCreateOrder, botRoute, notifyBotOrder, OrderCreateInput } from "@/server/bot";
import { kit } from "@/server/kit";

/**
 * WhatsApp bot: save a confirmed order (201), or the same order again for a repeated key (200, created: false). The
 * owners' "New order" alert goes out after the answer, once.
 */
export const POST = botRoute(OrderCreateInput, async (key, input) => {
  const { order, answer } = await botCreateOrder(key, input);
  if (order.created) after(() => kit.notify(key.tenant_id, notifyBotOrder(key, order)));
  return Response.json(answer, { status: order.created ? 201 : 200 });
});
