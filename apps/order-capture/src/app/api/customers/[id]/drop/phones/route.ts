import { addPhone, PhoneInput } from "@/server/drop/manage";
import { handle, json, readJson, uuidParam } from "@/server/http";
import { requireApiUser } from "@/server/session";

type Ctx = { params: Promise<{ id: string }> };

/** Owner / Order desk: add an extra phone to the shop. */
export const POST = handle(async (req, ctx: Ctx) => {
  const user = await requireApiUser();
  return json(await addPhone(user, uuidParam((await ctx.params).id), await readJson(req, PhoneInput)));
});
