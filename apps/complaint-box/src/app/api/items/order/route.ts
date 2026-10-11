import { ItemOrder, reorderItems } from "@/server/items";
import { handle, json, readJson } from "@/server/http";
import { requireApiUser } from "@/server/session";

/** New order of all the plant's items (owner only). */
export const POST = handle(async (req) => {
  const user = await requireApiUser();
  return json(await reorderItems(user, await readJson(req, ItemOrder)));
});
