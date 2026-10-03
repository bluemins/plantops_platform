import { requireTenantAdmin } from "@/server/auth";
import { createSku, listSkus, SkuInput } from "@/server/business";
import { handle, json, readJson } from "@/server/http";

export const GET = handle(async (req) => json(await listSkus(await requireTenantAdmin(req))));

export const POST = handle(async (req) => {
  const admin = await requireTenantAdmin(req);
  return json(await createSku(admin, await readJson(req, SkuInput)), { status: 201 });
});
