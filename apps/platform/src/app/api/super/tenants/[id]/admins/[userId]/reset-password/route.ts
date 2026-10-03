import { handle, json, uuidParam } from "@/server/http";
import { requireSuperAdmin } from "@/server/super-auth";
import { resetTenantAdminPassword } from "@/server/tenants";

type Ctx = { params: Promise<{ id: string; userId: string }> };

export const POST = handle(async (req, ctx: Ctx) => {
  const admin = await requireSuperAdmin(req);
  const { id, userId } = await ctx.params;
  return json(await resetTenantAdminPassword(admin, uuidParam(id), uuidParam(userId)));
});
