import { requireTenantAdmin } from "@/server/auth";
import { handle, json, uuidParam } from "@/server/http";
import { resetUserSecret } from "@/server/users";

type Ctx = { params: Promise<{ id: string }> };

export const POST = handle(async (req, ctx: Ctx) => {
  const admin = await requireTenantAdmin(req);
  return json(await resetUserSecret(admin, uuidParam((await ctx.params).id)));
});
