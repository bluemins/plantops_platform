import { setResponsible, ResponsibleInput } from "@/server/documents";
import { handle, json, readJson, uuidParam } from "@/server/http";
import { requireApiUser } from "@/server/session";

type Ctx = { params: Promise<{ id: string }> };

/** Change who is responsible for keeping the document up to date (owner / document keeper). */
export const POST = handle(async (req, ctx: Ctx) => {
  const user = await requireApiUser();
  return json(await setResponsible(user, uuidParam((await ctx.params).id), await readJson(req, ResponsibleInput)));
});
