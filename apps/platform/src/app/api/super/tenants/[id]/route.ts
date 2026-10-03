import { handle, json, readJson, uuidParam } from "@/server/http";
import { requireSuperAdmin } from "@/server/super-auth";
import { getTenant, UpdateTenantInput, updateTenant } from "@/server/tenants";

type Ctx = { params: Promise<{ id: string }> };

export const GET = handle(async (req, ctx: Ctx) => {
  await requireSuperAdmin(req);
  return json(await getTenant(uuidParam((await ctx.params).id)));
});

export const PATCH = handle(async (req, ctx: Ctx) => {
  const admin = await requireSuperAdmin(req);
  const id = uuidParam((await ctx.params).id);
  return json(await updateTenant(admin, id, await readJson(req, UpdateTenantInput)));
});
