import { handle, json, readJson, uuidParam } from "@/server/http";
import { updateParameter, UpdateParameterInput } from "@/server/parameters";
import { requireApiUser } from "@/server/session";

type Ctx = { params: Promise<{ id: string }> };

/** Change a unit, limits, name or on/off (owner / lab lead). Audited; past results keep their old limit. */
export const PATCH = handle(async (req, ctx: Ctx) => {
  const user = await requireApiUser();
  return json(await updateParameter(user, uuidParam((await ctx.params).id), await readJson(req, UpdateParameterInput)));
});
