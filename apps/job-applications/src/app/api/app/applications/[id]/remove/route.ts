import { removeApplication, RemoveInput } from "@/server/applications";
import { handle, json, readJson } from "@/server/http";
import { requireApiUser } from "@/server/session";

type Ctx = { params: Promise<{ id: string }> };

/** The owner's "Remove this application now", with a reason. */
export const POST = handle(async (req, ctx: Ctx) => {
  const user = await requireApiUser();
  return json(await removeApplication(user, (await ctx.params).id, (await readJson(req, RemoveInput)).reason));
});
