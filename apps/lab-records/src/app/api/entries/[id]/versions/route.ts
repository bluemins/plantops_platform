import { correctEntry, CorrectionInput } from "@/server/entries";
import { handle, json, readJson, uuidParam } from "@/server/http";
import { requireApiUser } from "@/server/session";

type Ctx = { params: Promise<{ id: string }> };

/** A correction: a new version with a reason. The earlier version stays on record. */
export const POST = handle(async (req, ctx: Ctx) => {
  const user = await requireApiUser();
  return json(await correctEntry(user, uuidParam((await ctx.params).id), await readJson(req, CorrectionInput)), { status: 201 });
});
