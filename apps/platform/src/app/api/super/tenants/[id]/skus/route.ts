import { SkuInput, superCreateSku, superListSkus } from "@/server/business";
import { handle, json, readJson, uuidParam } from "@/server/http";
import { requireSuperAdmin } from "@/server/super-auth";

type Ctx = { params: Promise<{ id: string }> };

export const GET = handle(async (req, ctx: Ctx) => {
  await requireSuperAdmin(req);
  return json(await superListSkus(uuidParam((await ctx.params).id)));
});

export const POST = handle(async (req, ctx: Ctx) => {
  const admin = await requireSuperAdmin(req);
  const id = uuidParam((await ctx.params).id);
  return json(await superCreateSku(admin, id, await readJson(req, SkuInput)), { status: 201 });
});
