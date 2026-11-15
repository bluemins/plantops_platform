import { brandsCard, SetBrandsInput, setBrands } from "@/server/customer-brands";
import { handle, json, readJson, uuidParam } from "@/server/http";
import { requireApiUser } from "@/server/session";

type Ctx = { params: Promise<{ id: string }> };

/** A customer's "Brands they buy" (owner, Order desk, Accounts, Marketing staff, support). */
export const GET = handle(async (_req, ctx: Ctx) => {
  const user = await requireApiUser();
  return json(await brandsCard(user, uuidParam((await ctx.params).id)));
});

/** Owner and Order desk: the brands this customer buys ([] = every brand). */
export const POST = handle(async (req, ctx: Ctx) => {
  const user = await requireApiUser();
  return json(await setBrands(user, uuidParam((await ctx.params).id), await readJson(req, SetBrandsInput)));
});
