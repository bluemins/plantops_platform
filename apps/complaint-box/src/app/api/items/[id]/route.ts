import { ItemPatch, updateItem } from "@/server/items";
import { handle, json, readJson, uuidParam } from "@/server/http";
import { requireApiUser } from "@/server/session";

type Ctx = { params: Promise<{ id: string }> };

/** Rename an item or switch it off / on (owner only). Items are never deleted. */
export const PATCH = handle(async (req, ctx: Ctx) => {
  const user = await requireApiUser();
  return json(await updateItem(user, uuidParam((await ctx.params).id), await readJson(req, ItemPatch)));
});
