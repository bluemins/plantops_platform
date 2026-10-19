import { handle, json } from "@/server/http";
import { searchForOrder } from "@/server/orders";
import { requireApiUser } from "@/server/session";

/** The order form: customers by name, place or phone digits, at most 8 (owner and Order desk). */
export const GET = handle(async (req) => {
  const user = await requireApiUser();
  return json(await searchForOrder(user, new URL(req.url).searchParams.get("q") ?? ""));
});
