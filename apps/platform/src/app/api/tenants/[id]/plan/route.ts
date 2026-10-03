import { handle, json, notFound, uuidParam } from "@/server/http";
import { authenticateModule } from "@/server/sso";
import { getPlanForTenant } from "@/server/tenants";

type Ctx = { params: Promise<{ id: string }> };

/** Server-to-server: a module reads the tenant's enabled modules + limits (CLAUDE.md "Plans and limits"). */
export const GET = handle(async (req, ctx: Ctx) => {
  await authenticateModule(req);
  const plan = await getPlanForTenant(uuidParam((await ctx.params).id));
  if (!plan) throw notFound("Plan not found");
  return json(plan);
});
