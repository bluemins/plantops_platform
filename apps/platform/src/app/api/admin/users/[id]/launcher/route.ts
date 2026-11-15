import { requireTenantAdmin } from "@/server/auth";
import { handle, json, uuidParam } from "@/server/http";
import { previewLauncher } from "@/server/launcher";

type Ctx = { params: Promise<{ id: string }> };

/** Owner only: the home screen tiles one person of this plant sees (read-only preview). */
export const GET = handle(async (req, ctx: Ctx) => {
  const admin = await requireTenantAdmin(req);
  return json(await previewLauncher(admin, uuidParam((await ctx.params).id)));
});
