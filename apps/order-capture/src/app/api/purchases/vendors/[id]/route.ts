import { handle, json, readJson, uuidParam } from "@/server/http";
import { updateVendor, VendorInput } from "@/server/purchase-entry";
import { requireApiUser } from "@/server/session";

type Ctx = { params: Promise<{ id: string }> };

/** Owner, Accounts: change a vendor's details, or switch them off / on. */
export const PUT = handle(async (req, ctx: Ctx) => {
  const user = await requireApiUser();
  return json(await updateVendor(user, uuidParam((await ctx.params).id), await readJson(req, VendorInput)));
});
