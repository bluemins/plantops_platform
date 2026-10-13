import { CustomerPatch, updateCustomer } from "@/server/customers";
import { handle, json, readJson, uuidParam } from "@/server/http";
import { requireApiUser } from "@/server/session";

type Ctx = { params: Promise<{ id: string }> };

/** Edit a customer's name / place, or switch them off / on (owner and Order desk). The phone can't be changed. */
export const PATCH = handle(async (req, ctx: Ctx) => {
  const user = await requireApiUser();
  return json(await updateCustomer(user, uuidParam((await ctx.params).id), await readJson(req, CustomerPatch)));
});
