import { correctDocument, CorrectInput } from "@/server/documents";
import { handle, json, readJson, uuidParam } from "@/server/http";
import { requireApiUser } from "@/server/session";

type Ctx = { params: Promise<{ id: string }> };

/** Correct the details: a new version with a reason; the old one stays (owner / document keeper). */
export const POST = handle(async (req, ctx: Ctx) => {
  const user = await requireApiUser();
  return json(await correctDocument(user, uuidParam((await ctx.params).id), await readJson(req, CorrectInput)));
});
