import { PhoneInput, removePhone } from "@/server/drop/manage";
import { handle, json, readJson, uuidParam } from "@/server/http";
import { requireApiUser } from "@/server/session";

type Ctx = { params: Promise<{ id: string }> };

/** Owner / Order desk: remove an extra phone (it is logged out at once). */
export const POST = handle(async (req, ctx: Ctx) => {
  const user = await requireApiUser();
  return json(await removePhone(user, uuidParam((await ctx.params).id), await readJson(req, PhoneInput)));
});
