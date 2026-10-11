import { createItem, ItemInput } from "@/server/items";
import { handle, json, readJson } from "@/server/http";
import { requireApiUser } from "@/server/session";

/** Add an item to the plant's list (owner only; checked in createItem). */
export const POST = handle(async (req) => {
  const user = await requireApiUser();
  return json(await createItem(user, await readJson(req, ItemInput)), { status: 201 });
});
