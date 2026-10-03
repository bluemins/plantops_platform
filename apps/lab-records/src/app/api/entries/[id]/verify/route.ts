import { verifyEntry } from "@/server/entries";
import { handle, json, uuidParam } from "@/server/http";
import { requireApiUser } from "@/server/session";

type Ctx = { params: Promise<{ id: string }> };

/** "Verified By": owner / lab lead confirms the current version. */
export const POST = handle(async (_req, ctx: Ctx) => {
  const user = await requireApiUser();
  return json(await verifyEntry(user, uuidParam((await ctx.params).id)));
});
