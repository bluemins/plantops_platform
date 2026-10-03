import { handle, json, readJson, uuidParam } from "@/server/http";
import { requireSuperAdmin } from "@/server/super-auth";
import { PlanInput, updatePlan } from "@/server/tenants";

type Ctx = { params: Promise<{ id: string }> };

export const PUT = handle(async (req, ctx: Ctx) => {
  const admin = await requireSuperAdmin(req);
  const id = uuidParam((await ctx.params).id);
  return json(await updatePlan(admin, id, await readJson(req, PlanInput)));
});
