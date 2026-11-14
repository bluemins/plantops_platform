import { requireUser } from "@/server/auth";
import { ChangeCardInput, changeCard, removeCard } from "@/server/board";
import { handle, json, readJson, uuidParam } from "@/server/http";

type Ctx = { params: Promise<{ id: string }> };

/** `{ text }` = edit (writer only) or `{ done }` = tick / untick (anyone). */
export const PATCH = handle(async (req, ctx: Ctx) => {
  const user = await requireUser(req);
  const id = uuidParam((await ctx.params).id);
  return json(await changeCard(user, id, await readJson(req, ChangeCardInput)));
});

/** Takes the card off the board (writer, or the owner). */
export const DELETE = handle(async (req, ctx: Ctx) => {
  const user = await requireUser(req);
  return json(await removeCard(user, uuidParam((await ctx.params).id)));
});
