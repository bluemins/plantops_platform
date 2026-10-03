import { requireTenantAdmin } from "@/server/auth";
import { handle, json, uuidParam } from "@/server/http";
import { unlockUser } from "@/server/users";

type Ctx = { params: Promise<{ id: string }> };

export const POST = handle(async (req, ctx: Ctx) => {
  const admin = await requireTenantAdmin(req);
  await unlockUser(admin, uuidParam((await ctx.params).id));
  return json({ ok: true });
});
