import { z } from "zod";
import { cancelSpend } from "@/server/staff-cash";
import { handle, json, readJson, uuidParam } from "@/server/http";
import { requireApiUser } from "@/server/session";

type Ctx = { params: Promise<{ id: string }> };

/** Owner: cancel a wrong "spent from cash given" with a reason. */
export const POST = handle(async (req, ctx: Ctx) => {
  const user = await requireApiUser();
  const { reason } = await readJson(req, z.object({ reason: z.string() }));
  return json(await cancelSpend(user, uuidParam((await ctx.params).id), reason));
});
