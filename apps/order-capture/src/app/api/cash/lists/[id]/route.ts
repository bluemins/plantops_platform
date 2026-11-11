import { editListItem, ListEdit } from "@/server/cash";
import { handle, json, readJson, uuidParam } from "@/server/http";
import { requireApiUser } from "@/server/session";

type Ctx = { params: Promise<{ id: string }> };

/** Owner: rename an expense category or a vehicle, or switch it off / on. */
export const PATCH = handle(async (req, ctx: Ctx) => {
  const user = await requireApiUser();
  return json(await editListItem(user, uuidParam((await ctx.params).id), await readJson(req, ListEdit)));
});
