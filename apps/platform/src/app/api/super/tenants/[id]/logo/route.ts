import { logoResponse, superGetLogo } from "@/server/business";
import { handle, uuidParam } from "@/server/http";
import { requireSuperAdmin } from "@/server/super-auth";

type Ctx = { params: Promise<{ id: string }> };

export const GET = handle(async (req, ctx: Ctx) => {
  await requireSuperAdmin(req);
  return logoResponse(await superGetLogo(uuidParam((await ctx.params).id)));
});
