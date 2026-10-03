import { getBranding } from "@/server/business";
import { handle, json, uuidParam } from "@/server/http";
import { authenticateModule } from "@/server/sso";

type Ctx = { params: Promise<{ tid: string }> };

/** Server-to-server: plant name, brand color and logo link, so a module can show the plant's branding. */
export const GET = handle(async (req, ctx: Ctx) => {
  await authenticateModule(req);
  return json(await getBranding(uuidParam((await ctx.params).tid)));
});
