import { z } from "zod";
import { addRewardToOrder } from "@/server/drop/points";
import { handle, json, readJson, uuidParam } from "@/server/http";
import { requireApiUser } from "@/server/session";

type Ctx = { params: Promise<{ id: string }> };
const Input = z.object({ order_id: z.uuid() });

/** Owner / Order desk: put a free box asked with points on the shop's pending order. */
export const POST = handle(async (req, ctx: Ctx) => {
  const user = await requireApiUser();
  const { order_id } = await readJson(req, Input);
  return json(await addRewardToOrder(user, uuidParam((await ctx.params).id), order_id));
});
