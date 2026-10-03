import { superUpdateSku, UpdateSkuInput } from "@/server/business";
import { handle, json, readJson, uuidParam } from "@/server/http";
import { requireSuperAdmin } from "@/server/super-auth";

type Ctx = { params: Promise<{ id: string; skuId: string }> };

export const PATCH = handle(async (req, ctx: Ctx) => {
  const admin = await requireSuperAdmin(req);
  const { id, skuId } = await ctx.params;
  return json(await superUpdateSku(admin, uuidParam(id), uuidParam(skuId), await readJson(req, UpdateSkuInput)));
});
