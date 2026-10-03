import { getSkusForModule } from "@/server/business";
import { handle, json, uuidParam } from "@/server/http";
import { authenticateModule } from "@/server/sso";

type Ctx = { params: Promise<{ tid: string }> };

/** Server-to-server: the plant's products. Modules store sku_id as a plain reference (no cross-schema key). */
export const GET = handle(async (req, ctx: Ctx) => {
  await authenticateModule(req);
  return json(await getSkusForModule(uuidParam((await ctx.params).tid)));
});
