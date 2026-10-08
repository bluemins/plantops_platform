import { ItemPatch, updateItem } from "@/server/setup";
import { handle, json, readJson, uuidParam } from "@/server/http";
import { requireApiUser } from "@/server/session";

type Ctx = { params: Promise<{ id: string }> };

/** Edit an item, move it, set its limit or switch it off / on. Owner-only parts are checked in updateItem. */
export const PATCH = handle(async (req, ctx: Ctx) => {
  const user = await requireApiUser();
  return json(await updateItem(user, uuidParam((await ctx.params).id), await readJson(req, ItemPatch)));
});
