import { requireTenantAdmin } from "@/server/auth";
import { UpdateSkuInput, updateSku } from "@/server/business";
import { handle, json, readJson, uuidParam } from "@/server/http";

type Ctx = { params: Promise<{ id: string }> };

/** Edit a product or make it inactive. Products are never deleted (other modules refer to them). */
export const PATCH = handle(async (req, ctx: Ctx) => {
  const admin = await requireTenantAdmin(req);
  const id = uuidParam((await ctx.params).id);
  return json(await updateSku(admin, id, await readJson(req, UpdateSkuInput)));
});
