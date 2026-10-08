import { ItemOrder, reorderItems } from "@/server/setup";
import { handle, json, readJson } from "@/server/http";
import { requireApiUser } from "@/server/session";

/** New order of the items in one section (owner or store keeper). */
export const POST = handle(async (req) => {
  const user = await requireApiUser();
  return json(await reorderItems(user, await readJson(req, ItemOrder)));
});
