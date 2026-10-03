import { ModuleId } from "@plantops/types";
import { handle, json, notFound, uuidParam } from "@/server/http";
import { summaryForSuper } from "@/server/summary";
import { requireSuperAdmin } from "@/server/super-auth";

type Ctx = { params: Promise<{ id: string; module: string }> };

export const GET = handle(async (req, ctx: Ctx) => {
  await requireSuperAdmin(req);
  const { id, module } = await ctx.params;
  const mod = ModuleId.safeParse(module);
  if (!mod.success) throw notFound();
  return json(await summaryForSuper(uuidParam(id), mod.data));
});
