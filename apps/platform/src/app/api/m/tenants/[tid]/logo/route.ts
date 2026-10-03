import { getLogoForModule, logoResponse } from "@/server/business";
import { handle, uuidParam } from "@/server/http";
import { authenticateModule } from "@/server/sso";

type Ctx = { params: Promise<{ tid: string }> };

/** Server-to-server: the plant's logo image (modules serve or cache it for their own screens). */
export const GET = handle(async (req, ctx: Ctx) => {
  await authenticateModule(req);
  return logoResponse(await getLogoForModule(uuidParam((await ctx.params).tid)));
});
