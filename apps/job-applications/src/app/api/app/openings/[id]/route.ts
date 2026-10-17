import { handle, json, readJson } from "@/server/http";
import { OpeningInput, updateOpening } from "@/server/openings";
import { requireApiUser } from "@/server/session";

type Ctx = { params: Promise<{ id: string }> };

/** Save a position: every field, incl. shown / switched off (owner only; checked in updateOpening). */
export const PATCH = handle(async (req, ctx: Ctx) => {
  const user = await requireApiUser();
  return json(await updateOpening(user, (await ctx.params).id, await readJson(req, OpeningInput)));
});
