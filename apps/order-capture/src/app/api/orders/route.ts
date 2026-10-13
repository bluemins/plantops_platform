import { after } from "next/server";
import { handle, json, readJson } from "@/server/http";
import { kit } from "@/server/kit";
import { newOrderNotification } from "@/server/notify";
import { createOrder, OrderInput } from "@/server/orders";
import { requireApiUser } from "@/server/session";

/**
 * Save a new order (owner and Order desk). A repeated request key returns the same order (200) instead of a new one,
 * and tells nobody again. The owners hear about a new order once the answer has gone back.
 */
export const POST = handle(async (req) => {
  const user = await requireApiUser();
  const order = await createOrder(user, await readJson(req, OrderInput));
  if (order.created) after(() => kit.notify(user.tenantId, newOrderNotification(user, order)));
  return json(order, { status: order.created ? 201 : 200 });
});
