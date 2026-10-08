import { createItem, ItemInput } from "@/server/setup";
import { handle, json, readJson } from "@/server/http";
import { requireApiUser } from "@/server/session";

/** Add an item to a section (owner or store keeper; only the owner may give it a limit). */
export const POST = handle(async (req) => {
  const user = await requireApiUser();
  return json(await createItem(user, await readJson(req, ItemInput)), { status: 201 });
});
