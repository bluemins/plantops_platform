import { LocationInput, saveLocation } from "@/server/customer-details";
import { handle, json, readJson, uuidParam } from "@/server/http";
import { requireApiUser } from "@/server/session";

type Ctx = { params: Promise<{ id: string }> };

/** Save the shop's location: the phone's GPS at the shop (owner, Order desk, Accounts, Delivery staff) or a pasted Maps link (owner). */
export const POST = handle(async (req, ctx: Ctx) => {
  const user = await requireApiUser();
  return json(await saveLocation(user, uuidParam((await ctx.params).id), await readJson(req, LocationInput)));
});
