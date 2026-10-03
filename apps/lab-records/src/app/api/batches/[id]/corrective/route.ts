import { addCorrectiveAction, CorrectiveInput } from "@/server/approval";
import { handle, json, readJson, uuidParam } from "@/server/http";
import { requireApiUser } from "@/server/session";

type Ctx = { params: Promise<{ id: string }> };

/** What was done about a failure (lab staff, lab lead or owner). */
export const POST = handle(async (req, ctx: Ctx) => {
  const user = await requireApiUser();
  return json(await addCorrectiveAction(user, uuidParam((await ctx.params).id), await readJson(req, CorrectiveInput)));
});
