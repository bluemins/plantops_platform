import { applyStarter, StarterInput } from "@/server/items";
import { handle, json, readJson } from "@/server/http";
import { requireApiUser } from "@/server/session";

/** First start: create the ticked entries of the starter list (owner only, only while the plant has no items). */
export const POST = handle(async (req) => {
  const user = await requireApiUser();
  return json(await applyStarter(user, await readJson(req, StarterInput)), { status: 201 });
});
