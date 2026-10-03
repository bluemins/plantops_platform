import { renewDocument, RenewInput } from "@/server/documents";
import { handle, json, readJson, uuidParam } from "@/server/http";
import { requireApiUser } from "@/server/session";

type Ctx = { params: Promise<{ id: string }> };

/** Renewal: a new version with the new file and expiry (owner / document keeper). */
export const POST = handle(async (req, ctx: Ctx) => {
  const user = await requireApiUser();
  return json(await renewDocument(user, uuidParam((await ctx.params).id), await readJson(req, RenewInput)));
});
