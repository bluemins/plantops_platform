import { handle, json, readJson } from "@/server/http";
import { MoveInput, moveOpening } from "@/server/openings";
import { requireApiUser } from "@/server/session";

type Ctx = { params: Promise<{ id: string }> };

/** One place up or down within its group (owner only; checked in moveOpening). */
export const POST = handle(async (req, ctx: Ctx) => {
  const user = await requireApiUser();
  const { direction } = await readJson(req, MoveInput);
  return json(await moveOpening(user, (await ctx.params).id, direction));
});
