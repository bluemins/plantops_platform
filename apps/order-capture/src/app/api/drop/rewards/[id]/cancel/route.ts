import { cancelReward, CancelRewardInput } from "@/server/drop/points";
import { handle, json, readJson, uuidParam } from "@/server/http";
import { requireApiUser } from "@/server/session";

type Ctx = { params: Promise<{ id: string }> };

/** Owner / Order desk: cancel a free box asked with points (not delivered yet): the points go back. */
export const POST = handle(async (req, ctx: Ctx) => {
  const user = await requireApiUser();
  return json(await cancelReward(user, uuidParam((await ctx.params).id), await readJson(req, CancelRewardInput)));
});
