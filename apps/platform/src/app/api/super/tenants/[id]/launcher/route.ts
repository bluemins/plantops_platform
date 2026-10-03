import { handle, json, uuidParam } from "@/server/http";
import { superLauncher } from "@/server/launcher";
import { requireSuperAdmin } from "@/server/super-auth";

type Ctx = { params: Promise<{ id: string }> };

/** super_admin dashboard: a plant's tiles and plan card, as its owner sees them. */
export const GET = handle(async (req, ctx: Ctx) => {
  await requireSuperAdmin(req);
  return json(await superLauncher(uuidParam((await ctx.params).id)));
});
