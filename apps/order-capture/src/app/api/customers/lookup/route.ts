import { handle, json } from "@/server/http";
import { lookupCustomer } from "@/server/orders";
import { requireApiUser } from "@/server/session";

/** The order form: is this phone a customer, when did they last order, at what rates (owner and Order desk). */
export const GET = handle(async (req) => {
  const user = await requireApiUser();
  return json(await lookupCustomer(user, new URL(req.url).searchParams.get("phone") ?? ""));
});
