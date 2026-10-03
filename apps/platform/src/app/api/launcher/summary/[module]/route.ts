import { ModuleId } from "@plantops/types";
import { requireUser } from "@/server/auth";
import { handle, json, notFound } from "@/server/http";
import { summaryForUser } from "@/server/summary";

type Ctx = { params: Promise<{ module: string }> };

/** Live numbers for one tile ("3 held today"), fetched from the module right now. */
export const GET = handle(async (req, ctx: Ctx) => {
  const user = await requireUser(req);
  const mod = ModuleId.safeParse((await ctx.params).module);
  if (!mod.success) throw notFound();
  return json(await summaryForUser(user, mod.data));
});
