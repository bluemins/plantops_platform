import { approveBatch } from "@/server/approval";
import { handle, json, uuidParam } from "@/server/http";
import { requireApiUser } from "@/server/session";

type Ctx = { params: Promise<{ id: string }> };

/** Approve for production (owner / lab lead). */
export const POST = handle(async (_req, ctx: Ctx) => {
  const user = await requireApiUser();
  return json(await approveBatch(user, uuidParam((await ctx.params).id)));
});
