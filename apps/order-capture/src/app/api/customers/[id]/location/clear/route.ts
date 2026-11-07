import { ClearLocationInput, clearLocation } from "@/server/customer-details";
import { handle, json, readJson, uuidParam } from "@/server/http";
import { requireApiUser } from "@/server/session";

type Ctx = { params: Promise<{ id: string }> };

/** Clear a wrong shop pin, with a reason (owner, Order desk). */
export const POST = handle(async (req, ctx: Ctx) => {
  const user = await requireApiUser();
  return json(await clearLocation(user, uuidParam((await ctx.params).id), await readJson(req, ClearLocationInput)));
});
