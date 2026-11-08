import { dropCard, SetDropInput, setDrop } from "@/server/drop/manage";
import { handle, json, readJson, uuidParam } from "@/server/http";
import { requireApiUser } from "@/server/session";

type Ctx = { params: Promise<{ id: string }> };

/** A customer's Drop card (owner, Order desk, support). */
export const GET = handle(async (_req, ctx: Ctx) => {
  const user = await requireApiUser();
  return json(await dropCard(user, uuidParam((await ctx.params).id)));
});

/** Owner: switch the shop on / off for Drop and the brands it sees. */
export const POST = handle(async (req, ctx: Ctx) => {
  const user = await requireApiUser();
  return json(await setDrop(user, uuidParam((await ctx.params).id), await readJson(req, SetDropInput)));
});
