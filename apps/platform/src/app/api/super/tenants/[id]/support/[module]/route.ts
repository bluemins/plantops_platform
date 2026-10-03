import { ModuleId } from "@plantops/types";
import { handle, json, notFound, uuidParam } from "@/server/http";
import { createSupportHandoff } from "@/server/support";
import { requireSuperAdmin } from "@/server/super-auth";

type Ctx = { params: Promise<{ id: string; module: string }> };

/** super_admin opens one plant's module read-only ("support view"). Returns the module URL with a one-time code. */
export const POST = handle(async (req, ctx: Ctx) => {
  const admin = await requireSuperAdmin(req);
  const { id, module } = await ctx.params;
  const mod = ModuleId.safeParse(module);
  if (!mod.success) throw notFound();
  return json(await createSupportHandoff(admin, uuidParam(id), mod.data));
});
