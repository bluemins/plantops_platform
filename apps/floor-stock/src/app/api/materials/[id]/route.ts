import { ContentInput, setContent } from "@/server/recipes";
import { handle, json, readJson, uuidParam } from "@/server/http";
import { requireApiUser } from "@/server/session";

type Ctx = { params: Promise<{ id: string }> };

/** Owner: what 1 counted unit of a raw material / consumable holds ("1 packet = 25,000 g"), damage %, loose pieces. */
export const PUT = handle(async (req, ctx: Ctx) => {
  const user = await requireApiUser();
  return json(await setContent(user, uuidParam((await ctx.params).id), await readJson(req, ContentInput)));
});
