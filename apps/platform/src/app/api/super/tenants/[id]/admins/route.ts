import { handle, json, readJson, uuidParam } from "@/server/http";
import { requireSuperAdmin } from "@/server/super-auth";
import { createTenantAdmin, TenantAdminInput } from "@/server/tenants";

type Ctx = { params: Promise<{ id: string }> };

export const POST = handle(async (req, ctx: Ctx) => {
  const admin = await requireSuperAdmin(req);
  const id = uuidParam((await ctx.params).id);
  return json(await createTenantAdmin(admin, id, await readJson(req, TenantAdminInput)), { status: 201 });
});
