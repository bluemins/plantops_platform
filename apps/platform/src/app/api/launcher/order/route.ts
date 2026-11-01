import { requireUser } from "@/server/auth";
import { handle, json, readJson } from "@/server/http";
import { saveTileOrder, TileOrderInput } from "@/server/launcher";

/** Saves this person's own launcher tile order ("Arrange tiles"); an empty list = the usual order again. */
export const PUT = handle(async (req) => {
  const user = await requireUser(req);
  return json(await saveTileOrder(user, await readJson(req, TileOrderInput)));
});
